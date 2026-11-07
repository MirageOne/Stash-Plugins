#!/usr/bin/env python3
"""Stash Metadata Sync, implemented for Stash's 0.32 raw-plugin API."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


PLUGIN_ID = "stash-metadata-sync"
PAGE_SIZE = 100
TAG_PAGE_SIZE = 1000
MAX_TAG_PAGES = 500
SCENE_BATCH_SIZE = 100
DRY_RUN_SCENE_LIMIT = 200
MAX_IMAGE_INSPECTION_BYTES = 8 * 1024 * 1024
MAX_GROUP_IMAGE_BYTES = 10 * 1024 * 1024
PROGRESS_PREFIX = "\x01p\x02"
INFO_PREFIX = "\x01i\x02"
TPDB_API_BASE = "https://api.theporndb.net/scenes/"
USER_AGENT = "MirageOne-Stash-Metadata-Sync/1.0.4"
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
LOCAL_TAG_FIELDS = "id name description aliases stash_ids { endpoint stash_id }"
LOCAL_SCENE_FIELDS = """
  id title tags { id name } stash_ids { endpoint stash_id }
"""
LOCAL_SCENE_MARKER_FIELDS = """
  id title tags { id name } stash_ids { endpoint stash_id } files { duration }
  scene_markers { id title seconds end_seconds primary_tag { id name } tags { id name } }
"""
LOCAL_SCENE_GROUP_FIELDS = """
  id title stash_ids { endpoint stash_id }
  groups { scene_index group { id name urls } }
"""
LOCAL_GROUP_FIELDS = """
  id name date synopsis urls front_image_path back_image_path
  studio { id name }
"""
STASHBOX_TAG_FIELDS = "id name description aliases category { id name group }"
STASHBOX_SCENE_FIELDS = "id tags { id name aliases }"


class PluginError(RuntimeError):
    pass


def is_tpdb_image_url(value: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(str(value or "").strip())
        host = (parsed.hostname or "").lower().rstrip(".")
    except ValueError:
        return False
    return (parsed.scheme.lower() == "https" and not parsed.username and not parsed.password
            and (host == "theporndb.net" or host.endswith(".theporndb.net")))


class TPDBImageRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Keep cover-image redirects inside the trusted ThePornDB image domain."""

    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        if not is_tpdb_image_url(new_url):
            raise urllib.error.HTTPError(request.full_url, code, "image redirect left the ThePornDB domain", headers,
                                         file_pointer)
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


def report_progress(completed: int, total: int) -> None:
    """Send progress using Stash's raw-plugin stderr protocol, not a plain error log."""
    if total <= 0:
        return
    fraction = min(1.0, max(0.0, completed / total))
    print(f"{PROGRESS_PREFIX}{fraction}", file=sys.stderr, flush=True)


def log_info(message: str) -> None:
    """Write an INFO record using Stash's raw-plugin stderr log protocol."""
    safe_message = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", str(message))).strip()
    if safe_message:
        print(f"{INFO_PREFIX}{safe_message[:1000]}", file=sys.stderr, flush=True)


def image_dimensions_from_bytes(data: bytes) -> tuple[int, int] | None:
    """Read dimensions from common image headers without adding a package dependency."""
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
    if data[:3] == b"GIF" and len(data) >= 10:
        return int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little")
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X" and len(data) >= 30:
            width = 1 + int.from_bytes(data[24:27], "little")
            height = 1 + int.from_bytes(data[27:30], "little")
            return width, height
        if chunk == b"VP8 " and len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
            width = int.from_bytes(data[26:28], "little") & 0x3FFF
            height = int.from_bytes(data[28:30], "little") & 0x3FFF
            return width, height
        if chunk == b"VP8L" and len(data) >= 25 and data[20] == 0x2F:
            bits = int.from_bytes(data[21:25], "little")
            return 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
    if data.startswith(b"\xff\xd8"):
        sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                       0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
        offset = 2
        while offset + 4 <= len(data):
            if data[offset] != 0xFF:
                offset += 1
                continue
            while offset < len(data) and data[offset] == 0xFF:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            if marker in {0xD8, 0xD9, 0x01, *range(0xD0, 0xD8)}:
                continue
            if offset + 2 > len(data):
                break
            segment_length = int.from_bytes(data[offset:offset + 2], "big")
            if segment_length < 2 or offset + segment_length > len(data):
                break
            if marker in sof_markers and segment_length >= 7:
                height = int.from_bytes(data[offset + 3:offset + 5], "big")
                width = int.from_bytes(data[offset + 5:offset + 7], "big")
                return width, height
            if marker == 0xDA:
                break
            offset += segment_length
    return None


def group_image_mime_type(data: bytes) -> str | None:
    """Identify formats supported by Stash before embedding a downloaded cover."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def is_group_image_error(error: Exception) -> bool:
    return "image" in str(error).casefold()


def image_dimensions(image: dict[str, Any]) -> tuple[int, int] | None:
    try:
        width = int(image.get("width") or 0)
        height = int(image.get("height") or 0)
    except (TypeError, ValueError):
        return None
    return (width, height) if width > 0 and height > 0 else None


def image_quality_key(width: int, height: int) -> tuple[int, int, int]:
    return width * height, min(width, height), max(width, height)


def image_candidate_id(endpoint: str, url: str, width: int, height: int) -> str:
    material = json.dumps([normalize_endpoint(endpoint), url, width, height], separators=(",", ":"))
    return hashlib.sha256(material.encode()).hexdigest()[:24]


def image_meets_quality_minimum(width: int, height: int, settings: dict[str, Any]) -> bool:
    try:
        minimum_megapixels = float(settings.get("imageMinimumMegapixels", 0.5))
        minimum_long_edge = int(settings.get("imageMinimumLongEdge", 800))
    except (TypeError, ValueError):
        minimum_megapixels, minimum_long_edge = 0.5, 800
    if not math.isfinite(minimum_megapixels):
        minimum_megapixels = 0.5
    minimum_megapixels = max(0.0, minimum_megapixels)
    minimum_long_edge = max(0, minimum_long_edge)
    return width * height >= minimum_megapixels * 1_000_000 and max(width, height) >= minimum_long_edge


def normalize_endpoint(value: Any) -> str:
    return str(value or "").strip().rstrip("/").lower()


def normalize_url(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urllib.parse.urlsplit(text)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return ""
    path = parsed.path.rstrip("/")
    return urllib.parse.urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, parsed.query, parsed.fragment))


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


def build_local_tag_index(tags: list[dict[str, Any]]) -> dict[str, Any]:
    by_stash_id: dict[tuple[str, str], list[dict[str, Any]]] = {}
    by_name: dict[str, list[dict[str, Any]]] = {}
    by_alias: dict[str, list[dict[str, Any]]] = {}
    for tag in tags:
        name = str(tag.get("name") or "").strip().casefold()
        if name:
            by_name.setdefault(name, []).append(tag)
        for alias in clean_strings(tag.get("aliases", [])):
            by_alias.setdefault(alias.casefold(), []).append(tag)
        for stash_id in tag.get("stash_ids", []) or []:
            endpoint = normalize_endpoint(stash_id.get("endpoint"))
            external_id = str(stash_id.get("stash_id") or "")
            if endpoint and external_id:
                by_stash_id.setdefault((endpoint, external_id), []).append(tag)
    return {"by_stash_id": by_stash_id, "by_name": by_name, "by_alias": by_alias}


def build_local_group_index(groups: list[dict[str, Any]]) -> dict[str, Any]:
    by_url: dict[str, list[dict[str, Any]]] = {}
    by_name: dict[str, list[dict[str, Any]]] = {}
    for group in groups:
        name = str(group.get("name") or "").strip().casefold()
        if name:
            by_name.setdefault(name, []).append(group)
        for url in clean_strings(group.get("urls", [])):
            normalized = normalize_url(url)
            if normalized:
                by_url.setdefault(normalized, []).append(group)
    return {"by_url": by_url, "by_name": by_name}


def tpdb_group_records(scene: dict[str, Any]) -> list[dict[str, Any]]:
    """Accept both current TPDB `movies` and older/alternate `groups` payloads."""
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for key in ("groups", "movies"):
        values = scene.get(key) or []
        if not isinstance(values, list):
            continue
        for value in values:
            if not isinstance(value, dict):
                continue
            urls = external_urls(value)
            identity = (normalize_url(urls[0]) if urls else "") or str(value.get("id") or "").strip()
            if not identity:
                identity = "|".join((str(value.get("title") or value.get("name") or "").strip().casefold(),
                                     str(value.get("date") or "").strip()))
            if not identity or identity in seen:
                continue
            seen.add(identity)
            records.append(value)
    return records


def match_tpdb_group(remote: dict[str, Any], index: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    """Match by stable TPDB URL, then by unique exact title for URL-less records."""
    urls = [url for url in external_urls(remote) if normalize_url(url)]
    for url in urls:
        candidates = index["by_url"].get(normalize_url(url), [])
        if len(candidates) == 1:
            return candidates[0], "url"
        if len(candidates) > 1:
            return None, "ambiguous_url"
    name = str(remote.get("title") or remote.get("name") or "").strip().casefold()
    if not name:
        return None, "no_name"
    candidates = index["by_name"].get(name, [])
    if len(candidates) == 1:
        return candidates[0], "name"
    if len(candidates) > 1:
        return None, "ambiguous_name"
    return None, "unmatched"


def tpdb_site_name(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("name") or value.get("title")
    return str(value or "").strip()


def match_tpdb_studio_id(site: Any, studios: list[dict[str, Any]]) -> str | None:
    name = tpdb_site_name(site).casefold()
    if not name:
        return None
    matches = []
    for studio in studios:
        names = [studio.get("name"), *(studio.get("aliases") or [])]
        if name in {str(value or "").strip().casefold() for value in names if str(value or "").strip()}:
            matches.append(studio)
    if len(matches) == 1:
        return str(matches[0]["id"])
    return None


def build_tpdb_group_values(remote: dict[str, Any], studios: list[dict[str, Any]]) -> dict[str, Any]:
    name = str(remote.get("title") or remote.get("name") or "").strip()
    if not name:
        return {}
    values: dict[str, Any] = {"name": name}
    date = str(remote.get("date") or "").strip()
    if date and re.fullmatch(r"\d{4}(?:-\d{2}(?:-\d{2})?)?", date):
        values["date"] = date
    synopsis = str(remote.get("description") or remote.get("synopsis") or "").strip()
    if synopsis:
        values["synopsis"] = synopsis
    urls = [url for url in external_urls(remote) if normalize_url(url)]
    if urls:
        values["urls"] = urls
    front_image = str(remote.get("image") or remote.get("front_image") or "").strip()
    back_image = str(remote.get("back_image") or "").strip()
    if front_image.startswith(("http://", "https://")):
        values["front_image"] = front_image
    if back_image.startswith(("http://", "https://")):
        values["back_image"] = back_image
    studio_id = match_tpdb_studio_id(remote.get("site"), studios)
    if studio_id:
        values["studio_id"] = studio_id
    return values


def build_group_update(local: dict[str, Any], remote: dict[str, Any], studios: list[dict[str, Any]],
                       settings: dict[str, Any]) -> dict[str, Any]:
    """Fill missing group metadata and merge the TPDB URL without replacing local values."""
    incoming = build_tpdb_group_values(remote, studios)
    if not incoming:
        return {"id": str(local["id"])}
    values: dict[str, Any] = {"id": str(local["id"])}
    overwrite = setting_bool(settings, "overwriteGroupMetadata", False)
    for key in ("date", "synopsis"):
        new_value = incoming.get(key)
        old_value = local.get(key)
        if new_value and (overwrite or old_value in (None, "")) and new_value != old_value:
            values[key] = new_value
    for input_key, local_key in (("front_image", "front_image_path"), ("back_image", "back_image_path")):
        new_value = incoming.get(input_key)
        old_value = local.get(local_key)
        if new_value and (overwrite or old_value in (None, "")):
            values[input_key] = new_value
    urls = clean_strings(local.get("urls") or [])
    seen_urls = {normalize_url(url) for url in urls if normalize_url(url)}
    for url in incoming.get("urls", []):
        normalized = normalize_url(url)
        if normalized and normalized not in seen_urls:
            urls.append(url)
            seen_urls.add(normalized)
    if urls != clean_strings(local.get("urls", [])):
        values["urls"] = urls
    if not local.get("studio") and incoming.get("studio_id"):
        values["studio_id"] = incoming["studio_id"]
    return values


def match_remote_tag_to_local(remote: dict[str, Any], index: dict[str, Any], endpoint: str) -> tuple[dict[str, Any] | None, str]:
    """Match an external tag conservatively, preferring its endpoint-specific ID."""
    external_id = str(remote.get("id") or "")
    endpoint_key = normalize_endpoint(endpoint)
    if external_id:
        direct = index["by_stash_id"].get((endpoint_key, external_id), [])
        if len(direct) == 1:
            return direct[0], "stash_id"
        if len(direct) > 1:
            return None, "ambiguous_stash_id"

    name_key = str(remote.get("name") or "").strip().casefold()
    if not name_key:
        return None, "no_name"
    for source in (index["by_name"], index["by_alias"]):
        candidates = source.get(name_key, [])
        eligible = []
        for candidate in candidates:
            endpoint_ids = {
                str(item.get("stash_id") or "")
                for item in candidate.get("stash_ids", []) or []
                if normalize_endpoint(item.get("endpoint")) == endpoint_key and item.get("stash_id")
            }
            if not endpoint_ids or external_id in endpoint_ids:
                eligible.append(candidate)
        if len(eligible) == 1:
            return eligible[0], "name" if source is index["by_name"] else "alias"
        if len(eligible) > 1:
            return None, "ambiguous_name" if source is index["by_name"] else "ambiguous_alias"
    return None, "unmatched"


def build_tag_update(local: dict[str, Any], sources: list[tuple[dict[str, Any], dict[str, Any]]],
                     settings: dict[str, Any], local_tags: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Merge external descriptions, aliases, and IDs without changing local data by default."""
    values: dict[str, Any] = {"id": str(local["id"])}
    overwrite = setting_bool(settings, "overwriteTagMetadata", False)
    descriptions = [str(remote.get("description") or "").strip() for _box, remote in sources]
    description = next((item for item in descriptions if item), "")
    if description and (overwrite or not str(local.get("description") or "").strip()):
        if description != str(local.get("description") or "").strip():
            values["description"] = description

    current_name = str(local.get("name") or "").strip()
    remote_name = next((str(remote.get("name") or "").strip() for _box, remote in sources
                        if str(remote.get("name") or "").strip()), "")
    rename = setting_bool(settings, "overwriteTagNames", False) and bool(remote_name) and remote_name != current_name
    if rename:
        target_name = remote_name.casefold()
        conflicts = any(
            str(tag.get("id")) != str(local.get("id")) and target_name in {
                str(value).strip().casefold()
                for value in [tag.get("name"), *(tag.get("aliases") or [])]
                if str(value or "").strip()
            }
            for tag in local_tags or []
        )
        if not conflicts:
            values["name"] = remote_name
        else:
            rename = False

    # Preserve local aliases, but avoid introducing aliases that collide with
    # another tag or make this tag an alias of its own final name.
    final_name = (remote_name if rename else current_name).casefold()
    original_aliases = clean_strings(local.get("aliases") or [])
    aliases = [alias for alias in original_aliases if alias.casefold() != final_name]
    blocked_aliases = {
        str(value).strip().casefold()
        for tag in local_tags or [] if str(tag.get("id")) != str(local.get("id"))
        for value in [tag.get("name"), *(tag.get("aliases") or [])]
        if str(value or "").strip()
    }
    additions = ([current_name] if rename and current_name else []) + [
        alias
        for _box, remote in sources
        for alias in clean_strings(remote.get("aliases", []))
    ]
    alias_keys = {alias.casefold() for alias in aliases}
    for alias in additions:
        key = alias.casefold()
        if key == final_name or key in blocked_aliases or key in alias_keys:
            continue
        aliases.append(alias)
        alias_keys.add(key)
    if aliases != clean_strings(local.get("aliases", [])):
        values["aliases"] = aliases

    stash_ids = [dict(item) for item in local.get("stash_ids", []) or []]
    linked = {(normalize_endpoint(item.get("endpoint")), str(item.get("stash_id") or "")) for item in stash_ids}
    existing_endpoints = {endpoint for endpoint, _external_id in linked}
    for box, remote in sources:
        external_id = str(remote.get("id") or "")
        endpoint = normalize_endpoint(box.get("endpoint"))
        if not external_id or (endpoint, external_id) in linked:
            continue
        # Never replace a different StashBox ID already linked to this local tag.
        if endpoint in existing_endpoints:
            continue
        stash_ids.append({"endpoint": str(box["endpoint"]), "stash_id": external_id})
        linked.add((endpoint, external_id))
        existing_endpoints.add(endpoint)
    if stash_ids != (local.get("stash_ids") or []):
        values["stash_ids"] = stash_ids
    return values


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


class SceneTagSyncHistory:
    """Remember source tags applied to a local scene so removed tags stay removed."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute("""CREATE TABLE IF NOT EXISTS scene_tags (
                endpoint TEXT NOT NULL,
                scene_id TEXT NOT NULL,
                remote_scene_id TEXT NOT NULL,
                remote_tag_ids TEXT NOT NULL,
                PRIMARY KEY (endpoint, scene_id, remote_scene_id)
            )""")

    def get(self, endpoint: str, scene_id: str, remote_scene_id: str) -> set[str] | None:
        with sqlite3.connect(self.path) as db:
            row = db.execute(
                "SELECT remote_tag_ids FROM scene_tags WHERE endpoint = ? AND scene_id = ? AND remote_scene_id = ?",
                (normalize_endpoint(endpoint), str(scene_id), str(remote_scene_id)),
            ).fetchone()
        return set(json.loads(row[0])) if row else None

    def record(self, endpoint: str, scene_id: str, remote_scene_id: str, remote_tag_ids: set[str]) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT OR REPLACE INTO scene_tags(endpoint, scene_id, remote_scene_id, remote_tag_ids) VALUES (?, ?, ?, ?)",
                (normalize_endpoint(endpoint), str(scene_id), str(remote_scene_id), json.dumps(sorted(remote_tag_ids))),
            )

    def clear(self) -> int:
        with sqlite3.connect(self.path) as db:
            count = db.execute("SELECT COUNT(*) FROM scene_tags").fetchone()[0]
            db.execute("DELETE FROM scene_tags")
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
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        }
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


class TPDBMarkersTransport:
    """Fetch ThePornDB's REST marker data using the configured TPDB API key."""

    def __init__(self, api_key: str, *, cache: ResponseCache | None = None,
                 min_delay: float = 0, max_requests_per_minute: int | None = None,
                 timeout: float = 25) -> None:
        self.api_key = api_key
        self.cache = cache
        rpm_delay = 60 / max(1, int(max_requests_per_minute or 240))
        self.request_delay = max(0, float(min_delay), rpm_delay)
        self.timeout = timeout
        self.last_request = 0.0

    def scene(self, scene_id: str) -> dict[str, Any]:
        scene_id = str(scene_id).strip()
        if not scene_id:
            raise PluginError("ThePornDB scene ID is empty")
        cache_material = json.dumps([
            "tpdb-markers", hashlib.sha256(self.api_key.encode()).hexdigest(), scene_id,
        ])
        cache_key = hashlib.sha256(cache_material.encode()).hexdigest()
        if self.cache:
            cached = self.cache.get(cache_key)
            if cached is not None:
                return cached

        url = TPDB_API_BASE + urllib.parse.quote(scene_id, safe="")
        request = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": USER_AGENT,
        })
        last_error: Exception | None = None
        for attempt in range(3):
            delay = self.request_delay - (time.monotonic() - self.last_request)
            if delay > 0:
                time.sleep(delay)
            self.last_request = time.monotonic()
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                if payload.get("errors"):
                    messages = "; ".join(str(item.get("message", "API error")) for item in payload["errors"][:3])
                    raise PluginError(f"ThePornDB marker request failed: {messages}")
                scene = payload.get("data", payload)
                if isinstance(scene, dict) and isinstance(scene.get("scene"), dict):
                    scene = scene["scene"]
                if not isinstance(scene, dict):
                    raise PluginError("ThePornDB returned an invalid scene response")
                markers = scene.get("markers", [])
                if markers is None:
                    markers = []
                if not isinstance(markers, list):
                    raise PluginError("ThePornDB returned an invalid markers list")
                result = {**scene, "markers": markers}
                if self.cache:
                    self.cache.put(cache_key, result)
                return result
            except urllib.error.HTTPError as exc:
                last_error = exc
                retryable = exc.code == 429 or 500 <= exc.code <= 599
                if not retryable or attempt == 2:
                    raise PluginError(f"ThePornDB marker request returned HTTP {exc.code}") from exc
                retry_after = exc.headers.get("Retry-After", "")
                try:
                    backoff = max(float(retry_after), 2 ** attempt)
                except ValueError:
                    backoff = 2 ** attempt
                time.sleep(min(30, backoff))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
                if attempt == 2:
                    raise PluginError(f"ThePornDB marker request failed: {exc}") from exc
                time.sleep(2 ** attempt)
        raise PluginError(f"ThePornDB marker request failed: {last_error}")


class LocalStash:
    def __init__(self, server_connection: dict[str, Any]) -> None:
        scheme = str(server_connection.get("Scheme") or "http")
        host = str(server_connection.get("Host") or "localhost")
        port = server_connection.get("Port") or 9999
        self.base_url = f"{scheme}://{host}:{port}"
        self.endpoint = f"{self.base_url}/graphql"
        session_cookie = server_connection.get("SessionCookie") or {}
        self.cookie_name = session_cookie.get("Name") or "session"
        self.cookie = session_cookie.get("Value", "")

    def performer_image_dimensions(self, performer_id: str) -> tuple[int, int] | None:
        url = f"{self.base_url}/performer/{urllib.parse.quote(str(performer_id), safe='')}"
        headers = {"Accept": "image/avif,image/webp,image/*,*/*;q=0.8"}
        if self.cookie:
            headers["Cookie"] = f"{self.cookie_name}={self.cookie}"
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return image_dimensions_from_bytes(response.read(MAX_IMAGE_INSPECTION_BYTES))
        except (urllib.error.URLError, TimeoutError, OSError):
            return None

    def _download_tpdb_group_image(self, url: str) -> str:
        if not is_tpdb_image_url(url):
            raise PluginError("image URL is not an HTTPS ThePornDB host")
        try:
            request = urllib.request.Request(url, headers={
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": "https://theporndb.net/",
                "User-Agent": USER_AGENT,
            })
            opener = urllib.request.build_opener(TPDBImageRedirectHandler())
            with opener.open(request, timeout=30) as response:
                content_type = str(response.headers.get("Content-Type", "")).split(";", 1)[0].strip().lower()
                payload = response.read(MAX_GROUP_IMAGE_BYTES + 1)
        except urllib.error.HTTPError as exc:
            status = exc.code
            exc.close()
            raise PluginError(f"image host returned HTTP {status}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise PluginError(f"image download failed: {getattr(exc, 'reason', exc)}") from exc
        except (ValueError, UnicodeError) as exc:
            raise PluginError("image URL is invalid") from exc

        if len(payload) > MAX_GROUP_IMAGE_BYTES:
            raise PluginError(f"image exceeds the {MAX_GROUP_IMAGE_BYTES // (1024 * 1024)} MiB limit")
        mime_type = group_image_mime_type(payload)
        if not mime_type:
            description = content_type or "unknown content"
            raise PluginError(f"server returned {description} instead of a supported image")
        if content_type and not content_type.startswith("image/") and content_type != "application/octet-stream":
            raise PluginError(f"server returned {content_type} instead of an image")
        return f"data:{mime_type};base64,{base64.b64encode(payload).decode('ascii')}"

    def _prepare_group_images(self, values: dict[str, Any]) -> dict[str, Any]:
        prepared = dict(values)
        group_name = str(prepared.get("name") or prepared.get("id") or "unknown group")
        for field, label in (("front_image", "front"), ("back_image", "back")):
            url = prepared.get(field)
            if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
                continue
            try:
                prepared[field] = self._download_tpdb_group_image(url)
            except PluginError as exc:
                prepared.pop(field, None)
                try:
                    host = urllib.parse.urlsplit(url).hostname or "image host"
                except ValueError:
                    host = "image host"
                log_info(f"Skipped {label} image for group {group_name} from {host}: {exc}.")
        return prepared

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
        data = self.query(f"""query StashMetadataSyncConfig {{
          configuration {{ general {{ stashBoxes {{ endpoint api_key name max_requests_per_minute }} }}
            plugins(include: [\"{PLUGIN_ID}\"]) }}
        }}""")
        return data["configuration"]

    def performers(self) -> list[dict[str, Any]]:
        data = self.query(f"""query StashMetadataSyncPerformers {{
          findPerformers(filter: {{ per_page: -1 }}) {{ count performers {{ {LOCAL_PERFORMER_FIELDS} }} }}
        }}""")
        return data["findPerformers"]["performers"]

    def performer(self, performer_id: str) -> dict[str, Any] | None:
        data = self.query(f"""query StashMetadataSyncPerformer($id: ID!) {{
          findPerformer(id: $id) {{ {LOCAL_PERFORMER_FIELDS} }}
        }}""", {"id": str(performer_id)})
        return data.get("findPerformer")

    def studios(self) -> list[dict[str, Any]]:
        data = self.query(f"""query StashMetadataSyncStudios {{
          findStudios(filter: {{ per_page: -1 }}) {{ count studios {{ {LOCAL_STUDIO_FIELDS} }} }}
        }}""")
        return data["findStudios"]["studios"]

    def tags(self) -> list[dict[str, Any]]:
        data = self.query(f"""query StashBoxMetadataSyncTags {{
          findTags(filter: {{ per_page: -1 }}) {{ count tags {{ {LOCAL_TAG_FIELDS} }} }}
        }}""")
        return data["findTags"]["tags"]

    def groups(self) -> list[dict[str, Any]]:
        data = self.query(f"""query StashBoxMetadataSyncGroups {{
          findGroups(filter: {{ per_page: -1 }}) {{ count groups {{ {LOCAL_GROUP_FIELDS} }} }}
        }}""")
        return data["findGroups"]["groups"]

    def scenes_for_box(self, endpoint: str, *, include_markers: bool = False,
                       include_groups: bool = False) -> list[dict[str, Any]]:
        fields = (LOCAL_SCENE_MARKER_FIELDS if include_markers else
                  LOCAL_SCENE_GROUP_FIELDS if include_groups else LOCAL_SCENE_FIELDS)
        document = f"""query StashBoxMetadataSyncScenes($filter: FindFilterType!, $scene_filter: SceneFilterType!) {{
          findScenes(filter: $filter, scene_filter: $scene_filter) {{ count scenes {{ {fields} }} }}
        }}"""
        scenes: list[dict[str, Any]] = []
        page = 1
        while True:
            data = self.query(document, {
                "filter": {"page": page, "per_page": PAGE_SIZE, "sort": "updated_at", "direction": "ASC"},
                "scene_filter": {
                    "stash_ids_endpoint": {"endpoint": endpoint, "modifier": "NOT_NULL"},
                },
            })
            result = data.get("findScenes") or {}
            batch = result.get("scenes") or []
            scenes.extend(batch)
            count = int(result.get("count", len(scenes)))
            if not batch or len(scenes) >= count or len(batch) < PAGE_SIZE:
                return scenes
            page += 1

    def update_tag(self, values: dict[str, Any]) -> None:
        self.query("""mutation StashBoxMetadataSyncUpdateTag($input: TagUpdateInput!) {
          tagUpdate(input: $input) { id }
        }""", {"input": values})

    def create_tag(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self.query("""mutation StashBoxMetadataSyncCreateTag($input: TagCreateInput!) {
          tagCreate(input: $input) { id name aliases stash_ids { endpoint stash_id } }
        }""", {"input": values})
        return data["tagCreate"]

    def add_scene_tags(self, scene_id: str, tag_ids: list[str]) -> None:
        self.query("""mutation StashBoxMetadataSyncAddSceneTags($input: BulkSceneUpdateInput!) {
          bulkSceneUpdate(input: $input) { id }
        }""", {"input": {
            "ids": [str(scene_id)],
            "tag_ids": {"ids": [str(tag_id) for tag_id in tag_ids], "mode": "ADD"},
        }})

    def create_scene_marker(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self.query("""mutation StashBoxMetadataSyncCreateMarker($input: SceneMarkerCreateInput!) {
          sceneMarkerCreate(input: $input) { id title seconds primary_tag { id name } }
        }""", {"input": values})
        return data["sceneMarkerCreate"]

    def create_group(self, values: dict[str, Any]) -> dict[str, Any]:
        query = f"""mutation StashBoxMetadataSyncCreateGroup($input: GroupCreateInput!) {{
          groupCreate(input: $input) {{ {LOCAL_GROUP_FIELDS} }}
        }}"""
        prepared = self._prepare_group_images(values)
        try:
            return self.query(query, {"input": prepared})["groupCreate"]
        except PluginError as exc:
            if (not is_group_image_error(exc)
                    or not any(prepared.get(field) for field in ("front_image", "back_image"))):
                raise
            without_images = {key: value for key, value in prepared.items()
                              if key not in {"front_image", "back_image"}}
            log_info(f"Stash rejected the cover image for group {values.get('name') or 'unknown group'}; "
                     "retrying group creation without it.")
            return self.query(query, {"input": without_images})["groupCreate"]

    def update_group(self, values: dict[str, Any]) -> dict[str, Any]:
        query = f"""mutation StashBoxMetadataSyncUpdateGroup($input: GroupUpdateInput!) {{
          groupUpdate(input: $input) {{ {LOCAL_GROUP_FIELDS} }}
        }}"""
        prepared = self._prepare_group_images(values)
        try:
            return self.query(query, {"input": prepared})["groupUpdate"]
        except PluginError as exc:
            if (not is_group_image_error(exc)
                    or not any(prepared.get(field) for field in ("front_image", "back_image"))):
                raise
            without_images = {key: value for key, value in prepared.items()
                              if key not in {"front_image", "back_image"}}
            log_info(f"Stash rejected the cover image for group {values.get('name') or values.get('id')}; "
                     "retrying metadata update without it.")
            return self.query(query, {"input": without_images})["groupUpdate"]

    def link_scene_groups(self, scene_id: str, groups: list[dict[str, Any]]) -> None:
        self.query("""mutation StashBoxMetadataSyncLinkSceneGroups($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) { id }
        }""", {"input": {"id": str(scene_id), "groups": groups}})

    def update_scene_marker(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self.query("""mutation StashBoxMetadataSyncUpdateMarker($input: SceneMarkerUpdateInput!) {
          sceneMarkerUpdate(input: $input) { id title seconds primary_tag { id name } }
        }""", {"input": values})
        return data["sceneMarkerUpdate"]

    def update_performer(self, values: dict[str, Any]) -> None:
        self.query("""mutation StashMetadataSyncUpdatePerformer($input: PerformerUpdateInput!) {
          performerUpdate(input: $input) { id }
        }""", {"input": values})

    def create_performer(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self.query("""mutation StashMetadataSyncCreatePerformer($input: PerformerCreateInput!) {
          performerCreate(input: $input) { id name }
        }""", {"input": values})
        return data["performerCreate"]

    def update_studio(self, values: dict[str, Any]) -> None:
        self.query("""mutation StashMetadataSyncUpdateStudio($input: StudioUpdateInput!) {
          studioUpdate(input: $input) { id }
        }""", {"input": values})

    def create_studio(self, values: dict[str, Any]) -> dict[str, Any]:
        data = self.query("""mutation StashMetadataSyncCreateStudio($input: StudioCreateInput!) {
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
    "imageMinimumMegapixels": 0.5,
    "imageMinimumLongEdge": 800,
    "replaceUnmeasurableImages": False,
    "autoCreatePerformers": False,
    "autoCreateStudios": False,
    "overwriteTagMetadata": False,
    "overwriteTagNames": False,
    "syncSceneTagsDryRun": True,
    "sceneTagBlacklist": "",
    "syncSceneMarkersDryRun": True,
    "tagImportedMarkers": False,
    "syncSceneGroupsDryRun": True,
    "overwriteGroupMetadata": False,
}


class SyncService:
    def __init__(self, stash: LocalStash, configuration: dict[str, Any], cache: ResponseCache) -> None:
        self.stash = stash
        self.configuration = configuration
        self.cache = cache
        self.settings = {**DEFAULT_SETTINGS, **(configuration.get("plugins", {}).get(PLUGIN_ID, {}) or {})}
        self.boxes = self._enabled_boxes()
        self.source_errors: list[str] = []
        self._transports: dict[tuple[str, str], GraphQLTransport] = {}
        self._tpdb_transports: dict[str, TPDBMarkersTransport] = {}

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
        enabled_settings = {"stashdb": "enableStashDB", "tpdb": "enableTPDB", "fansdb": "enableFansDB"}
        known_sources = {source_for_box(box) for box in known}
        # A user may use only one StashBox. Do not report other absent providers
        # as configuration errors; only flag a recognized, enabled provider
        # that exists in Stash's settings but lacks a usable endpoint or key.
        missing = sorted(
            source for source in known_sources
            if source and setting_bool(self.settings, enabled_settings[source], True)
            and source not in configured_sources
        )
        ok = bool(configured_sources) and not missing
        if not configured_sources:
            message = "Add a recognized StashBox source under Settings → Metadata Providers → Stash-boxes, including its API key."
        elif missing:
            message = "Check the endpoint and API key for the enabled sources listed below."
        else:
            message = "Configuration is ready."
        return {
            "ok": ok,
            "configured_boxes": len(all_boxes),
            "recognized_boxes": len(known),
            "enabled_sources": [box["source"] for box in self.boxes],
            "missing_enabled_sources": missing,
            "message": message,
        }

    def transport(self, box: dict[str, Any]) -> GraphQLTransport:
        endpoint = str(box["endpoint"])
        api_key = str(box.get("api_key", ""))
        key = (normalize_endpoint(endpoint), hashlib.sha256(api_key.encode()).hexdigest())
        if key not in self._transports:
            self._transports[key] = GraphQLTransport(
                endpoint, api_key, cache=self.cache,
                min_delay=float(self.settings.get("rateLimit", 0.25) or 0),
                max_requests_per_minute=box.get("max_requests_per_minute", 240),
            )
        return self._transports[key]

    def tpdb_transport(self, box: dict[str, Any]) -> TPDBMarkersTransport:
        api_key = str(box.get("api_key", ""))
        key = hashlib.sha256(api_key.encode()).hexdigest()
        if key not in self._tpdb_transports:
            self._tpdb_transports[key] = TPDBMarkersTransport(
                api_key, cache=self.cache,
                min_delay=float(self.settings.get("rateLimit", 0.25) or 0),
                max_requests_per_minute=box.get("max_requests_per_minute", 240),
            )
        return self._tpdb_transports[key]

    def test_connections(self) -> dict[str, Any]:
        results = []
        for box in self.boxes:
            try:
                self.transport(box).request("query StashMetadataSyncPing { __typename }", cacheable=False)
                results.append({"source": box["source"], "name": box.get("name", box["source"]), "ok": True})
            except Exception as exc:
                results.append({"source": box["source"], "name": box.get("name", box["source"]), "ok": False, "error": self.redact(str(exc), box)})
        return {"tested": len(results), "succeeded": sum(1 for item in results if item["ok"]), "sources": results}

    @staticmethod
    def redact(message: str, box: dict[str, Any]) -> str:
        key = str(box.get("api_key", ""))
        return message.replace(key, "[redacted]") if key else message

    def external_performer(self, box: dict[str, Any], stash_id: str) -> dict[str, Any] | None:
        data = self.transport(box).request(f"""query StashMetadataSyncFindPerformer($id: ID!) {{
          findPerformer(id: $id) {{ {STASHBOX_PERFORMER_FIELDS} }}
        }}""", {"id": str(stash_id)})
        return data.get("findPerformer")

    def search_performer(self, box: dict[str, Any], name: str) -> dict[str, Any] | None:
        data = self.transport(box).request(f"""query StashMetadataSyncSearchPerformer($term: String!) {{
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

    def performer_image_candidates(self, performer: dict[str, Any]) -> list[dict[str, Any]]:
        existing_ids = {normalize_endpoint(item.get("endpoint")): str(item.get("stash_id"))
                        for item in performer.get("stash_ids", []) or []
                        if item.get("endpoint") and item.get("stash_id")}
        candidates: list[dict[str, Any]] = []
        for source_rank, box in enumerate(self.boxes):
            external_id = existing_ids.get(normalize_endpoint(box["endpoint"]))
            try:
                external = self.external_performer(box, external_id) if external_id else None
                if not external and not external_id and setting_bool(self.settings, "enableNameSearch", True):
                    external = self.search_performer(box, str(performer.get("name", "")))
            except Exception as exc:
                self.source_errors.append(
                    f"{performer.get('name', performer.get('id'))} / {box['source']}: {self.redact(str(exc), box)}")
                continue
            if not external or external.get("deleted"):
                continue
            for image in external.get("images", []) or []:
                if not isinstance(image, dict):
                    continue
                url = normalize_url(image.get("url"))
                dimensions = image_dimensions(image)
                if not url or not dimensions:
                    continue
                width, height = dimensions
                candidates.append({
                    "endpoint": normalize_endpoint(box["endpoint"]),
                    "url": url,
                    "width": width,
                    "height": height,
                    "pixels": width * height,
                    "source": box["source"],
                    "source_name": box.get("name") or box["source"],
                    "source_rank": source_rank,
                })
        return sorted(candidates, key=lambda item: (-item["pixels"], -min(item["width"], item["height"]),
                                                     item["source_rank"], item["url"]))

    def get_performer_image_choices(self, performer_id: str) -> dict[str, Any]:
        if not self.boxes:
            raise PluginError("No enabled StashBox source with an API key is configured")
        performer = self.stash.performer(str(performer_id))
        if not performer:
            raise PluginError(f"Performer {performer_id} was not found")
        candidates = self.performer_image_candidates(performer)
        inspect_image = getattr(self.stash, "performer_image_dimensions", None)
        current_dimensions = (inspect_image(str(performer.get("id")))
                              if performer.get("image_path") and callable(inspect_image) else None)
        choices = []
        for index, candidate in enumerate(candidates):
            width, height = candidate["width"], candidate["height"]
            choices.append({
                "id": image_candidate_id(candidate["endpoint"], candidate["url"], width, height),
                "url": candidate["url"],
                "source": candidate["source"],
                "source_name": candidate["source_name"],
                "width": width,
                "height": height,
                "megapixels": round(candidate["pixels"] / 1_000_000, 2),
                "is_best": index == 0,
                "meets_quality_minimum": image_meets_quality_minimum(width, height, self.settings),
                "better_than_current": (image_quality_key(width, height) > image_quality_key(*current_dimensions)
                                         if current_dimensions else None),
            })
        return {
            "performer_id": str(performer.get("id", "")),
            "performer_name": str(performer.get("name") or performer.get("id") or "Unknown performer"),
            "current_image_present": bool(performer.get("image_path")),
            "current_image_url": (f"/performer/{urllib.parse.quote(str(performer.get('id', '')), safe='')}"
                                   if performer.get("image_path") else None),
            "current_image": ({"width": current_dimensions[0], "height": current_dimensions[1]}
                              if current_dimensions else None),
            "candidates": choices,
            "source_errors": self.source_errors[:20],
        }

    def apply_performer_image_candidate(self, performer_id: str, candidate_id: str) -> dict[str, Any]:
        choices = self.get_performer_image_choices(str(performer_id))
        candidate = next((item for item in choices["candidates"] if item["id"] == str(candidate_id)), None)
        if candidate is None:
            raise PluginError("That image candidate is no longer available; reopen the picker and try again")
        self.stash.update_performer({"id": choices["performer_id"], "image": candidate["url"]})
        log_info(f"Selected performer image for {choices['performer_name']}: {candidate['width']}x{candidate['height']} "
                 f"from {candidate['source_name']}.")
        return {"status": "updated", "performer_id": choices["performer_id"],
                "performer_name": choices["performer_name"], "source": candidate["source"],
                "source_name": candidate["source_name"], "width": candidate["width"], "height": candidate["height"]}

    def sync_performer_image(self, performer: dict[str, Any], *, dry_run: bool = False) -> dict[str, Any]:
        name = str(performer.get("name") or performer.get("id") or "Unknown performer")
        candidates = self.performer_image_candidates(performer)
        if not candidates:
            return {"status": "no_candidate", "performer_id": str(performer.get("id", "")), "name": name}

        candidate = candidates[0]
        width, height = candidate["width"], candidate["height"]
        if not image_meets_quality_minimum(width, height, self.settings):
            log_info(f"Skipped performer image for {name}: best source image is {width}x{height}, "
                     "below the configured minimum resolution.")
            return {"status": "below_minimum", "performer_id": str(performer.get("id", "")), "name": name,
                    "source": candidate["source"], "width": width, "height": height}

        current_dimensions = None
        if performer.get("image_path"):
            inspect_image = getattr(self.stash, "performer_image_dimensions", None)
            current_dimensions = inspect_image(str(performer.get("id"))) if callable(inspect_image) else None
            if current_dimensions:
                if image_quality_key(width, height) <= image_quality_key(*current_dimensions):
                    return {"status": "unchanged", "performer_id": str(performer.get("id", "")), "name": name,
                            "source": candidate["source"], "width": width, "height": height,
                            "current_width": current_dimensions[0], "current_height": current_dimensions[1]}
            elif not setting_bool(self.settings, "replaceUnmeasurableImages", False):
                log_info(f"Skipped performer image for {name}: current image resolution could not be measured.")
                return {"status": "unmeasurable", "performer_id": str(performer.get("id", "")), "name": name,
                        "source": candidate["source"], "width": width, "height": height}

        if dry_run:
            log_info(f"Preview: best image for {name} is {width}x{height} from {candidate['source_name']}; "
                     "it meets the quality threshold and is an upgrade.")
            return {"status": "preview", "performer_id": str(performer.get("id", "")), "name": name,
                    "source": candidate["source"], "width": width, "height": height,
                    "current_width": current_dimensions[0] if current_dimensions else None,
                    "current_height": current_dimensions[1] if current_dimensions else None}

        performer_id = str(performer.get("id", ""))
        self.stash.update_performer({"id": performer_id, "image": candidate["url"]})
        log_info(f"Updated performer image for {name} to {width}x{height} from {candidate['source_name']}.")
        return {"status": "updated", "performer_id": performer_id, "name": name,
                "source": candidate["source"], "width": width, "height": height,
                "current_width": current_dimensions[0] if current_dimensions else None,
                "current_height": current_dimensions[1] if current_dimensions else None}

    def sync_all_performer_images(self, *, dry_run: bool = False) -> dict[str, Any]:
        if not self.boxes:
            raise PluginError("No enabled StashBox source with an API key is configured")
        performers = self.stash.performers()
        counts = {"updated": 0, "preview": 0, "unchanged": 0, "below_minimum": 0,
                  "unmeasurable": 0, "no_candidate": 0, "failed": 0}
        samples: list[dict[str, Any]] = []
        error_samples: list[str] = []
        for index, performer in enumerate(performers, 1):
            try:
                result = self.sync_performer_image(performer, dry_run=dry_run)
                status = result["status"]
                counts[status] += 1
                if status in {"updated", "preview", "below_minimum", "unmeasurable"} and len(samples) < 100:
                    samples.append(result)
            except Exception as exc:
                counts["failed"] += 1
                if len(error_samples) < 20:
                    error_samples.append(f"{performer.get('name') or performer.get('id')}: {exc}")
            report_progress(index, len(performers))
        report_progress(1, 1)
        return {"dry_run": dry_run, "processed": len(performers), **counts,
                "source_failures": len(self.source_errors), "samples": samples,
                "error_samples": (error_samples + self.source_errors[:20])[:20]}

    def sync_single_performer_image(self, performer_id: str) -> dict[str, Any]:
        performer = self.stash.performer(str(performer_id))
        if not performer:
            raise PluginError(f"Performer {performer_id} was not found")
        return self.sync_performer_image(performer)

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
        if "image" in update and performer.get("image_path"):
            candidate = best_performer_image(found)
            inspect_image = getattr(self.stash, "performer_image_dimensions", None)
            current_dimensions = inspect_image(str(performer.get("id"))) if callable(inspect_image) else None
            if current_dimensions and candidate:
                if image_quality_key(candidate["width"], candidate["height"]) <= image_quality_key(*current_dimensions):
                    update.pop("image", None)
                    log_info(f"Kept the current performer image for {performer.get('name') or performer.get('id')}: "
                             "it is already as sharp as the best configured source image.")
            elif not setting_bool(self.settings, "replaceUnmeasurableImages", False):
                update.pop("image", None)
                log_info(f"Kept the current performer image for {performer.get('name') or performer.get('id')}: "
                         "its resolution could not be measured.")
        if len(update) <= 1:
            return False
        self.stash.update_performer(update)
        log_info(f"Updated performer metadata for {performer.get('name') or performer.get('id')} ({len(update) - 1} fields).")
        return True

    def external_tags(self, box: dict[str, Any]) -> list[dict[str, Any]]:
        """Read a complete, deduplicated StashBox tag list or fail without returning partial data."""
        query = f"""query StashBoxMetadataSyncTags($input: TagQueryInput!) {{
          queryTags(input: $input) {{ count tags {{ {STASHBOX_TAG_FIELDS} }} }}
        }}"""
        transport = self.transport(box)
        per_page = TAG_PAGE_SIZE
        page = 1
        all_tags: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        first_page_size: int | None = None
        while page <= MAX_TAG_PAGES:
            variables = {"input": {"page": page, "per_page": per_page, "sort": "NAME", "direction": "ASC"}}
            try:
                data = transport.request(query, variables, cacheable=True)
            except PluginError as exc:
                message = str(exc).lower()
                auth_error = is_auth_failure(message)
                can_retry_small_page = page == 1 and per_page > 100 and not auth_error and (
                    "http 400" in message or "http 422" in message or "graphql request" in message or
                    "per_page" in message or "page size" in message or "too many" in message or "maximum" in message
                )
                if can_retry_small_page:
                    per_page = 100
                    continue
                raise

            result = data.get("queryTags")
            if not isinstance(result, dict):
                raise PluginError(f"{box.get('name', box['source'])} returned no queryTags result")
            batch = result.get("tags") or []
            if not isinstance(batch, list):
                raise PluginError(f"{box.get('name', box['source'])} returned an invalid tag list")
            if not batch:
                break
            if first_page_size is None:
                first_page_size = len(batch)
            new_tags = []
            for tag in batch:
                external_id = str(tag.get("id") or "")
                if external_id and external_id not in seen_ids:
                    seen_ids.add(external_id)
                    new_tags.append(tag)
            if not new_tags:
                # Some non-standard endpoints ignore page; never sync an incomplete list.
                raise PluginError(f"{box.get('name', box['source'])} repeated a tag page; refusing a partial sync")
            all_tags.extend(new_tags)
            try:
                total = int(result.get("count", 0))
            except (TypeError, ValueError):
                total = 0
            if total > (first_page_size or 0) and len(all_tags) >= total:
                break
            if len(batch) < (first_page_size or per_page):
                break
            page += 1
        else:
            raise PluginError(f"{box.get('name', box['source'])} tag query exceeded the {MAX_TAG_PAGES}-page safety cap")
        return [tag for tag in all_tags if not tag.get("deleted")]

    def sync_all_tags(self) -> dict[str, Any]:
        if not self.boxes:
            raise PluginError("No enabled StashBox source with an API key is configured")
        local_tags = self.stash.tags()
        local_by_id = {str(tag.get("id")): tag for tag in local_tags if tag.get("id") is not None}
        local_index = build_local_tag_index(local_tags)
        matches: dict[str, list[tuple[dict[str, Any], dict[str, Any]]]] = {}
        ambiguous = unmatched = 0
        source_results = []
        for box in self.boxes:
            try:
                remote_tags = self.external_tags(box)
                per_local: dict[str, list[dict[str, Any]]] = {}
                source_ambiguous = 0
                for remote in remote_tags:
                    local, reason = match_remote_tag_to_local(remote, local_index, str(box["endpoint"]))
                    if local is None:
                        if reason.startswith("ambiguous"):
                            source_ambiguous += 1
                        else:
                            unmatched += 1
                        continue
                    per_local.setdefault(str(local["id"]), []).append(remote)
                for local_id, records in per_local.items():
                    if len(records) > 1:
                        source_ambiguous += len(records)
                        continue
                    matches.setdefault(local_id, []).append((box, records[0]))
                ambiguous += source_ambiguous
                source_results.append({"source": box["source"], "name": box.get("name", box["source"]),
                                       "remote_tags": len(remote_tags), "matched_local_tags": len(per_local),
                                       "ambiguous": source_ambiguous, "ok": True})
            except Exception as exc:
                source_results.append({"source": box["source"], "name": box.get("name", box["source"]),
                                       "ok": False, "error": self.redact(str(exc), box)})

        updated = failed = 0
        error_samples = []
        for index, local in enumerate(local_tags, 1):
            sources = matches.get(str(local.get("id")), [])
            if not sources:
                report_progress(index, len(local_tags))
                continue
            update = build_tag_update(local, sources, self.settings, local_tags)
            if len(update) <= 1:
                report_progress(index, len(local_tags))
                continue
            try:
                self.stash.update_tag(update)
                updated += 1
                log_info(f"Updated tag metadata for {local.get('name') or local.get('id')}.")
            except Exception as exc:
                failed += 1
                if len(error_samples) < 20:
                    error_samples.append(f"{local.get('name', local.get('id'))}: {exc}")
            report_progress(index, len(local_tags))
        return {"processed": len(local_tags), "matched": len(matches), "updated": updated,
                "unchanged": max(0, len(matches) - updated - failed), "unmatched_remote_tags": unmatched,
                "ambiguous": ambiguous, "failed": failed, "sources": source_results,
                "error_samples": error_samples}

    def external_scenes_by_ids(self, box: dict[str, Any], scene_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not scene_ids:
            return {}
        query = f"""query StashBoxMetadataSyncScenes($ids: [ID!]!) {{
          findScenes(ids: $ids) {{ {STASHBOX_SCENE_FIELDS} }}
        }}"""
        data = self.transport(box).request(query, {"ids": scene_ids}, cacheable=False)
        scenes = data.get("findScenes") or []
        if not isinstance(scenes, list):
            raise PluginError(f"{box.get('name', box['source'])} returned an invalid scene list")
        return {str(scene["id"]): scene for scene in scenes if isinstance(scene, dict) and scene.get("id")}

    def sync_scene_tags(self) -> dict[str, Any]:
        if not self.boxes:
            raise PluginError("No enabled StashBox source with an API key is configured")
        dry_run = setting_bool(self.settings, "syncSceneTagsDryRun", True)
        local_tags = self.stash.tags()
        local_index = build_local_tag_index(local_tags)
        history = SceneTagSyncHistory(self.cache.path.parent / "scene_tag_sync.sqlite3")
        scenes_seen = updated = would_update = no_changes = skipped = failed = tags_added = tags_skipped = 0
        error_samples: list[str] = []
        source_results = []
        budget = DRY_RUN_SCENE_LIMIT if dry_run else None
        settings_blacklist = parse_blacklist(self.settings.get("sceneTagBlacklist", ""))
        for box in self.boxes:
            if budget is not None and budget <= 0:
                break
            try:
                local_scenes = self.stash.scenes_for_box(str(box["endpoint"]))
            except Exception as exc:
                source_results.append({"source": box["source"], "ok": False, "error": self.redact(str(exc), box)})
                failed += 1
                continue
            if budget is not None:
                local_scenes = local_scenes[:budget]
            box_stats = {"source": box["source"], "scenes": len(local_scenes), "updated": 0,
                         "would_update": 0, "no_changes": 0, "skipped": 0, "failed": 0,
                         "tags_added": 0, "tags_skipped": 0}
            box_failed_auth = False
            for offset in range(0, len(local_scenes), SCENE_BATCH_SIZE):
                batch = local_scenes[offset:offset + SCENE_BATCH_SIZE]
                remote_ids_by_local: dict[str, str] = {}
                for scene in batch:
                    for stash_id in scene.get("stash_ids", []) or []:
                        if normalize_endpoint(stash_id.get("endpoint")) == normalize_endpoint(box["endpoint"]) and stash_id.get("stash_id"):
                            remote_ids_by_local[str(scene["id"])] = str(stash_id["stash_id"])
                            break
                distinct_ids = list(dict.fromkeys(remote_ids_by_local.values()))
                try:
                    remote_scenes = {}
                    for id_offset in range(0, len(distinct_ids), SCENE_BATCH_SIZE):
                        remote_scenes.update(self.external_scenes_by_ids(box, distinct_ids[id_offset:id_offset + SCENE_BATCH_SIZE]))
                except Exception as exc:
                    message = self.redact(str(exc), box)
                    for scene in batch:
                        scenes_seen += 1
                        box_stats["failed"] += 1
                        failed += 1
                        if len(error_samples) < 20:
                            error_samples.append(f"{scene.get('id')}: {message}")
                        if budget is not None:
                            budget -= 1
                        report_progress(scenes_seen, DRY_RUN_SCENE_LIMIT if dry_run else max(len(local_scenes), scenes_seen))
                    if is_auth_failure(message):
                        box_failed_auth = True
                        break
                    continue

                for scene in batch:
                    scenes_seen += 1
                    local_scene_id = str(scene["id"])
                    remote_scene_id = remote_ids_by_local.get(local_scene_id)
                    remote_scene = remote_scenes.get(remote_scene_id or "")
                    if not remote_scene:
                        box_stats["skipped"] += 1
                        skipped += 1
                        if budget is not None:
                            budget -= 1
                        report_progress(scenes_seen, DRY_RUN_SCENE_LIMIT if dry_run else max(scenes_seen, 1))
                        continue
                    existing_tag_ids = {str(tag.get("id")) for tag in scene.get("tags", []) or [] if tag.get("id")}
                    prior = history.get(str(box["endpoint"]), local_scene_id, remote_scene_id)
                    add_ids: set[str] = set()
                    matched_remote_ids: set[str] = set()
                    scene_skipped_tags = 0
                    for remote_tag in remote_scene.get("tags", []) or []:
                        name = str(remote_tag.get("name") or "").strip()
                        remote_tag_id = str(remote_tag.get("id") or "")
                        if not remote_tag_id or not name or name.casefold() in settings_blacklist:
                            scene_skipped_tags += 1
                            continue
                        local_tag, reason = match_remote_tag_to_local(remote_tag, local_index, str(box["endpoint"]))
                        if not local_tag:
                            scene_skipped_tags += 1
                            continue
                        matched_remote_ids.add(remote_tag_id)
                        local_tag_id = str(local_tag["id"])
                        if local_tag_id in existing_tag_ids:
                            continue
                        if prior is not None and remote_tag_id in prior:
                            continue
                        add_ids.add(local_tag_id)
                    box_stats["tags_skipped"] += scene_skipped_tags
                    tags_skipped += scene_skipped_tags
                    if not add_ids:
                        if not dry_run:
                            history.record(str(box["endpoint"]), local_scene_id, remote_scene_id, matched_remote_ids)
                        box_stats["no_changes"] += 1
                        no_changes += 1
                    elif dry_run:
                        box_stats["would_update"] += 1
                        box_stats["tags_added"] += len(add_ids)
                        would_update += 1
                        tags_added += len(add_ids)
                        added_names = [str(tag.get("name") or tag.get("id")) for tag in local_tags
                                       if str(tag.get("id")) in add_ids]
                        log_info(f"Dry run: would add tags to scene {scene.get('title') or local_scene_id}: "
                                 f"{', '.join(added_names)}.")
                    else:
                        try:
                            self.stash.add_scene_tags(local_scene_id, sorted(add_ids))
                            history.record(str(box["endpoint"]), local_scene_id, remote_scene_id, matched_remote_ids)
                            box_stats["updated"] += 1
                            box_stats["tags_added"] += len(add_ids)
                            updated += 1
                            tags_added += len(add_ids)
                            added_names = [str(tag.get("name") or tag.get("id")) for tag in local_tags
                                           if str(tag.get("id")) in add_ids]
                            log_info(f"Added tags to scene {scene.get('title') or local_scene_id}: "
                                     f"{', '.join(added_names)}.")
                        except Exception as exc:
                            if is_missing_scene_error(exc):
                                skipped += 1
                                box_stats["skipped"] += 1
                            else:
                                failed += 1
                                box_stats["failed"] += 1
                                if len(error_samples) < 20:
                                    error_samples.append(f"{scene.get('id')}: {exc}")
                    if budget is not None:
                        budget -= 1
                    report_progress(scenes_seen, DRY_RUN_SCENE_LIMIT if dry_run else max(len(local_scenes), scenes_seen))
            if box_failed_auth:
                source_results.append({**box_stats, "ok": False, "error": "The StashBox rejected the API key or scene query."})
            else:
                source_results.append({**box_stats, "ok": box_stats["failed"] == 0})
        report_progress(1, 1)
        return {"dry_run": dry_run, "scenes_processed": scenes_seen, "updated": updated,
                "would_update": would_update, "no_changes": no_changes, "skipped": skipped,
                "failed": failed, "tags_added": tags_added, "tags_skipped": tags_skipped,
                "sources": source_results, "error_samples": error_samples}

    def sync_scene_markers(self) -> dict[str, Any]:
        boxes = [box for box in self.boxes if box["source"] == "tpdb"]
        if not boxes:
            raise PluginError("Marker sync requires a configured ThePornDB StashBox with an API key")
        dry_run = setting_bool(self.settings, "syncSceneMarkersDryRun", True)
        local_tags = self.stash.tags()
        local_index = build_local_tag_index(local_tags)
        scenes_seen = updated = would_update = skipped = failed = markers_added = marker_tags_created = 0
        error_samples: list[str] = []
        source_results = []
        budget = DRY_RUN_SCENE_LIMIT if dry_run else None
        source_marker_tag: dict[str, Any] | None = None
        for box in boxes:
            if budget is not None and budget <= 0:
                break
            try:
                scenes = self.stash.scenes_for_box(str(box["endpoint"]), include_markers=True)
            except Exception as exc:
                source_results.append({"source": box["source"], "ok": False, "error": self.redact(str(exc), box)})
                failed += 1
                continue
            if budget is not None:
                scenes = scenes[:budget]
            box_stats = {"source": box["source"], "scenes": len(scenes), "updated": 0,
                         "would_update": 0, "skipped": 0, "failed": 0, "markers_added": 0,
                         "marker_tags_created": 0}
            for scene in scenes:
                scenes_seen += 1
                remote_id = next((str(item.get("stash_id")) for item in scene.get("stash_ids", []) or []
                                  if normalize_endpoint(item.get("endpoint")) == normalize_endpoint(box["endpoint"])
                                  and item.get("stash_id")), "")
                try:
                    external = self.tpdb_transport(box).scene(remote_id)
                    markers = normalize_tpdb_markers(external.get("markers", []), scene)
                    if not markers:
                        box_stats["skipped"] += 1
                        skipped += 1
                        if budget is not None:
                            budget -= 1
                        report_progress(scenes_seen, DRY_RUN_SCENE_LIMIT if dry_run else max(len(scenes), scenes_seen))
                        continue
                    scene_markers = list(scene.get("scene_markers", []) or [])
                    proposed: list[tuple[dict[str, Any], str, dict[str, Any] | None, bool]] = []
                    for marker in markers:
                        label = marker["primary_tag"]
                        local_tag, reason = match_local_tag_name(label, local_index)
                        created_tag = False
                        if not local_tag:
                            if dry_run:
                                if reason.startswith("ambiguous"):
                                    raise PluginError(f"Marker label {label!r} matches more than one local tag")
                                local_tag = None
                            else:
                                local_tag, created_tag = self.ensure_local_tag(label, local_tags, local_index)
                                local_index = build_local_tag_index(local_tags)
                                if created_tag:
                                    marker_tags_created += 1
                                    box_stats["marker_tags_created"] += 1
                        if setting_bool(self.settings, "tagImportedMarkers", False) and not dry_run:
                            if source_marker_tag is None:
                                source_marker_tag, created = self.ensure_local_tag("[TPDBMarker]", local_tags, local_index)
                                local_index = build_local_tag_index(local_tags)
                                if created:
                                    marker_tags_created += 1
                                    box_stats["marker_tags_created"] += 1
                        if local_tag is None:
                            proposed.append((marker, "", None, False))
                            continue
                        local_tag_id = str(local_tag["id"])
                        if any(marker_matches_existing(marker, existing, label, local_tag_id)
                               for existing in scene_markers):
                            continue
                        marker_tag_ids = [local_tag_id]
                        if source_marker_tag:
                            marker_tag_ids.append(str(source_marker_tag["id"]))
                        for extra_name in marker.get("tags", []):
                            extra_tag, _reason = match_local_tag_name(extra_name, local_index)
                            if extra_tag:
                                marker_tag_ids.append(str(extra_tag["id"]))
                        proposed.append((marker, local_tag_id, {"tag_ids": list(dict.fromkeys(marker_tag_ids))}, created_tag))

                    if not proposed:
                        if budget is not None:
                            budget -= 1
                        report_progress(scenes_seen, DRY_RUN_SCENE_LIMIT if dry_run else max(len(scenes), scenes_seen))
                        continue
                    if dry_run:
                        box_stats["would_update"] += 1
                        would_update += 1
                        box_stats["markers_added"] += len(proposed)
                        markers_added += len(proposed)
                        scene_name = scene.get("title") or scene.get("id")
                        for marker, _primary_tag_id, _extra, _created_tag in proposed:
                            log_info(f"Dry run: would add scene marker {marker['title']} at "
                                     f"{marker['seconds']:g}s to scene {scene_name}.")
                    else:
                        scene_added = 0
                        scene_missing = False
                        for marker, primary_tag_id, extra, _created in proposed:
                            if not primary_tag_id:
                                failed += 1
                                box_stats["failed"] += 1
                                continue
                            values = {"scene_id": str(scene["id"]), "title": marker["title"],
                                      "seconds": marker["seconds"], "primary_tag_id": primary_tag_id,
                                      "tag_ids": extra["tag_ids"] if extra else [primary_tag_id]}
                            if marker.get("end_seconds") is not None:
                                values["end_seconds"] = marker["end_seconds"]
                            try:
                                created = self.stash.create_scene_marker(values)
                                scene_markers.append({"id": created.get("id"), "title": marker["title"],
                                                      "seconds": marker["seconds"],
                                                      "primary_tag": {"id": primary_tag_id, "name": marker["primary_tag"]}})
                                scene_added += 1
                                log_info(f"Added scene marker {marker['title']} at {marker['seconds']:g}s "
                                         f"to scene {scene.get('title') or scene.get('id')}.")
                            except Exception as exc:
                                if is_missing_scene_error(exc):
                                    scene_missing = True
                                    break
                                failed += 1
                                box_stats["failed"] += 1
                                if len(error_samples) < 20:
                                    error_samples.append(f"{scene.get('title') or scene.get('id')}: {exc}")
                        if scene_missing:
                            skipped += 1
                            box_stats["skipped"] += 1
                        elif scene_added:
                            box_stats["updated"] += 1
                            box_stats["markers_added"] += scene_added
                            updated += 1
                            markers_added += scene_added
                    if budget is not None:
                        budget -= 1
                    report_progress(scenes_seen, DRY_RUN_SCENE_LIMIT if dry_run else max(len(scenes), scenes_seen))
                except Exception as exc:
                    failed += 1
                    box_stats["failed"] += 1
                    if len(error_samples) < 20:
                        error_samples.append(f"{scene.get('title') or scene.get('id')}: {self.redact(str(exc), box)}")
                    if budget is not None:
                        budget -= 1
                    report_progress(scenes_seen, DRY_RUN_SCENE_LIMIT if dry_run else max(len(scenes), scenes_seen))
            source_results.append({**box_stats, "ok": box_stats["failed"] == 0})
        report_progress(1, 1)
        return {"dry_run": dry_run, "scenes_processed": scenes_seen, "updated": updated,
                "would_update": would_update, "skipped": skipped, "failed": failed,
                "markers_added": markers_added, "marker_tags_created": marker_tags_created,
                "sources": source_results, "error_samples": error_samples}

    def sync_scene_groups(self) -> dict[str, Any]:
        """Import TPDB movie/group metadata and add Stash 0.32 scene-group links."""
        boxes = [box for box in self.boxes if box["source"] == "tpdb"]
        if not boxes:
            raise PluginError("Group sync requires a configured ThePornDB StashBox with an API key")
        dry_run = setting_bool(self.settings, "syncSceneGroupsDryRun", True)
        local_groups = self.stash.groups()
        group_index = build_local_group_index(local_groups)
        studios = self.stash.studios()
        scenes_seen = groups_created = groups_updated = groups_matched = scene_links_added = 0
        would_create = would_update = would_link = skipped = failed = 0
        error_samples: list[str] = []
        source_results = []
        budget = DRY_RUN_SCENE_LIMIT if dry_run else None

        for box in boxes:
            if budget is not None and budget <= 0:
                break
            try:
                scenes = self.stash.scenes_for_box(str(box["endpoint"]), include_groups=True)
            except Exception as exc:
                source_results.append({"source": box["source"], "ok": False,
                                       "error": self.redact(str(exc), box)})
                failed += 1
                continue
            if budget is not None:
                scenes = scenes[:budget]
            box_stats = {"source": box["source"], "scenes": len(scenes), "groups_created": 0,
                         "groups_updated": 0, "groups_matched": 0, "scene_links_added": 0,
                         "would_create": 0, "would_update": 0, "would_link": 0,
                         "skipped": 0, "failed": 0}

            for scene in scenes:
                scenes_seen += 1
                remote_id = next((str(item.get("stash_id")) for item in scene.get("stash_ids", []) or []
                                  if normalize_endpoint(item.get("endpoint")) == normalize_endpoint(box["endpoint"])
                                  and item.get("stash_id")), "")
                try:
                    if not remote_id:
                        skipped += 1
                        box_stats["skipped"] += 1
                        continue
                    external = self.tpdb_transport(box).scene(remote_id)
                    records = tpdb_group_records(external)
                    if not records:
                        skipped += 1
                        box_stats["skipped"] += 1
                        continue

                    current_groups = list(scene.get("groups", []) or [])
                    linked_ids = {
                        str((item.get("group") or {}).get("id"))
                        for item in current_groups if (item.get("group") or {}).get("id")
                    }
                    additions: dict[str, dict[str, Any]] = {}

                    for remote in records:
                        if not str(remote.get("title") or remote.get("name") or "").strip():
                            skipped += 1
                            box_stats["skipped"] += 1
                            continue
                        group, reason = match_tpdb_group(remote, group_index)
                        if not group and reason.startswith("ambiguous"):
                            skipped += 1
                            box_stats["skipped"] += 1
                            continue
                        matched_existing = group is not None

                        if group is None:
                            values = build_tpdb_group_values(remote, studios)
                            if dry_run:
                                would_create += 1
                                box_stats["would_create"] += 1
                                would_link += 1
                                box_stats["would_link"] += 1
                                log_info(f"Dry run: would create group {values.get('name')} and link it "
                                         f"to scene {scene.get('title') or scene.get('id')}.")
                                continue
                            try:
                                group = self.stash.create_group(values)
                                if not group or not group.get("id"):
                                    raise PluginError("Stash returned no group ID after creating a TPDB movie group")
                                local_groups.append(group)
                                group_index = build_local_group_index(local_groups)
                                groups_created += 1
                                box_stats["groups_created"] += 1
                                log_info(f"Created group {group.get('name') or values.get('name')}.")
                            except Exception as create_error:
                                # If another Stash client created it concurrently, reuse the unique match.
                                try:
                                    local_groups = self.stash.groups()
                                    group_index = build_local_group_index(local_groups)
                                    group, retry_reason = match_tpdb_group(remote, group_index)
                                except Exception:
                                    group = None
                                    retry_reason = "refresh_failed"
                                if group is None:
                                    failed += 1
                                    box_stats["failed"] += 1
                                    if len(error_samples) < 20:
                                        error_samples.append(f"{remote.get('title')}: {self.redact(str(create_error), box)}")
                                    continue
                                reason = retry_reason
                                matched_existing = True

                        if matched_existing:
                            groups_matched += 1
                            box_stats["groups_matched"] += 1
                        update = build_group_update(group, remote, studios, self.settings)
                        if len(update) > 1:
                            if dry_run:
                                would_update += 1
                                box_stats["would_update"] += 1
                                log_info(f"Dry run: would update group metadata for {group.get('name') or group.get('id')}.")
                            else:
                                try:
                                    self.stash.update_group(update)
                                    groups_updated += 1
                                    box_stats["groups_updated"] += 1
                                    log_info(f"Updated group metadata for {group.get('name') or group.get('id')}.")
                                except Exception as exc:
                                    failed += 1
                                    box_stats["failed"] += 1
                                    if len(error_samples) < 20:
                                        error_samples.append(f"{group.get('name')}: {self.redact(str(exc), box)}")

                        group_id = str(group["id"])
                        if group_id not in linked_ids:
                            if dry_run:
                                would_link += 1
                                box_stats["would_link"] += 1
                                log_info(f"Dry run: would link group {group.get('name') or group_id} "
                                         f"to scene {scene.get('title') or scene.get('id')}.")
                            else:
                                additions[group_id] = {"group_id": group_id, "scene_index": None}

                    if not dry_run and additions:
                        merged_groups = []
                        for current in current_groups:
                            group_id = str((current.get("group") or {}).get("id") or "")
                            if group_id:
                                merged_groups.append({"group_id": group_id, "scene_index": current.get("scene_index")})
                        merged_groups.extend(additions.values())
                        try:
                            self.stash.link_scene_groups(str(scene["id"]), merged_groups)
                            link_count = len(additions)
                            scene_links_added += link_count
                            box_stats["scene_links_added"] += link_count
                            group_names = {str(group.get("id")): group.get("name") or group.get("id")
                                           for group in local_groups}
                            for group_id in additions:
                                log_info(f"Linked group {group_names.get(group_id, group_id)} to scene "
                                         f"{scene.get('title') or scene.get('id')}.")
                        except Exception as exc:
                            if is_missing_scene_error(exc):
                                skipped += 1
                                box_stats["skipped"] += 1
                            else:
                                failed += 1
                                box_stats["failed"] += 1
                                if len(error_samples) < 20:
                                    error_samples.append(f"{scene.get('id')}: {self.redact(str(exc), box)}")
                except Exception as exc:
                    failed += 1
                    box_stats["failed"] += 1
                    if len(error_samples) < 20:
                        error_samples.append(f"{scene.get('title') or scene.get('id')}: {self.redact(str(exc), box)}")
                finally:
                    if budget is not None:
                        budget -= 1
                    report_progress(scenes_seen, DRY_RUN_SCENE_LIMIT if dry_run else max(len(scenes), scenes_seen))

            source_results.append({**box_stats, "ok": box_stats["failed"] == 0})

        report_progress(1, 1)
        return {"dry_run": dry_run, "scenes_processed": scenes_seen,
                "groups_created": groups_created, "groups_updated": groups_updated,
                "groups_matched": groups_matched, "scene_links_added": scene_links_added,
                "would_create": would_create, "would_update": would_update, "would_link": would_link,
                "skipped": skipped, "failed": failed, "sources": source_results,
                "error_samples": error_samples}

    def ensure_local_tag(self, name: str, local_tags: list[dict[str, Any]],
                         local_index: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        tag, reason = match_local_tag_name(name, local_index)
        if tag:
            return tag, False
        if reason.startswith("ambiguous"):
            raise PluginError(f"Cannot determine a unique local tag for marker label {name!r}")
        try:
            created = self.stash.create_tag({"name": name})
        except Exception as create_error:
            # Another Stash client may have created this tag between our snapshot
            # and mutation; accept that exact result rather than failing the scene.
            try:
                refreshed = self.stash.tags()
            except Exception:
                raise create_error
            refreshed_index = build_local_tag_index(refreshed)
            existing, refreshed_reason = match_local_tag_name(name, refreshed_index)
            if existing:
                local_tags[:] = refreshed
                return existing, False
            if refreshed_reason.startswith("ambiguous"):
                raise PluginError(f"Cannot determine a unique local tag for marker label {name!r}") from create_error
            raise create_error
        local_tags.append(created)
        log_info(f"Created tag {created.get('name') or name}.")
        return created, True

    def reset_scene_tag_sync_history(self) -> dict[str, Any]:
        history = SceneTagSyncHistory(self.cache.path.parent / "scene_tag_sync.sqlite3")
        return {"removed": history.clear(), "message": "Scene tag sync history cleared."}

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
            document = f"""query StashMetadataSyncFavorites($input: {kind.capitalize()[:-1]}QueryInput!) {{
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
                            noun = "performer" if is_performer else "studio"
                            log_info(f"Created and favorited {noun} {record.get('name') or record.get('id')} "
                                     f"from {box.get('name') or box['source']}.")
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
                    noun = "performer" if is_performer else "studio"
                    log_info(f"Marked {noun} as favorite: {record.get('name') or record.get('id')} "
                             f"from {box.get('name') or box['source']}.")
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


def is_auth_failure(message: str) -> bool:
    text = str(message or "").casefold()
    return any(value in text for value in ("http 401", "http 403", "unauthorized", "not authorized", "forbidden", "invalid api key"))


def is_missing_scene_error(error: Any) -> bool:
    """Identify a Stash mutation that raced with scene deletion and skip it cleanly."""
    message = str(error or "").casefold()
    if "scene" not in message:
        return False
    return any(phrase in message for phrase in (
        "not found", "does not exist", "doesn't exist", "could not find", "cannot find", "no scene with id",
    ))


def parse_blacklist(value: Any) -> set[str]:
    if not isinstance(value, str):
        return set()
    return {part.strip().casefold() for part in re.split(r"[,;\n]+", value) if part.strip()}


def match_local_tag_name(name: str, index: dict[str, Any]) -> tuple[dict[str, Any] | None, str]:
    key = str(name or "").strip().casefold()
    if not key:
        return None, "no_name"
    for source, label in ((index["by_name"], "name"), (index["by_alias"], "alias")):
        candidates = source.get(key, [])
        if len(candidates) == 1:
            return candidates[0], label
        if len(candidates) > 1:
            return None, f"ambiguous_{label}"
    return None, "unmatched"


def normalize_tpdb_markers(markers: Any, scene: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate TPDB marker fields, reject invalid timestamps, and dedupe repeated API rows."""
    if not isinstance(markers, list):
        raise PluginError("ThePornDB returned an invalid markers list")
    durations = []
    for file in scene.get("files", []) or []:
        try:
            duration = float(file.get("duration"))
        except (TypeError, ValueError, AttributeError):
            continue
        if math.isfinite(duration) and duration > 0:
            durations.append(duration)
    duration = max(durations) if durations else None
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for item in markers:
        if not isinstance(item, dict):
            continue
        raw_title = item.get("title") or item.get("name") or ""
        title = str(raw_title).strip()
        tags = item.get("tags") or []
        if isinstance(tags, str):
            tags = [tags]
        tag_names = []
        if isinstance(tags, list):
            for tag in tags:
                name = tag.get("name") if isinstance(tag, dict) else tag
                if isinstance(name, str) and name.strip():
                    tag_names.append(name.strip())
        primary_tag = (title or (tag_names[0] if tag_names else "")).strip()[:255]
        if not title:
            title = primary_tag
        raw_seconds = item.get("start_time")
        if raw_seconds in (None, ""):
            raw_seconds = item.get("seconds")
        try:
            seconds = float(raw_seconds)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(seconds) or seconds < 0:
            continue
        if duration is not None and seconds >= duration:
            continue
        raw_end = item.get("end_time", item.get("end_seconds"))
        try:
            end_seconds = float(raw_end) if raw_end not in (None, "") else None
        except (TypeError, ValueError):
            end_seconds = None
        if end_seconds is not None and (not math.isfinite(end_seconds) or end_seconds <= seconds or
                                        (duration is not None and end_seconds > duration)):
            end_seconds = None
        if not primary_tag:
            continue
        dedupe_key = (primary_tag.casefold(), round(seconds * 2))
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        result.append({"title": title, "primary_tag": primary_tag, "seconds": seconds,
                       "end_seconds": end_seconds, "tags": clean_strings(tag_names)})
    return sorted(result, key=lambda item: (item["seconds"], item["primary_tag"].casefold()))


def marker_matches_existing(remote: dict[str, Any], local: dict[str, Any], label: str,
                            primary_tag_id: str) -> bool:
    try:
        seconds = float(local.get("seconds"))
    except (TypeError, ValueError):
        return False
    primary_tag = local.get("primary_tag") or {}
    local_tag_id = str(primary_tag.get("id") or "") if isinstance(primary_tag, dict) else ""
    local_tag_name = str(primary_tag.get("name") or "") if isinstance(primary_tag, dict) else str(primary_tag)
    same_time = abs(seconds - float(remote["seconds"])) <= 0.75
    same_title = str(local.get("title") or "").strip().casefold() == str(remote.get("title") or "").strip().casefold()
    same_primary_tag = (local_tag_id == primary_tag_id or
                        local_tag_name.strip().casefold() == label.strip().casefold())
    return same_time and (same_title or same_primary_tag)


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
    items = record.get("urls", []) or []
    if record.get("url"):
        items = [*items, record["url"]] if isinstance(items, list) else [items, record["url"]]
    if not isinstance(items, (list, tuple)):
        items = [items]
    for item in items:
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


def best_performer_image(sources: list[tuple[dict[str, Any], dict[str, Any]]]) -> dict[str, Any] | None:
    candidates = []
    for source_rank, (box, record) in enumerate(sources):
        for image in record.get("images", []) or []:
            if not isinstance(image, dict):
                continue
            url = normalize_url(image.get("url"))
            dimensions = image_dimensions(image)
            if not url or not dimensions:
                continue
            width, height = dimensions
            candidates.append({"url": url, "width": width, "height": height,
                               "pixels": width * height, "source_rank": source_rank,
                               "source": box.get("source", "")})
    if not candidates:
        return None
    return min(candidates, key=lambda item: (-item["pixels"], -min(item["width"], item["height"]),
                                              item["source_rank"], item["url"]))


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
    image = best_performer_image([({}, record)])
    if image:
        mapped["image"] = image["url"]
    return mapped


def build_performer_update(local: dict[str, Any], sources: list[tuple[dict[str, Any], dict[str, Any]]],
                           settings: dict[str, Any], *, creating: bool = False) -> dict[str, Any]:
    overwrite = setting_bool(settings, "overwriteExisting", False)
    merged: dict[str, Any] = {}
    # The list is already ordered from highest to lowest priority.
    for _box, external in reversed(sources):
        merged.update(map_external_performer(external))
    image = best_performer_image(sources)
    if image and image_meets_quality_minimum(image["width"], image["height"], settings):
        merged["image"] = image["url"]
    else:
        merged.pop("image", None)
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
    elif mode == "list_performer_image_candidates":
        performer_id = args.get("performer_id") or args.get("performerId") or args.get("id")
        if performer_id is None:
            raise PluginError("The image picker requires performer_id")
        result = service.get_performer_image_choices(str(performer_id))
    elif mode == "apply_performer_image_candidate":
        performer_id = args.get("performer_id") or args.get("performerId") or args.get("id")
        candidate_id = args.get("candidate_id") or args.get("candidateId")
        if performer_id is None or candidate_id is None:
            raise PluginError("Applying an image requires performer_id and candidate_id")
        result = service.apply_performer_image_candidate(str(performer_id), str(candidate_id))
    elif mode == "preview_performer_images":
        result = service.sync_all_performer_images(dry_run=True)
    elif mode == "sync_performer_images":
        result = service.sync_all_performer_images()
    elif mode == "sync_single_performer_image":
        performer_id = args.get("performer_id") or args.get("performerId") or args.get("id")
        if performer_id is None:
            raise PluginError("The sync_single_performer_image task requires performer_id")
        result = service.sync_single_performer_image(str(performer_id))
    elif mode == "sync_all_tags":
        result = service.sync_all_tags()
    elif mode == "sync_scene_tags":
        result = service.sync_scene_tags()
    elif mode == "sync_scene_markers":
        result = service.sync_scene_markers()
    elif mode == "sync_scene_groups":
        result = service.sync_scene_groups()
    elif mode == "reset_scene_tag_sync_history":
        result = service.reset_scene_tag_sync_history()
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
