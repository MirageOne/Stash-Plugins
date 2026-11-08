#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Sync ThePornDB scene markers and optional movie/group metadata into Stash."""

from __future__ import annotations

import json
import math
import re
import sys
import time
from typing import Any
from urllib.parse import quote


PLUGIN_ID = "tpdb-markers"
TPDB_STASH_ENDPOINT = "https://theporndb.net/graphql"
TPDB_SCENE_API = "https://api.theporndb.net/scenes/"
MARKER_TAG = "[TPDBMarker]"
SKIP_TAG = "[TPDB: Skip Marker]"
PAGE_SIZE = 100
REQUEST_TIMEOUT = 25
FRAGMENT_SCENE = "id stash_ids { endpoint stash_id } groups { scene_index group { id } } scene_markers { id }"

DEFAULT_SETTINGS = {
    "disableSceneMarkerHook": False,
    "createGroupsFromScene": True,
    "importGroupImages": False,
    "runOnScenesWithMarkers": False,
    "addTPDBMarkerTag": False,
    "addTPDBMarkerTitle": False,
    "overwriteMarkers": False,
    "mergeMarkers": False,
}


def _log(logger: Any, level: str, message: str) -> None:
    method = getattr(logger, level, None) if logger is not None else None
    if callable(method):
        method(message)
    elif level in {"warning", "error"}:
        print(message, file=sys.stderr)


def _progress(logger: Any, value: float) -> None:
    method = getattr(logger, "progress", None) if logger is not None else None
    if callable(method):
        method(max(0.0, min(1.0, value)))


def _enabled(settings: dict[str, Any], key: str) -> bool:
    value = settings.get(key, DEFAULT_SETTINGS.get(key, False))
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().casefold() in {"true", "1", "yes", "on"}
    return False


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _normal_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).casefold())


def load_settings(configuration: dict[str, Any] | None) -> dict[str, Any]:
    settings = DEFAULT_SETTINGS.copy()
    plugin_settings = (configuration or {}).get("plugins") or {}
    if not isinstance(plugin_settings, dict):
        return settings

    configured = plugin_settings.get(PLUGIN_ID)
    if not isinstance(configured, dict):
        for key, value in plugin_settings.items():
            if _normal_key(key) == _normal_key(PLUGIN_ID) and isinstance(value, dict):
                configured = value
                break
    if isinstance(configured, dict):
        settings.update(configured)

    # Accept the upstream setting name so existing TPDBMarkers config can be
    # carried over when a user installs this repository version manually.
    if "createGroupsFromScene" not in (configured or {}) and "createMovieFromScene" in (configured or {}):
        settings["createGroupsFromScene"] = configured["createMovieFromScene"]
    return settings


def configure_tpdb_session(session: Any, configuration: dict[str, Any] | None) -> None:
    general = (configuration or {}).get("general") or {}
    stash_boxes = general.get("stashBoxes") or []
    for box in stash_boxes:
        if not isinstance(box, dict) or box.get("endpoint") != TPDB_STASH_ENDPOINT:
            continue
        api_key = box.get("api_key")
        if api_key:
            session.headers.update({"Authorization": "Bearer " + str(api_key)})
        return


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < 0:
        return None
    return number


def _marker_records(data: dict[str, Any], settings: dict[str, Any], stash: Any, tag_cache: dict, logger: Any) -> list[dict[str, Any]]:
    marker_records = []
    tag_id = tag_cache.get("marker_tag_id")
    if _enabled(settings, "addTPDBMarkerTag") and "marker_tag_id" not in tag_cache:
        try:
            tag = stash.find_tag(MARKER_TAG, create=True)
            if isinstance(tag, dict):
                tag_id = tag.get("id")
            tag_cache["marker_tag_id"] = tag_id
            if tag_id is None:
                _log(logger, "warning", "Could not create or find the TPDB marker tag; markers will be imported without it.")
        except Exception as exc:
            tag_cache["marker_tag_id"] = None
            _log(logger, "warning", f"Could not create or find the TPDB marker tag: {type(exc).__name__}: {exc}")

    for remote_marker in _as_list(data.get("markers")):
        if not isinstance(remote_marker, dict):
            continue
        original_title = str(remote_marker.get("title") or remote_marker.get("name") or "").strip()
        seconds = _number(remote_marker.get("start_time", remote_marker.get("seconds")))
        if not original_title or seconds is None:
            _log(logger, "warning", "Skipped a TPDB marker with a missing title or invalid start time.")
            continue

        title = f"[TPDBMarker] {original_title}" if _enabled(settings, "addTPDBMarkerTitle") else original_title
        marker = {
            "title": title,
            "primary_tag": original_title,
            "tags": [],
            "seconds": seconds,
        }
        end_seconds = _number(remote_marker.get("end_time", remote_marker.get("end_seconds")))
        if end_seconds is not None and end_seconds > seconds:
            marker["end_seconds"] = end_seconds
        if tag_id is not None:
            try:
                marker["tags"].append(int(tag_id))
            except (TypeError, ValueError):
                marker["tags"].append(tag_id)
        marker_records.append(marker)
    return marker_records


def _remote_groups(data: dict[str, Any]) -> list[dict[str, Any]]:
    """TPDB has returned scene movie records as either movies or groups."""
    groups = []
    seen = set()
    for field in ("groups", "movies"):
        values = data.get(field)
        if isinstance(values, dict):
            values = [values]
        for item in _as_list(values):
            if not isinstance(item, dict):
                continue
            identity = str(item.get("url") or item.get("id") or item.get("title") or "").strip().casefold()
            if identity and identity not in seen:
                groups.append(item)
                seen.add(identity)
    return groups


def _urls(group: dict[str, Any]) -> list[str]:
    value = group.get("urls")
    if value is None and group.get("url"):
        value = [group["url"]]
    if isinstance(value, str):
        value = [value]
    urls = []
    for item in _as_list(value):
        url = item.get("url") if isinstance(item, dict) else item
        if isinstance(url, str) and url.strip():
            urls.append(url.strip())
    return urls


def _scene_group_id(association: Any) -> Any:
    if not isinstance(association, dict):
        return None
    if association.get("group_id") is not None:
        return association.get("group_id")
    group = association.get("group")
    if isinstance(group, dict):
        return group.get("id")
    return group


def _group_association(association: Any) -> dict[str, Any] | None:
    group_id = _scene_group_id(association)
    if group_id is None:
        return None
    normalized = {"group_id": group_id}
    if isinstance(association, dict) and association.get("scene_index") is not None:
        normalized["scene_index"] = association["scene_index"]
    else:
        normalized["scene_index"] = None
    return normalized


def _find_group(stash: Any, remote_group: dict[str, Any], logger: Any) -> dict[str, Any] | None:
    title = str(remote_group.get("title") or remote_group.get("name") or "").strip()
    url = str(remote_group.get("url") or "").strip()
    if url:
        try:
            matches = stash.find_groups(
                f={"url": {"modifier": "EQUALS", "value": url}}
            ) or []
            if matches:
                return matches[0]
        except Exception as exc:
            _log(logger, "debug", f"TPDB group URL lookup failed; trying its title: {type(exc).__name__}: {exc}")

    query = title or url
    if not query:
        return None
    try:
        matches = stash.find_groups(q=query) or []
    except Exception as exc:
        _log(logger, "warning", f"Could not search Stash groups for {query!r}: {type(exc).__name__}: {exc}")
        return None

    target_name = title.casefold()
    target_url = url.rstrip("/").casefold()
    for match in matches:
        if not isinstance(match, dict):
            continue
        if target_name and str(match.get("name") or "").strip().casefold() != target_name:
            continue
        match_urls = [value.rstrip("/").casefold() for value in _urls(match)]
        if target_url and match_urls and target_url not in match_urls:
            continue
        return match
    return None


def _group_input(remote_group: dict[str, Any], settings: dict[str, Any], stash: Any, logger: Any) -> dict[str, Any]:
    title = str(remote_group.get("title") or remote_group.get("name") or "").strip()
    group_input: dict[str, Any] = {"name": title}
    date = remote_group.get("date")
    if isinstance(date, str) and date.strip():
        group_input["date"] = date.strip()
    synopsis = remote_group.get("description") or remote_group.get("synopsis")
    if isinstance(synopsis, str) and synopsis.strip():
        group_input["synopsis"] = synopsis.strip()
    url = remote_group.get("url")
    if isinstance(url, str) and url.strip():
        # GroupCreateInput uses urls (plural) in current Stash; url is invalid.
        group_input["urls"] = [url.strip()]

    site = remote_group.get("site") or remote_group.get("studio")
    if isinstance(site, dict):
        site = site.get("name") or site.get("title")
    if isinstance(site, str) and site.strip():
        try:
            studio = stash.find_studio(site.strip(), create=True)
            if isinstance(studio, dict) and studio.get("id") is not None:
                group_input["studio_id"] = studio["id"]
        except Exception as exc:
            _log(logger, "warning", f"Could not find or create studio {site!r}: {type(exc).__name__}: {exc}")

    if _enabled(settings, "importGroupImages"):
        front_image = remote_group.get("image") or remote_group.get("front_image")
        back_image = remote_group.get("back_image")
        if isinstance(front_image, str) and front_image.startswith(("http://", "https://")):
            group_input["front_image"] = front_image
        if isinstance(back_image, str) and back_image.startswith(("http://", "https://")):
            group_input["back_image"] = back_image
    return group_input


def _image_error(error: Exception) -> bool:
    message = str(error).casefold()
    return any(token in message for token in ("front image", "back image", "image content type", "image download", "http error 470", "http error 472"))


def _get_or_create_group(stash: Any, remote_group: dict[str, Any], settings: dict[str, Any], logger: Any) -> dict[str, Any] | None:
    title = str(remote_group.get("title") or remote_group.get("name") or "").strip()
    if not title:
        _log(logger, "warning", "Skipped a TPDB movie/group without a title.")
        return None
    existing = _find_group(stash, remote_group, logger)
    if existing is not None:
        return existing

    group_input = _group_input(remote_group, settings, stash, logger)
    try:
        created = stash.create_group(group_input)
    except Exception as exc:
        images = "front_image" in group_input or "back_image" in group_input
        if not images or not _image_error(exc):
            _log(logger, "error", f"Could not create TPDB group {title!r}: {type(exc).__name__}: {exc}")
            return None
        # Image hosts can block Stash's server-side fetch. Keep the metadata
        # and association useful by retrying the group without remote artwork.
        group_input.pop("front_image", None)
        group_input.pop("back_image", None)
        _log(logger, "warning", f"TPDB artwork for {title!r} was unavailable to Stash; retrying the group without images.")
        try:
            created = stash.create_group(group_input)
        except Exception as retry_exc:
            _log(logger, "error", f"Could not create TPDB group {title!r}: {type(retry_exc).__name__}: {retry_exc}")
            return None
    if not isinstance(created, dict) or created.get("id") is None:
        _log(logger, "warning", f"Stash did not return an ID for TPDB group {title!r}; it cannot be linked to the scene.")
        return None
    _log(logger, "info", f"Created Stash group {title!r} from TPDB.")
    return created


def process_scene(
    stash: Any,
    session: Any,
    scene: Any,
    settings: dict[str, Any],
    logger: Any,
    marker_importer: Any,
    tag_cache: dict | None = None,
) -> dict[str, Any]:
    """Import markers and optionally attach TPDB movie/group records to a scene."""
    tag_cache = tag_cache if tag_cache is not None else {}
    result = {"status": "skipped", "markers": 0, "groups": 0}
    if not isinstance(scene, dict):
        _log(logger, "info", "Skipped a scene that no longer exists in Stash.")
        return result

    scene_id = scene.get("id")
    if scene_id is None:
        _log(logger, "warning", "Skipped a Stash scene without an ID.")
        return result
    stash_ids = _as_list(scene.get("stash_ids"))
    tpdb_ids = [
        item for item in stash_ids
        if isinstance(item, dict)
        and item.get("endpoint") == TPDB_STASH_ENDPOINT
        and item.get("stash_id")
    ]
    if not tpdb_ids:
        _log(logger, "info", f"Scene {scene_id} has no {TPDB_STASH_ENDPOINT} stash ID; skipped.")
        return result

    remote_id = str(tpdb_ids[0]["stash_id"])
    try:
        response = session.get(TPDB_SCENE_API + quote(remote_id, safe=""), timeout=REQUEST_TIMEOUT)
    except Exception as exc:
        _log(logger, "error", f"Could not reach TPDB for scene {scene_id}: {type(exc).__name__}: {exc}")
        result["status"] = "error"
        return result
    status_code = getattr(response, "status_code", None)
    if status_code != 200:
        _log(logger, "error", f"TPDB returned HTTP {status_code} for Stash scene {scene_id}.")
        result["status"] = "error"
        return result
    try:
        payload = response.json()
    except Exception as exc:
        _log(logger, "error", f"TPDB returned invalid JSON for Stash scene {scene_id}: {type(exc).__name__}: {exc}")
        result["status"] = "error"
        return result
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        _log(logger, "warning", f"TPDB returned no scene data for Stash scene {scene_id}.")
        result["status"] = "error"
        return result

    result["status"] = "success"
    try:
        markers = _marker_records(data, settings, stash, tag_cache, logger)
        existing_markers = _as_list(scene.get("scene_markers"))
        should_import = bool(markers) and (
            not existing_markers
            or _enabled(settings, "mergeMarkers")
            or _enabled(settings, "overwriteMarkers")
        )
        if should_import:
            if existing_markers and _enabled(settings, "overwriteMarkers"):
                stash.destroy_scene_markers(scene_id)
            marker_importer(stash, markers, scene_id, 15)
            result["markers"] = len(markers)
            _log(logger, "info", f"Imported {len(markers)} TPDB marker(s) for scene {scene_id}.")
        elif markers:
            _log(logger, "info", f"Scene {scene_id} already has markers; left them unchanged.")
        else:
            _log(logger, "info", f"TPDB returned no valid markers for scene {scene_id}.")
    except Exception as exc:
        result["status"] = "partial"
        _log(logger, "error", f"Could not import markers for scene {scene_id}: {type(exc).__name__}: {exc}")

    if not _enabled(settings, "createGroupsFromScene"):
        return result

    remote_groups = _remote_groups(data)
    if not remote_groups:
        _log(logger, "info", f"TPDB returned no movie/group records for scene {scene_id}.")
        return result

    current_associations = [
        normalized for entry in _as_list(scene.get("groups"))
        if (normalized := _group_association(entry)) is not None
    ]
    linked_ids = {str(entry["group_id"]) for entry in current_associations}
    new_associations = []
    for remote_group in remote_groups:
        try:
            group = _get_or_create_group(stash, remote_group, settings, logger)
        except Exception as exc:
            _log(logger, "error", f"Could not process a TPDB group for scene {scene_id}: {type(exc).__name__}: {exc}")
            result["status"] = "partial"
            continue
        if not isinstance(group, dict) or group.get("id") is None:
            result["status"] = "partial"
            continue
        group_id = group["id"]
        if str(group_id) not in linked_ids:
            new_associations.append({"group_id": group_id, "scene_index": None})
            linked_ids.add(str(group_id))

    if new_associations:
        try:
            stash.update_scene({
                "id": scene_id,
                "groups": current_associations + new_associations,
            })
            result["groups"] = len(new_associations)
            _log(logger, "info", f"Linked {len(new_associations)} TPDB group(s) to scene {scene_id}.")
        except Exception as exc:
            result["status"] = "partial"
            _log(logger, "error", f"Could not link TPDB groups to scene {scene_id}: {type(exc).__name__}: {exc}")
    else:
        _log(logger, "info", f"No new TPDB groups to link to scene {scene_id}.")
    return result


def _scene_filter(stash: Any, settings: dict[str, Any], logger: Any) -> dict[str, Any]:
    filters: dict[str, Any] = {
        "stash_id_endpoint": {
            "endpoint": TPDB_STASH_ENDPOINT,
            "modifier": "NOT_NULL",
            "stash_id": "",
        }
    }
    include_marked_scenes = (
        _enabled(settings, "runOnScenesWithMarkers")
        or _enabled(settings, "mergeMarkers")
        or _enabled(settings, "overwriteMarkers")
    )
    if not include_marked_scenes:
        filters["has_markers"] = "false"
    try:
        skip_tag = stash.find_tag(SKIP_TAG, create=False)
    except Exception as exc:
        _log(logger, "warning", f"Could not check for the optional {SKIP_TAG} tag: {type(exc).__name__}: {exc}")
        skip_tag = None
    if isinstance(skip_tag, dict) and skip_tag.get("id") is not None:
        filters["tags"] = {
            "depth": 0,
            "excludes": [skip_tag["id"]],
            "modifier": "INCLUDES_ALL",
            "value": [],
        }
    return filters


def sync_all(
    stash: Any,
    session: Any,
    settings: dict[str, Any],
    logger: Any,
    marker_importer: Any,
    sleep_fn: Any = time.sleep,
) -> dict[str, int]:
    filters = _scene_filter(stash, settings, logger)
    try:
        count_response = stash.find_scenes(filters, filter={"per_page": 1}, get_count=True)
        count_value = count_response[0] if isinstance(count_response, (tuple, list)) and count_response else count_response
        total = max(0, int(count_value or 0))
    except Exception as exc:
        _log(logger, "error", f"Could not count TPDB-linked scenes: {type(exc).__name__}: {exc}")
        return {"total": 0, "processed": 0, "errors": 1}

    _log(logger, "info", f"TPDB marker sync found {total} scene(s) to check.")
    if total == 0:
        _log(logger, "info", "Nothing to sync.")
        return {"total": 0, "processed": 0, "errors": 0}

    page_count = math.ceil(total / PAGE_SIZE)
    processed = 0
    errors = 0
    tag_cache: dict[str, Any] = {}
    for page in range(1, page_count + 1):
        _log(logger, "info", f"Fetching scene page {page}/{page_count}.")
        try:
            scenes = stash.find_scenes(
                filters,
                filter={"page": page, "per_page": PAGE_SIZE},
            ) or []
        except Exception as exc:
            _log(logger, "error", f"Could not fetch scene page {page}/{page_count}: {type(exc).__name__}: {exc}")
            errors += 1
            continue
        for scene in scenes:
            processed += 1
            scene_id = scene.get("id") if isinstance(scene, dict) else None
            try:
                result = process_scene(stash, session, scene, settings, logger, marker_importer, tag_cache)
            except Exception as exc:
                result = {"status": "error", "markers": 0, "groups": 0}
                _log(logger, "error", f"Unexpected error processing scene {scene_id or 'unknown'}: {type(exc).__name__}: {exc}")
            if result.get("status") in {"error", "partial"}:
                errors += 1
            _progress(logger, processed / total)
            _log(
                logger,
                "info",
                f"Processed {processed}/{total}: scene {scene_id or 'unknown'} "
                f"({result.get('markers', 0)} marker(s), {result.get('groups', 0)} group link(s)).",
            )
            if processed < total:
                sleep_fn(1)

    _log(logger, "info", f"TPDB marker sync finished: {processed}/{total} scene(s) checked, {errors} with errors.")
    return {"total": total, "processed": processed, "errors": errors}


def main(stdin: Any = None) -> int:
    source = stdin if stdin is not None else sys.stdin
    try:
        request = json.loads(source.read())
    except Exception as exc:
        print(f"Could not read Stash plugin input: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    if sys.version_info < (3, 9):
        print(
            "TPDB Markers requires Python 3.9 or newer because current stashapp-tools "
            "uses Python 3.9 type syntax. Update Stash's configured Python executable.",
            file=sys.stderr,
        )
        return 1

    try:
        import requests
        import stashapi.log as log
        import stashapi.marker_parse as marker_parse
        from stashapi.stashapp import StashInterface
    except ImportError as exc:
        print(
            f"TPDB Markers is missing a Python dependency ({exc}). "
            "Install plugins/tpdb-markers/requirements.txt with Stash's configured Python executable.",
            file=sys.stderr,
        )
        return 1

    server_connection = request.get("server_connection")
    if not isinstance(server_connection, dict):
        _log(log, "error", "Stash did not provide a server connection.")
        return 1
    try:
        stash = StashInterface(server_connection)
        configuration = stash.get_configuration() or {}
        settings = load_settings(configuration)
        session = requests.Session()
        configure_tpdb_session(session, configuration)
    except Exception as exc:
        _log(log, "error", f"Could not initialize TPDB Markers: {type(exc).__name__}: {exc}")
        return 1

    args = request.get("args") or {}
    if not isinstance(args, dict):
        args = {}
    hook_context = args.get("hookContext")
    if isinstance(hook_context, dict):
        hook_type = hook_context.get("type")
        if hook_type == "Scene.Update.Post" and not _enabled(settings, "disableSceneMarkerHook"):
            scene_id = hook_context.get("id")
            if scene_id is None:
                _log(log, "warning", "Ignored a scene update hook without a scene ID.")
                return 0
            try:
                stash.run_plugin_task(PLUGIN_ID, "Sync", args={"scene_id": scene_id})
            except Exception as exc:
                _log(log, "error", f"Could not queue TPDB sync for the updated scene: {type(exc).__name__}: {exc}")
                return 1
        return 0

    mode = args.get("mode", "sync")
    if mode not in {"sync", "processScene"}:
        _log(log, "error", f"Unsupported task mode: {mode!r}.")
        return 1
    scene_id = args.get("scene_id")
    if scene_id is not None:
        try:
            scene = stash.find_scene(scene_id, fragment=FRAGMENT_SCENE)
        except Exception as exc:
            _log(log, "error", f"Could not load scene {scene_id}: {type(exc).__name__}: {exc}")
            return 1
        # A scene may be deleted after Stash queued its update hook.
        process_scene(stash, session, scene, settings, log, marker_parse.import_scene_markers)
        return 0

    sync_all(stash, session, settings, log, marker_parse.import_scene_markers)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
