#!/usr/bin/env python3
"""Performer Site Sync, implemented for Stash's 0.32 raw-plugin API."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


PLUGIN_ID = "performer-site-sync"
PAGE_SIZE = 100
PROGRESS_PREFIX = "\x01p\x02"
LOCAL_PERFORMER_FIELDS = """
  id name disambiguation alias_list gender urls birthdate death_date ethnicity country
  eye_color hair_color height_cm measurements fake_tits career_start career_end
  tattoos piercings image_path favorite stash_ids { endpoint stash_id }
"""
LOCAL_STUDIO_FIELDS = "id name aliases urls favorite stash_ids { endpoint stash_id }"
STASHBOX_PERFORMER_FIELDS = """
  id name disambiguation aliases gender urls { url type } birth_date death_date deleted
  ethnicity country eye_color hair_color height measurements { band_size cup_size waist hip }
  breast_type career_start_year career_end_year tattoos { location description }
  piercings { location description } images { id url width height }
"""


class PluginError(RuntimeError):
    pass


def report_progress(completed: int, total: int) -> None:
    """Send progress using Stash's raw-plugin stderr protocol, not a plain error log."""
    if total <= 0:
        return
    fraction = min(1.0, max(0.0, completed / total))
    print(f"{PROGRESS_PREFIX}{fraction}", file=sys.stderr, flush=True)


def normalize_endpoint(value: Any) -> str:
    return str(value or "").strip().rstrip("/").lower()


def source_for_box(box: dict[str, Any]) -> str | None:
    identity = f"{box.get('name', '')} {box.get('endpoint', '')}".lower()
    if "stashdb" in identity or "stash-db" in identity:
        return "stashdb"
    if "theporndb" in identity or "porn db" in identity or "tpdb" in identity:
        return "tpdb"
    if "fansdb" in identity or "fans db" in identity:
        return "fansdb"
    return None


def setting_bool(settings: dict[str, Any], name: str, default: bool) -> bool:
    value = settings.get(name, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


class ResponseCache:
    def __init__(self, path: str | Path, ttl_hours: float = 24) -> None:
        self.path = Path(path)
        self.ttl_seconds = max(0.0, float(ttl_hours)) * 3600
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS responses (cache_key TEXT PRIMARY KEY, created REAL NOT NULL, body TEXT NOT NULL)")

    def get(self, key: str) -> Any | None:
        if self.ttl_seconds <= 0:
            return None
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT created, body FROM responses WHERE cache_key = ?", (key,)).fetchone()
            if not row:
                return None
            created, body = row
            if time.time() - created > self.ttl_seconds:
                db.execute("DELETE FROM responses WHERE cache_key = ?", (key,))
                return None
            return json.loads(body)

    def put(self, key: str, value: Any) -> None:
        if self.ttl_seconds <= 0:
            return
        body = json.dumps(value, sort_keys=True, separators=(",", ":"))
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT OR REPLACE INTO responses(cache_key, created, body) VALUES (?, ?, ?)", (key, time.time(), body))

    def clear(self) -> int:
        with sqlite3.connect(self.path) as db:
            count = db.execute("SELECT COUNT(*) FROM responses").fetchone()[0]
            db.execute("DELETE FROM responses")
            return int(count)


class GraphQLTransport:
    def __init__(self, endpoint: str, api_key: str = "", *, timeout: float = 20, cache: ResponseCache | None = None,
                 min_delay: float = 0, max_requests_per_minute: int | None = None) -> None:
        self.endpoint = endpoint
        self.api_key = api_key
        self.timeout = timeout
        self.cache = cache
        self.min_delay = max(0, float(min_delay))
        rpm_delay = 60 / max(1, int(max_requests_per_minute or 240))
        self.request_delay = max(self.min_delay, rpm_delay)
        self.last_request = 0.0

    def request(self, query: str, variables: dict[str, Any] | None = None, *, cacheable: bool = True) -> dict[str, Any]:
        variables = variables or {}
        cache_material = json.dumps([normalize_endpoint(self.endpoint), hashlib.sha256(self.api_key.encode()).hexdigest(), query, variables], sort_keys=True)
        cache_key = hashlib.sha256(cache_material.encode()).hexdigest()
        if cacheable and self.cache:
            cached = self.cache.get(cache_key)
            if cached is not None:
                return cached

        body = json.dumps({"query": query, "variables": variables}).encode()
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.api_key:
            headers["ApiKey"] = self.api_key
        request = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        last_error: Exception | None = None
        for attempt in range(3):
            delay = self.request_delay - (time.monotonic() - self.last_request)
            if delay > 0:
                time.sleep(delay)
            self.last_request = time.monotonic()
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                errors = payload.get("errors") or []
                if errors:
                    messages = "; ".join(str(item.get("message", "GraphQL error")) for item in errors[:3])
                    raise PluginError(f"GraphQL request to {self.endpoint} failed: {messages}")
                data = payload.get("data")
                if not isinstance(data, dict):
                    raise PluginError(f"GraphQL request to {self.endpoint} returned no data")
                if cacheable and self.cache:
                    self.cache.put(cache_key, data)
                return data
            except urllib.error.HTTPError as exc:
                last_error = exc
                retryable = exc.code == 429 or 500 <= exc.code <= 599
                if not retryable or attempt == 2:
                    detail = ""
                    try:
                        detail = exc.read(800).decode("utf-8", errors="replace")
                    except Exception:
                        pass
                    raise PluginError(f"HTTP {exc.code} from {self.endpoint}" + (f": {detail}" if detail else "")) from exc
                retry_after = exc.headers.get("Retry-After", "")
                try:
                    backoff = max(float(retry_after), 2 ** attempt)
                except ValueError:
                    backoff = 2 ** attempt
                time.sleep(min(30, backoff))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt == 2:
                    raise PluginError(f"Request to {self.endpoint} failed: {exc}") from exc
                time.sleep(2 ** attempt)
        raise PluginError(f"Request to {self.endpoint} failed: {last_error}")


class LocalStash:
    def __init__(self, server_connection: dict[str, Any]) -> None:
        scheme = str(server_connection.get("Scheme") or "http")
        host = str(server_connection.get("Host") or "localhost")
        port = server_connection.get("Port") or 9999
        self.endpoint = f"{scheme}://{host}:{port}/graphql"
        session_cookie = server_connection.get("SessionCookie") or {}
        self.cookie_name = session_cookie.get("Name") or "session"
        self.cookie = session_cookie.get("Value", "")

    def query(self, document: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        body = json.dumps({"query": document, "variables": variables or {}}).encode()
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.cookie:
            headers["Cookie"] = f"{self.cookie_name}={self.cookie}"
        request = urllib.request.Request(self.endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise PluginError(f"Stash GraphQL request failed: {exc}") from exc
        errors = payload.get("errors") or []
        if errors:
            messages = "; ".join(str(item.get("message", "GraphQL error")) for item in errors[:3])
            raise PluginError(f"Stash GraphQL error: {messages}")
        data = payload.get("data")
        if not isinstance(data, dict):
            raise PluginError("Stash GraphQL returned no data")
        return data

    def configuration(self) -> dict[str, Any]:
        data = self.query(f"""query PerformerSiteSyncConfig {{
          configuration {{ general {{ stashBoxes {{ endpoint api_key name max_requests_per_minute }} }}
            plugins(include: [\"{PLUGIN_ID}\"]) }}
        }}""")
        return data["configuration"]

    def performers(self) -> list[dict[str, Any]]:
        data = self.query(f"""query PerformerSiteSyncPerformers {{
          findPerformers(filter: {{ per_page: -1 }}) {{ count performers {{ {LOCAL_PERFORMER_FIELDS} }} }}
        }}""")
        return data["findPerformers"]["performers"]

    def performer(self, performer_id: str) -> dict[str, Any] | None:
        data = self.query(f"""query PerformerSiteSyncPerformer($id: ID!) {{
          findPerformer(id: $id) {{ {LOCAL_PERFORMER_FIELDS} }}
        }}""", {"id": str(performer_id)})
        return data.get("findPerformer")

    def studios(self) -> list[dict[str, Any]]:
        data = self.query(f"""query PerformerSiteSyncStudios {{
          findStudios(filter: {{ per_page: -1 }}) {{ count studios {{ {LOCAL_STUDIO_FIELDS} }} }}
        }}""")
        return data["findStudios"]["studios"]

    def update_performer(self, values: dict[str, Any]) -> None:
        self.query("""mutation PerformerSiteSyncUpdatePerformer($input: PerformerUpdateInput!) {
          performerUpdate(input: $input) { id }
        }""", {"input": values})

    def create_performer(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self.query("""mutation PerformerSiteSyncCreatePerformer($input: PerformerCreateInput!) {
          performerCreate(input: $input) { id name }
        }""", {"input": values})
        return data["performerCreate"]

    def update_studio(self, values: dict[str, Any]) -> None:
        self.query("""mutation PerformerSiteSyncUpdateStudio($input: StudioUpdateInput!) {
          studioUpdate(input: $input) { id }
        }""", {"input": values})

    def create_studio(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self.query("""mutation PerformerSiteSyncCreateStudio($input: StudioCreateInput!) {
          studioCreate(input: $input) { id name }
        }""", {"input": values})
        return data["studioCreate"]


DEFAULT_SETTINGS: dict[str, Any] = {
    "cacheExpirationHours": 24,
    "rateLimit": 0.25,
    "enableStashDB": True,
    "enableTPDB": True,
    "enableFansDB": True,
    "sourcePrecedence": "stashdb,tpdb,fansdb",
    "enableNameSearch": True,
    "overwriteExisting": False,
    "performerImageUpdate": True,
    "autoCreatePerformers": False,
    "autoCreateStudios": False,
}


class SyncService:
    def __init__(self, stash: LocalStash, configuration: dict[str, Any], cache: ResponseCache) -> None:
        self.stash = stash
        self.configuration = configuration
        self.cache = cache
        self.settings = {**DEFAULT_SETTINGS, **(configuration.get("plugins", {}).get(PLUGIN_ID, {}) or {})}
        self.boxes = self._enabled_boxes()
        self.source_errors: list[str] = []

    def _enabled_boxes(self) -> list[dict[str, Any]]:
        enabled_keys = {"stashdb": "enableStashDB", "tpdb": "enableTPDB", "fansdb": "enableFansDB"}
        boxes = []
        for box in self.configuration.get("general", {}).get("stashBoxes", []) or []:
            source = source_for_box(box)
            if not source or not setting_bool(self.settings, enabled_keys[source], True):
                continue
            if not box.get("endpoint") or not box.get("api_key"):
                continue
            clean = dict(box)
            clean["source"] = source
            boxes.append(clean)
        precedence = [part.strip().lower() for part in str(self.settings.get("sourcePrecedence", "")).split(",") if part.strip()]
        ranks = {name: len(precedence) - index for index, name in enumerate(precedence)}
        boxes.sort(key=lambda item: ranks.get(item["source"], 0), reverse=True)
        return boxes

    def validate_config(self) -> dict[str, Any]:
        all_boxes = self.configuration.get("general", {}).get("stashBoxes", []) or []
        known = [box for box in all_boxes if source_for_box(box)]
        configured_sources = {box["source"] for box in self.boxes}
        missing = []
        for source, setting in (("stashdb", "enableStashDB"), ("tpdb", "enableTPDB"), ("fansdb", "enableFansDB")):
            if setting_bool(self.settings, setting, True) and source not in configured_sources:
                missing.append(source)
        return {
            "ok": not missing,
            "configured_boxes": len(all_boxes),
            "recognized_boxes": len(known),
            "enabled_sources": [box["source"] for box in self.boxes],
            "missing_enabled_sources": missing,
            "message": "Configuration is ready." if not missing else "Add enabled sources under Settings → Metadata Providers → Stash-boxes, including each API key.",
        }

    def transport(self, box: dict[str, Any]) -> GraphQLTransport:
        return GraphQLTransport(
            str(box["endpoint"]), str(box.get("api_key", "")), cache=self.cache,
            min_delay=float(self.settings.get("rateLimit", 0.25) or 0),
            max_requests_per_minute=box.get("max_requests_per_minute", 240),
        )

    def test_connections(self) -> dict[str, Any]:
        results = []
        for box in self.boxes:
            try:
                self.transport(box).request("query PerformerSiteSyncPing { __typename }", cacheable=False)
                results.append({"source": box["source"], "name": box.get("name", box["source"]), "ok": True})
            except Exception as exc:
                results.append({"source": box["source"], "name": box.get("name", box["source"]), "ok": False, "error": self.redact(str(exc), box)})
        return {"tested": len(results), "succeeded": sum(1 for item in results if item["ok"]), "sources": results}

    @staticmethod
    def redact(message: str, box: dict[str, Any]) -> str:
        key = str(box.get("api_key", ""))
        return message.replace(key, "[redacted]") if key else message

    def external_performer(self, box: dict[str, Any], stash_id: str) -> dict[str, Any] | None:
        data = self.transport(box).request(f"""query PerformerSiteSyncFindPerformer($id: ID!) {{
          findPerformer(id: $id) {{ {STASHBOX_PERFORMER_FIELDS} }}
        }}""", {"id": str(stash_id)})
        return data.get("findPerformer")

    def search_performer(self, box: dict[str, Any], name: str) -> dict[str, Any] | None:
        data = self.transport(box).request(f"""query PerformerSiteSyncSearchPerformer($term: String!) {{
          searchPerformer(term: $term) {{ id name }}
        }}""", {"term": name})
        matches = [item for item in data.get("searchPerformer", []) or [] if str(item.get("name", "")).casefold() == name.casefold()]
        if len(matches) != 1:
            return None
        return self.external_performer(box, str(matches[0]["id"]))

    def update_all_performers(self) -> dict[str, Any]:
        performers = self.stash.performers()
        updated = failed_performers = 0
        error_samples: list[str] = []
        for index, performer in enumerate(performers, 1):
            try:
                if self.sync_performer(performer):
                    updated += 1
            except Exception as exc:
                failed_performers += 1
                if len(error_samples) < 20:
                    error_samples.append(f"{performer.get('name', performer.get('id'))}: {exc}")
            report_progress(index, len(performers))
        source_samples = self.source_errors[:20]
        errors = failed_performers + len(self.source_errors)
        return {"processed": len(performers), "updated": updated, "failed_performers": failed_performers,
                "source_failures": len(self.source_errors), "errors": errors,
                "error_samples": (error_samples + source_samples)[:20]}

    def sync_single_performer(self, performer_id: str) -> dict[str, Any]:
        performer = self.stash.performer(str(performer_id))
        if not performer:
            raise PluginError(f"Performer {performer_id} was not found")
        changed = self.sync_performer(performer)
        return {"performer_id": str(performer_id), "performer_name": performer.get("name"), "updated": changed}

    def sync_performer(self, performer: dict[str, Any]) -> bool:
        existing_ids = {normalize_endpoint(item.get("endpoint")): str(item.get("stash_id"))
                        for item in performer.get("stash_ids", []) or [] if item.get("endpoint") and item.get("stash_id")}
        found: list[tuple[dict[str, Any], dict[str, Any]]] = []
        source_error_count = len(self.source_errors)
        for box in self.boxes:
            external_id = existing_ids.get(normalize_endpoint(box["endpoint"]))
            try:
                external = self.external_performer(box, external_id) if external_id else None
                if not external and not external_id and setting_bool(self.settings, "enableNameSearch", True):
                    external = self.search_performer(box, str(performer.get("name", "")))
                if external and not external.get("deleted"):
                    found.append((box, external))
            except Exception as exc:
                message = f"{performer.get('name', performer.get('id'))} / {box['source']}: {self.redact(str(exc), box)}"
                self.source_errors.append(message)
        if not found:
            if len(self.source_errors) > source_error_count:
                raise PluginError("No configured source returned performer data; see plugin logs for source errors")
            return False
        update = build_performer_update(performer, found, self.settings)
        if len(update) <= 1:
            return False
        self.stash.update_performer(update)
        return True

    def favorite_items(self, box: dict[str, Any], kind: str) -> list[dict[str, Any]]:
        transport = self.transport(box)
        result_name = "performers" if kind == "performers" else "studios"
        root_field = "queryPerformers" if kind == "performers" else "queryStudios"
        sort_enum = "PerformerSortEnum" if kind == "performers" else "StudioSortEnum"
        fields = STASHBOX_PERFORMER_FIELDS if kind == "performers" else "id name aliases urls { url type }"
        items: list[dict[str, Any]] = []
        page = 1
        total = None
        while total is None or len(items) < total:
            document = f"""query PerformerSiteSyncFavorites($input: {kind.capitalize()[:-1]}QueryInput!) {{
              {root_field}(input: $input) {{ count {result_name} {{ {fields} }} }}
            }}"""
            # Use the API's required sort fields; these enums are part of the StashBox 0.32 client schema.
            variables = {"input": {"is_favorite": True, "page": page, "per_page": PAGE_SIZE,
                         "direction": "ASC", "sort": "NAME"}}
            data = transport.request(document, variables, cacheable=False)
            result = data.get(root_field) or {}
            batch = result.get(result_name) or []
            total = int(result.get("count", len(batch)))
            items.extend(batch)
            if not batch or len(items) >= total:
                break
            page += 1
        return items

    def sync_favorites(self, kind: str, only_source: str | None = None) -> dict[str, Any]:
        is_performer = kind == "performers"
        records = self.stash.performers() if is_performer else self.stash.studios()
        allow_create = setting_bool(self.settings, "autoCreatePerformers" if is_performer else "autoCreateStudios", False)
        indexed_by_id: dict[tuple[str, str], dict[str, Any]] = {}
        indexed_by_name: dict[str, dict[str, Any]] = {}
        for record in records:
            indexed_by_name.setdefault(str(record.get("name", "")).casefold(), record)
            for stash_id in record.get("stash_ids", []) or []:
                indexed_by_id[(normalize_endpoint(stash_id.get("endpoint")), str(stash_id.get("stash_id", "")))] = record
        source_results = []
        for box in self.boxes:
            if only_source and box["source"] != only_source:
                continue
            try:
                favorites = self.favorite_items(box, kind)
                marked = created = skipped = 0
                for favorite in favorites:
                    if favorite.get("deleted"):
                        skipped += 1
                        continue
                    record = indexed_by_id.get((normalize_endpoint(box["endpoint"]), str(favorite.get("id", ""))))
                    record = record or indexed_by_name.get(str(favorite.get("name", "")).casefold())
                    if record is None:
                        if not allow_create:
                            skipped += 1
                            continue
                        record = self.create_favorite(favorite, box, kind)
                        if record:
                            created += 1
                            indexed_by_name[str(record.get("name", "")).casefold()] = record
                            indexed_by_id[(normalize_endpoint(box["endpoint"]), str(favorite.get("id", "")))] = record
                        else:
                            skipped += 1
                        continue
                    record_ids = [dict(item) for item in record.get("stash_ids", []) or []]
                    id_key = (normalize_endpoint(box["endpoint"]), str(favorite.get("id", "")))
                    has_source_id = id_key in {
                        (normalize_endpoint(item.get("endpoint")), str(item.get("stash_id", ""))) for item in record_ids
                    }
                    if not has_source_id and favorite.get("id"):
                        record_ids.append({"endpoint": box["endpoint"], "stash_id": str(favorite["id"])})
                    if record.get("favorite") and has_source_id:
                        skipped += 1
                        continue
                    if is_performer:
                        update = {"id": str(record["id"]), "favorite": True}
                        if record_ids != (record.get("stash_ids") or []):
                            update["stash_ids"] = record_ids
                        self.stash.update_performer(update)
                    else:
                        update = {"id": str(record["id"]), "favorite": True}
                        if record_ids != (record.get("stash_ids") or []):
                            update["stash_ids"] = record_ids
                        self.stash.update_studio(update)
                    record["favorite"] = True
                    record["stash_ids"] = record_ids
                    marked += 1
                source_results.append({"source": box["source"], "found": len(favorites), "marked": marked, "created": created, "skipped": skipped})
            except Exception as exc:
                source_results.append({"source": box["source"], "ok": False, "error": self.redact(str(exc), box)})
        return {"kind": kind, "sources": source_results,
                "found": sum(item.get("found", 0) for item in source_results),
                "marked": sum(item.get("marked", 0) for item in source_results),
                "created": sum(item.get("created", 0) for item in source_results),
                "skipped": sum(item.get("skipped", 0) for item in source_results)}

    def create_favorite(self, favorite: dict[str, Any], box: dict[str, Any], kind: str) -> dict[str, Any] | None:
        ids = [{"endpoint": box["endpoint"], "stash_id": str(favorite["id"])}]
        urls = external_urls(favorite)
        aliases = clean_strings(favorite.get("aliases", []))
        if kind == "performers":
            full = build_performer_update({"id": "", "name": "", "stash_ids": [], "alias_list": [], "urls": []}, [(box, favorite)], self.settings, creating=True)
            full.update({"favorite": True, "stash_ids": ids})
            full.pop("id", None)
            return self.stash.create_performer(full)
        values: dict[str, Any] = {"name": favorite.get("name", ""), "favorite": True, "stash_ids": ids}
        if aliases:
            values["aliases"] = aliases
        if urls:
            values["urls"] = urls
        return self.stash.create_studio(values)

    def generate_report(self) -> dict[str, Any]:
        performers = self.stash.performers()
        studios = self.stash.studios()
        sources: dict[str, dict[str, int]] = {}
        for box in self.boxes:
            endpoint = normalize_endpoint(box["endpoint"])
            sources[box["source"]] = {
                "performers": sum(1 for item in performers if any(normalize_endpoint(sid.get("endpoint")) == endpoint for sid in item.get("stash_ids", []) or [])),
                "studios": sum(1 for item in studios if any(normalize_endpoint(sid.get("endpoint")) == endpoint for sid in item.get("stash_ids", []) or [])),
            }
        return {"performers": len(performers), "favorite_performers": sum(bool(item.get("favorite")) for item in performers),
                "studios": len(studios), "favorite_studios": sum(bool(item.get("favorite")) for item in studios), "source_coverage": sources}


def clean_strings(values: Any) -> list[str]:
    if not isinstance(values, (list, tuple)):
        return []
    seen: set[str] = set()
    result = []
    for value in values:
        if not isinstance(value, str):
            continue
        value = value.strip()
        key = value.casefold()
        if value and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def external_urls(record: dict[str, Any]) -> list[str]:
    urls = []
    for item in record.get("urls", []) or []:
        value = item.get("url") if isinstance(item, dict) else item
        if isinstance(value, str) and value.strip():
            urls.append(value.strip())
    return clean_strings(urls)


def gender_value(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).upper()
    if text in {"MALE", "TRANSGENDER_MALE"}:
        return "MALE"
    if text in {"FEMALE", "TRANSGENDER_FEMALE"}:
        return "FEMALE"
    return None


def measurement_value(record: dict[str, Any]) -> str | None:
    measurements = record.get("measurements") or {}
    if isinstance(measurements, str):
        return measurements.strip() or None
    if not isinstance(measurements, dict):
        return None
    cup = measurements.get("cup_size") or record.get("cup_size") or ""
    band = measurements.get("band_size") or record.get("band_size") or ""
    waist = measurements.get("waist") or record.get("waist_size") or ""
    hip = measurements.get("hip") or record.get("hip_size") or ""
    if not any((cup, band, waist, hip)):
        return None
    bust = f"{cup}{band}"
    if not bust:
        bust = str(band)
    elif cup and band:
        bust = f"{cup}{band}"
    parts = [bust]
    if waist or hip:
        parts.extend((str(waist), str(hip)))
    return "-".join(part for part in parts if part)


def body_modifications(values: Any) -> str | None:
    if isinstance(values, str):
        return values.strip() or None
    if not isinstance(values, list):
        return None
    entries = []
    for item in values:
        if not isinstance(item, dict):
            continue
        description = str(item.get("description") or "").strip()
        location = str(item.get("location") or "").strip()
        text = f"{location}: {description}" if location and description else (description or location)
        if text:
            entries.append(text)
    return ", ".join(clean_strings(entries)) or None


def map_external_performer(record: dict[str, Any]) -> dict[str, Any]:
    mapped: dict[str, Any] = {}
    if isinstance(record.get("name"), str) and record["name"].strip():
        mapped["name"] = record["name"].strip()
    simple = {
        "disambiguation": record.get("disambiguation"),
        "birthdate": record.get("birth_date") or record.get("birthdate"),
        "death_date": record.get("death_date"),
        "ethnicity": record.get("ethnicity"),
        "country": record.get("country"),
        "eye_color": record.get("eye_color"),
        "hair_color": record.get("hair_color"),
        "height_cm": record.get("height") or record.get("height_cm"),
        "measurements": measurement_value(record),
        "fake_tits": record.get("breast_type") or record.get("fake_tits"),
        "career_start": record.get("career_start_year") or record.get("career_start"),
        "career_end": record.get("career_end_year") or record.get("career_end"),
        "tattoos": body_modifications(record.get("tattoos")),
        "piercings": body_modifications(record.get("piercings")),
    }
    for key, value in simple.items():
        if value is None or value == "":
            continue
        if key == "height_cm":
            try:
                value = int(value)
            except (TypeError, ValueError):
                continue
        elif key in {"career_start", "career_end"}:
            try:
                value = str(int(value))
            except (TypeError, ValueError):
                continue
        elif key in {"birthdate", "death_date"}:
            value = str(value)
            if not re.match(r"^\d{4}(?:-\d{2}(?:-\d{2})?)?$", value):
                continue
        else:
            value = str(value).strip()
            if not value:
                continue
        mapped[key] = value
    gender = gender_value(record.get("gender"))
    if gender:
        mapped["gender"] = gender
    aliases = clean_strings(record.get("aliases", []))
    if aliases:
        mapped["alias_list"] = aliases
    urls = external_urls(record)
    if urls:
        mapped["urls"] = urls
    images = [item for item in record.get("images", []) or [] if isinstance(item, dict) and item.get("url")]
    if images:
        image = max(images, key=lambda item: int(item.get("width") or 0) * int(item.get("height") or 0))
        mapped["image"] = str(image["url"])
    return mapped


def build_performer_update(local: dict[str, Any], sources: list[tuple[dict[str, Any], dict[str, Any]]],
                           settings: dict[str, Any], *, creating: bool = False) -> dict[str, Any]:
    overwrite = setting_bool(settings, "overwriteExisting", False)
    merged: dict[str, Any] = {}
    # The list is already ordered from highest to lowest priority.
    for _box, external in reversed(sources):
        merged.update(map_external_performer(external))
    values: dict[str, Any] = {"id": str(local.get("id", ""))} if not creating else {}
    scalar_fields = ("disambiguation", "gender", "birthdate", "death_date", "ethnicity", "country", "eye_color",
                     "hair_color", "height_cm", "measurements", "fake_tits", "career_start", "career_end", "tattoos", "piercings")
    for key in scalar_fields:
        new_value = merged.get(key)
        old_value = local.get(key)
        if new_value is not None and (overwrite or old_value in (None, "")):
            values[key] = new_value
    if merged.get("name") and (creating or overwrite or not local.get("name")):
        values["name"] = merged["name"]
    aliases = clean_strings((local.get("alias_list") or []) + merged.get("alias_list", []))
    if aliases and (creating or aliases != clean_strings(local.get("alias_list", []))):
        values["alias_list"] = aliases
    urls = clean_strings((local.get("urls") or []) + merged.get("urls", []))
    if urls and (creating or urls != clean_strings(local.get("urls", []))):
        values["urls"] = urls
    current_ids = [dict(item) for item in local.get("stash_ids", []) or []]
    id_keys = {(normalize_endpoint(item.get("endpoint")), str(item.get("stash_id", ""))) for item in current_ids}
    for box, external in sources:
        external_id = str(external.get("id", ""))
        key = (normalize_endpoint(box.get("endpoint")), external_id)
        if external_id and key not in id_keys:
            current_ids.append({"endpoint": box["endpoint"], "stash_id": external_id})
            id_keys.add(key)
    if current_ids and (creating or current_ids != (local.get("stash_ids") or [])):
        values["stash_ids"] = current_ids
    image = merged.get("image")
    if image and setting_bool(settings, "performerImageUpdate", True) and (creating or overwrite or not local.get("image_path")):
        values["image"] = image
    return values


def cache_path(server_connection: dict[str, Any]) -> Path:
    plugin_dir = str(server_connection.get("PluginDir") or "").strip()
    if plugin_dir:
        base = Path(plugin_dir)
    else:
        base = Path.home() / ".stash" / "plugins" / PLUGIN_ID
    try:
        base.mkdir(parents=True, exist_ok=True)
        return base / "cache" / "responses.sqlite3"
    except OSError:
        import tempfile
        return Path(tempfile.gettempdir()) / PLUGIN_ID / "responses.sqlite3"


def execute(input_data: dict[str, Any]) -> dict[str, Any]:
    args = input_data.get("args") or {}
    mode = str(args.get("mode") or "")
    connection = input_data.get("server_connection") or {}
    cache = ResponseCache(cache_path(connection))
    if mode == "clear_cache":
        return {"output": {"removed": cache.clear(), "message": "StashBox response cache cleared."}}
    stash = LocalStash(connection)
    configuration = stash.configuration()
    # Cache lifetime is read from the plugin settings returned by Stash. Reopen with the requested TTL.
    settings = configuration.get("plugins", {}).get(PLUGIN_ID, {}) or {}
    cache = ResponseCache(cache.path, float(settings.get("cacheExpirationHours", DEFAULT_SETTINGS["cacheExpirationHours"])))
    service = SyncService(stash, configuration, cache)
    if mode == "validate_config":
        result = service.validate_config()
    elif mode == "test_connections":
        result = service.test_connections()
    elif mode == "update_all_performers":
        result = service.update_all_performers()
    elif mode == "update_single_performer":
        performer_id = args.get("performer_id") or args.get("performerId") or args.get("id")
        if performer_id is None:
            raise PluginError("The update_single_performer task requires performer_id")
        result = service.sync_single_performer(str(performer_id))
    elif mode in {"sync_favorite_performers", "sync_stashdb_favorites", "sync_tpdb_favorites", "sync_fansdb_favorites"}:
        source = {"sync_stashdb_favorites": "stashdb", "sync_tpdb_favorites": "tpdb", "sync_fansdb_favorites": "fansdb"}.get(mode)
        result = service.sync_favorites("performers", source)
    elif mode in {"sync_favorite_studios", "sync_all_favorite_sites", "sync_stashdb_sites", "sync_tpdb_sites", "sync_fansdb_sites"}:
        source = {"sync_stashdb_sites": "stashdb", "sync_tpdb_sites": "tpdb", "sync_fansdb_sites": "fansdb"}.get(mode)
        result = service.sync_favorites("studios", source)
    elif mode == "generate_sync_report":
        result = service.generate_report()
    else:
        raise PluginError(f"Unknown task mode: {mode or '(empty)'}")
    return {"output": result}


def main() -> None:
    try:
        input_data = json.loads(sys.stdin.read() or "{}")
        output = execute(input_data)
    except Exception as exc:
        output = {"error": str(exc)}
    sys.stdout.write(json.dumps(output, ensure_ascii=False) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
