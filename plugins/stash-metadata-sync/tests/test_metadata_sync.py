import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "stash_metadata_sync.py"
SPEC = importlib.util.spec_from_file_location("stash_metadata_sync_metadata_tests", SCRIPT)
plugin = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(plugin)


class Response:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class FakeStash:
    def __init__(self, tags=None, scenes=None, groups=None, studios=None):
        self.local_tags = [dict(tag) for tag in tags or []]
        self.local_scenes = [dict(scene) for scene in scenes or []]
        self.local_groups = [dict(group) for group in groups or []]
        self.local_studios = [dict(studio) for studio in studios or []]
        self.tag_updates = []
        self.created_tags = []
        self.added_scene_tags = []
        self.created_markers = []
        self.created_groups = []
        self.group_updates = []
        self.linked_scene_groups = []

    def tags(self):
        return self.local_tags

    def groups(self):
        return self.local_groups

    def studios(self):
        return self.local_studios

    def update_tag(self, values):
        self.tag_updates.append(dict(values))

    def create_tag(self, values):
        tag = {"id": str(len(self.local_tags) + 1), "name": values["name"], "aliases": [], "stash_ids": []}
        self.local_tags.append(tag)
        self.created_tags.append(dict(values))
        return tag

    def scenes_for_box(self, _endpoint, *, include_markers=False, include_groups=False):
        return self.local_scenes

    def add_scene_tags(self, scene_id, tag_ids):
        self.added_scene_tags.append((str(scene_id), list(tag_ids)))
        scene = next(item for item in self.local_scenes if str(item["id"]) == str(scene_id))
        existing = {str(tag["id"]) for tag in scene.get("tags", [])}
        scene.setdefault("tags", []).extend({"id": tag_id} for tag_id in tag_ids if tag_id not in existing)

    def create_scene_marker(self, values):
        marker = {
            "id": str(len(self.created_markers) + 1), "title": values["title"],
            "seconds": values["seconds"], "primary_tag": {
                "id": values["primary_tag_id"],
                "name": next(tag["name"] for tag in self.local_tags if tag["id"] == values["primary_tag_id"]),
            },
        }
        marker.update({key: values[key] for key in ("end_seconds", "tag_ids") if key in values})
        self.created_markers.append(dict(values))
        scene = next(item for item in self.local_scenes if str(item["id"]) == str(values["scene_id"]))
        scene.setdefault("scene_markers", []).append(marker)
        return marker

    def create_group(self, values):
        group = {"id": f"group-{len(self.local_groups) + 1}", "name": values["name"],
                 "urls": list(values.get("urls", [])), "date": values.get("date"),
                 "synopsis": values.get("synopsis"), "front_image_path": values.get("front_image"),
                 "back_image_path": values.get("back_image"), "studio": None}
        if values.get("studio_id"):
            group["studio"] = next((dict(studio) for studio in self.local_studios
                                    if str(studio["id"]) == str(values["studio_id"])), None)
        self.local_groups.append(group)
        self.created_groups.append(dict(values))
        return group

    def update_group(self, values):
        self.group_updates.append(dict(values))
        group = next(group for group in self.local_groups if str(group["id"]) == str(values["id"]))
        for key, value in values.items():
            if key == "id":
                continue
            group["front_image_path" if key == "front_image" else
                  "back_image_path" if key == "back_image" else key] = value
        return group

    def link_scene_groups(self, scene_id, groups):
        self.linked_scene_groups.append((str(scene_id), [dict(group) for group in groups]))
        scene = next(item for item in self.local_scenes if str(item["id"]) == str(scene_id))
        scene["groups"] = [{"scene_index": item.get("scene_index"), "group": {
            "id": str(item["group_id"]),
            "name": next((group["name"] for group in self.local_groups
                           if str(group["id"]) == str(item["group_id"])), ""),
            "urls": next((group.get("urls", []) for group in self.local_groups
                          if str(group["id"]) == str(item["group_id"])), []),
        }} for item in groups]


def make_service(directory, stash, source="stashdb", settings=None):
    endpoint = "https://theporndb.net/graphql" if source == "tpdb" else "https://stashdb.org/graphql"
    box = {"name": "ThePornDB" if source == "tpdb" else "StashDB", "endpoint": endpoint,
           "api_key": "test-key", "source": source, "max_requests_per_minute": 240}
    configuration = {"general": {"stashBoxes": [box]}, "plugins": {plugin.PLUGIN_ID: settings or {}}}
    cache = plugin.ResponseCache(Path(directory) / "responses.sqlite3", 0)
    return plugin.SyncService(stash, configuration, cache), box


class MetadataSyncTests(unittest.TestCase):
    def test_tag_update_fills_blanks_and_keeps_local_description_and_name(self):
        endpoint = "https://stashdb.org/graphql"
        local = {"id": "1", "name": "Local Name", "description": "Keep this", "aliases": ["Mine"], "stash_ids": []}
        remote = {"id": "remote-1", "name": "Source Name", "description": "Remote detail", "aliases": ["Source alias"]}

        update = plugin.build_tag_update(local, [({"endpoint": endpoint}, remote)], plugin.DEFAULT_SETTINGS)

        self.assertEqual(update["id"], "1")
        self.assertNotIn("description", update)
        self.assertNotIn("name", update)
        self.assertEqual(update["aliases"], ["Mine", "Source alias"])
        self.assertEqual(update["stash_ids"], [{"endpoint": endpoint, "stash_id": "remote-1"}])

    def test_tag_update_overwrites_description_only_when_enabled(self):
        local = {"id": "1", "description": "Old"}
        remote = {"id": "remote-1", "description": "New"}
        update = plugin.build_tag_update(local, [({"endpoint": "https://stashdb.org/graphql"}, remote)],
                                         {**plugin.DEFAULT_SETTINGS, "overwriteTagMetadata": True})
        self.assertEqual(update["description"], "New")

    def test_tag_rename_preserves_old_name_and_avoids_alias_collisions(self):
        local = {"id": "1", "name": "Local", "aliases": ["Mine"], "stash_ids": []}
        other = {"id": "2", "name": "Other", "aliases": ["Conflicting name", "Taken alias"]}
        remote = {"id": "remote-1", "name": "Conflicting name",
                  "aliases": ["Taken alias", "Safe alias", "Conflicting name"]}

        update = plugin.build_tag_update(
            local, [({"endpoint": "https://stashdb.org/graphql"}, remote)],
            {**plugin.DEFAULT_SETTINGS, "overwriteTagNames": True}, [local, other],
        )

        self.assertNotIn("name", update)
        self.assertEqual(update["aliases"], ["Mine", "Safe alias"])
        self.assertEqual(update["stash_ids"], [{"endpoint": "https://stashdb.org/graphql", "stash_id": "remote-1"}])

    def test_remote_tag_matching_uses_stash_id_before_name(self):
        tags = [
            {"id": "1", "name": "Shared", "stash_ids": [{"endpoint": "https://stashdb.org/graphql", "stash_id": "remote-1"}]},
            {"id": "2", "name": "Shared", "stash_ids": []},
        ]
        index = plugin.build_local_tag_index(tags)
        matched, reason = plugin.match_remote_tag_to_local({"id": "remote-1", "name": "Shared"}, index,
                                                           "https://stashdb.org/graphql")
        self.assertEqual(matched["id"], "1")
        self.assertEqual(reason, "stash_id")

    def test_tag_sync_skips_ambiguous_local_names(self):
        stash = FakeStash(tags=[{"id": "1", "name": "Shared", "aliases": [], "stash_ids": []},
                                {"id": "2", "name": "Shared", "aliases": [], "stash_ids": []}])
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash)
            service.external_tags = lambda _box: [{"id": "remote-1", "name": "Shared", "aliases": [], "description": "x"}]
            result = service.sync_all_tags()

        self.assertEqual(result["updated"], 0)
        self.assertEqual(result["ambiguous"], 1)
        self.assertEqual(stash.tag_updates, [])

    def test_tag_sync_updates_matched_local_tag_and_links_source_id(self):
        stash = FakeStash(tags=[{"id": "1", "name": "Blowjob", "description": "", "aliases": [], "stash_ids": []}])
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash)
            service.external_tags = lambda _box: [{"id": "remote-tag", "name": "Blowjob",
                                                    "description": "Oral sex", "aliases": ["fellatio"]}]
            result = service.sync_all_tags()

        self.assertEqual(result["updated"], 1)
        update = stash.tag_updates[0]
        self.assertEqual(update["description"], "Oral sex")
        self.assertEqual(update["aliases"], ["fellatio"])
        self.assertEqual(update["stash_ids"], [{"endpoint": "https://stashdb.org/graphql", "stash_id": "remote-tag"}])

    def test_group_payload_supports_movies_and_groups_without_duplicate_records(self):
        records = plugin.tpdb_group_records({
            "movies": [{"id": "movie-1", "title": "Movie One", "url": "https://theporndb.net/movies/1"},
                       {"id": "movie-2", "title": "Movie Two"}],
            "groups": [{"id": "group-1", "title": "Movie One", "url": "https://theporndb.net/movies/1"}],
        })

        self.assertEqual([record["title"] for record in records], ["Movie One", "Movie Two"])

    def test_group_metadata_preserves_local_values_unless_overwrite_enabled(self):
        url = "https://theporndb.net/movies/movie-1"
        local = {"id": "group-1", "name": "Local title", "date": "2001", "synopsis": "Local synopsis",
                 "urls": [url], "front_image_path": "/local/front.jpg", "back_image_path": "/local/back.jpg",
                 "studio": {"id": "studio-local", "name": "Local studio"}}
        remote = {"title": "Remote title", "date": "2024", "description": "Remote synopsis",
                  "url": f"{url}/", "image": "https://cdn.example/front.jpg",
                  "back_image": "https://cdn.example/back.jpg", "site": "Remote studio"}

        preserved = plugin.build_group_update(local, remote, [], plugin.DEFAULT_SETTINGS)
        overwritten = plugin.build_group_update(
            local, remote, [], {**plugin.DEFAULT_SETTINGS, "overwriteGroupMetadata": True},
        )

        self.assertEqual(preserved, {"id": "group-1"})
        self.assertEqual(overwritten["date"], "2024")
        self.assertEqual(overwritten["synopsis"], "Remote synopsis")
        self.assertEqual(overwritten["front_image"], "https://cdn.example/front.jpg")
        self.assertEqual(overwritten["back_image"], "https://cdn.example/back.jpg")
        self.assertNotIn("name", overwritten)
        self.assertNotIn("studio_id", overwritten)
        self.assertNotIn("urls", overwritten)

    def test_external_tag_paging_collects_complete_result(self):
        stash = FakeStash()
        with tempfile.TemporaryDirectory() as directory:
            service, box = make_service(directory, stash)

            class FakeTransport:
                def __init__(self):
                    self.calls = []

                def request(self, _query, variables, cacheable):
                    self.calls.append((variables["input"]["page"], cacheable))
                    page = variables["input"]["page"]
                    tags = ([{"id": "1", "name": "A"}, {"id": "2", "name": "B"}] if page == 1
                            else [{"id": "3", "name": "C"}])
                    return {"queryTags": {"count": 3, "tags": tags}}

            fake = FakeTransport()
            service.transport = lambda _box: fake
            with patch.object(plugin, "TAG_PAGE_SIZE", 2):
                tags = service.external_tags(box)

        self.assertEqual([tag["id"] for tag in tags], ["1", "2", "3"])
        self.assertEqual(fake.calls, [(1, True), (2, True)])

    def test_external_tag_paging_handles_silent_server_page_cap(self):
        stash = FakeStash()
        with tempfile.TemporaryDirectory() as directory:
            service, box = make_service(directory, stash)

            class CappedTransport:
                def __init__(self):
                    self.pages = []

                def request(self, _query, variables, cacheable):
                    page = variables["input"]["page"]
                    self.pages.append(page)
                    start = (page - 1) * 100
                    end = min(start + 100, 150)
                    tags = [{"id": str(index), "name": f"Tag {index}"} for index in range(start, end)]
                    return {"queryTags": {"count": 150, "tags": tags}}

            fake = CappedTransport()
            service.transport = lambda _box: fake
            tags = service.external_tags(box)

        self.assertEqual(len(tags), 150)
        self.assertEqual(fake.pages, [1, 2])

    def test_graphql_transport_is_reused_per_source_to_enforce_rate_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            service, box = make_service(directory, FakeStash())
            self.assertIs(service.transport(box), service.transport(box))

    def test_validate_config_accepts_a_single_configured_source(self):
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, FakeStash())

            result = service.validate_config()

        self.assertTrue(result["ok"])
        self.assertEqual(result["missing_enabled_sources"], [])

    def test_validate_config_flags_a_recognized_source_without_api_key(self):
        with tempfile.TemporaryDirectory() as directory:
            configuration = {"general": {"stashBoxes": [{
                "name": "StashDB", "endpoint": "https://stashdb.org/graphql", "api_key": "",
            }]}}
            service = plugin.SyncService(FakeStash(), configuration,
                                         plugin.ResponseCache(Path(directory) / "responses.sqlite3", 0))

            result = service.validate_config()

        self.assertFalse(result["ok"])
        self.assertEqual(result["missing_enabled_sources"], ["stashdb"])

    def test_scene_tag_dry_run_does_not_write(self):
        endpoint = "https://stashdb.org/graphql"
        stash = FakeStash(
            tags=[{"id": "tag-1", "name": "Blowjob", "aliases": [], "stash_ids": []}],
            scenes=[{"id": "local-scene", "stash_ids": [{"endpoint": endpoint, "stash_id": "remote-scene"}], "tags": []}],
        )
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash)
            service.external_scenes_by_ids = lambda _box, ids: {
                "remote-scene": {"id": "remote-scene", "tags": [{"id": "remote-tag", "name": "Blowjob"}]}
            }
            with patch.object(plugin, "report_progress"):
                result = service.sync_scene_tags()

        self.assertTrue(result["dry_run"])
        self.assertEqual(result["would_update"], 1)
        self.assertEqual(stash.added_scene_tags, [])

    def test_scene_tag_history_does_not_readd_a_tag_removed_locally(self):
        endpoint = "https://stashdb.org/graphql"
        scene = {"id": "local-scene", "stash_ids": [{"endpoint": endpoint, "stash_id": "remote-scene"}], "tags": []}
        stash = FakeStash(tags=[{"id": "tag-1", "name": "Blowjob", "aliases": [], "stash_ids": []}], scenes=[scene])
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash, settings={"syncSceneTagsDryRun": False})
            service.external_scenes_by_ids = lambda _box, _ids: {
                "remote-scene": {"id": "remote-scene", "tags": [{"id": "remote-tag", "name": "Blowjob"}]}
            }
            stream = io.StringIO()
            with redirect_stderr(stream):
                with patch.object(plugin, "report_progress"):
                    first = service.sync_scene_tags()
                self.assertEqual(first["updated"], 1)
            self.assertEqual(scene["tags"], [{"id": "tag-1"}])

            scene["tags"].clear()  # Simulate the user removing the synchronized tag.
            with patch.object(plugin, "report_progress"):
                second = service.sync_scene_tags()

        self.assertEqual(second["updated"], 0)
        self.assertEqual(second["no_changes"], 1)
        self.assertEqual(stash.added_scene_tags, [("local-scene", ["tag-1"])])
        self.assertIn(f"{plugin.INFO_PREFIX}Added tags to scene local-scene: Blowjob.", stream.getvalue())

    def test_scene_tag_sync_skips_scene_deleted_before_mutation(self):
        endpoint = "https://stashdb.org/graphql"

        class DeletedSceneStash(FakeStash):
            def add_scene_tags(self, _scene_id, _tag_ids):
                raise plugin.PluginError("Scene local-scene not found")

        stash = DeletedSceneStash(
            tags=[{"id": "tag-1", "name": "Blowjob", "aliases": [], "stash_ids": []}],
            scenes=[{"id": "local-scene", "stash_ids": [{"endpoint": endpoint, "stash_id": "remote-scene"}], "tags": []}],
        )
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash, settings={"syncSceneTagsDryRun": False})
            service.external_scenes_by_ids = lambda _box, _ids: {
                "remote-scene": {"id": "remote-scene", "tags": [{"id": "remote-tag", "name": "Blowjob"}]}
            }
            with patch.object(plugin, "report_progress"):
                result = service.sync_scene_tags()

        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["skipped"], 1)

    def test_marker_dry_run_does_not_create_tags_or_markers(self):
        endpoint = "https://theporndb.net/graphql"
        stash = FakeStash(scenes=[{"id": "local-scene", "title": "Scene", "files": [{"duration": 90}],
                                   "stash_ids": [{"endpoint": endpoint, "stash_id": "remote-scene"}],
                                   "scene_markers": []}])
        with tempfile.TemporaryDirectory() as directory:
            service, box = make_service(directory, stash, source="tpdb")
            service.tpdb_transport = lambda _box: type("Remote", (), {"scene": lambda _self, _id: {
                "markers": [{"title": "Blowjob", "start_time": 12.5}]
            }})()
            result = service.sync_scene_markers()

        self.assertTrue(result["dry_run"])
        self.assertEqual(result["markers_added"], 1)
        self.assertEqual(stash.created_tags, [])
        self.assertEqual(stash.created_markers, [])

    def test_marker_sync_reports_progress_for_scenes_without_markers(self):
        endpoint = "https://theporndb.net/graphql"
        stash = FakeStash(scenes=[{"id": "local-scene", "files": [],
                                   "stash_ids": [{"endpoint": endpoint, "stash_id": "remote-scene"}],
                                   "scene_markers": []}])
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash, source="tpdb")
            service.tpdb_transport = lambda _box: type("Remote", (), {"scene": lambda _self, _id: {"markers": []}})()
            progress = []
            with patch.object(plugin, "report_progress", side_effect=lambda done, total: progress.append((done, total))):
                result = service.sync_scene_markers()

        self.assertEqual(result["scenes_processed"], 1)
        self.assertEqual(result["skipped"], 1)
        self.assertIn((1, 200), progress)
        self.assertEqual(progress[-1], (1, 1))

    def test_marker_sync_creates_missing_primary_tag_and_merges_without_duplicates(self):
        endpoint = "https://theporndb.net/graphql"
        scene = {"id": "local-scene", "title": "Scene", "files": [{"duration": 90}],
                 "stash_ids": [{"endpoint": endpoint, "stash_id": "remote-scene"}], "scene_markers": []}
        stash = FakeStash(scenes=[scene])
        with tempfile.TemporaryDirectory() as directory:
            service, box = make_service(directory, stash, source="tpdb", settings={"syncSceneMarkersDryRun": False})
            service.tpdb_transport = lambda _box: type("Remote", (), {"scene": lambda _self, _id: {
                "markers": [{"title": "Blowjob", "start_time": 12.5, "end_time": 15}]
            }})()
            stream = io.StringIO()
            with redirect_stderr(stream):
                first = service.sync_scene_markers()
            second = service.sync_scene_markers()

        self.assertEqual(first["markers_added"], 1)
        self.assertEqual(second["markers_added"], 0)
        self.assertEqual(len(stash.created_markers), 1)
        self.assertEqual(stash.created_tags, [{"name": "Blowjob"}])
        self.assertEqual(stash.created_markers[0]["end_seconds"], 15.0)
        self.assertIn(f"{plugin.INFO_PREFIX}Created tag Blowjob.", stream.getvalue())
        self.assertIn(f"{plugin.INFO_PREFIX}Added scene marker Blowjob at 12.5s to scene Scene.", stream.getvalue())

    def test_marker_sync_skips_scene_deleted_before_marker_create(self):
        endpoint = "https://theporndb.net/graphql"

        class DeletedSceneStash(FakeStash):
            def create_scene_marker(self, _values):
                raise plugin.PluginError("Scene local-scene not found")

        stash = DeletedSceneStash(
            tags=[{"id": "tag-1", "name": "Blowjob", "aliases": [], "stash_ids": []}],
            scenes=[{"id": "local-scene", "title": "Scene", "files": [{"duration": 90}],
                     "stash_ids": [{"endpoint": endpoint, "stash_id": "remote-scene"}], "scene_markers": []}],
        )
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash, source="tpdb", settings={"syncSceneMarkersDryRun": False})
            service.tpdb_transport = lambda _box: type("Remote", (), {"scene": lambda _self, _id: {
                "markers": [{"title": "Blowjob", "start_time": 12.5}]
            }})()

            result = service.sync_scene_markers()

        self.assertEqual(result["failed"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["markers_added"], 0)

    def test_tpdb_movie_import_dry_run_previews_group_creation_and_link(self):
        endpoint = "https://theporndb.net/graphql"
        stash = FakeStash(scenes=[{"id": "scene-1", "stash_ids": [{"endpoint": endpoint, "stash_id": "tpdb-1"}],
                                   "groups": []}])
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash, source="tpdb")
            service.tpdb_transport = lambda _box: type("Remote", (), {"scene": lambda _self, _id: {
                "movies": [{"id": "movie-1", "title": "Movie One", "url": "https://theporndb.net/movies/movie-1"}]
            }})()
            progress = []
            with patch.object(plugin, "report_progress", side_effect=lambda done, total: progress.append((done, total))):
                result = service.sync_scene_groups()

        self.assertTrue(result["dry_run"])
        self.assertEqual(result["would_create"], 1)
        self.assertEqual(result["would_link"], 1)
        self.assertEqual(stash.created_groups, [])
        self.assertEqual(stash.linked_scene_groups, [])
        self.assertEqual(progress[-1], (1, 1))

    def test_tpdb_movie_import_creates_group_and_preserves_scene_group_links(self):
        endpoint = "https://theporndb.net/graphql"
        scene = {"id": "scene-1", "stash_ids": [{"endpoint": endpoint, "stash_id": "tpdb-1"}],
                 "groups": [{"scene_index": 3, "group": {"id": "existing-group", "name": "Existing", "urls": []}}]}
        stash = FakeStash(
            scenes=[scene],
            groups=[{"id": "existing-group", "name": "Existing", "urls": []}],
            studios=[{"id": "studio-1", "name": "Studio One", "aliases": ["Studio 1"]}],
        )
        remote_record = {
            "id": "movie-1", "title": "Movie One", "date": "2024-03-02", "description": "A synopsis",
            "image": "https://cdn.example/front.jpg", "back_image": "https://cdn.example/back.jpg",
            "url": "https://theporndb.net/movies/movie-1", "site": "Studio 1",
        }
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash, source="tpdb", settings={"syncSceneGroupsDryRun": False})
            service.tpdb_transport = lambda _box: type("Remote", (), {"scene": lambda _self, _id: {
                "movies": [remote_record]
            }})()
            stream = io.StringIO()
            with redirect_stderr(stream):
                first = service.sync_scene_groups()
            second = service.sync_scene_groups()

        self.assertEqual(first["groups_created"], 1)
        self.assertEqual(first["scene_links_added"], 1)
        self.assertEqual(second["groups_created"], 0)
        self.assertEqual(second["scene_links_added"], 0)
        self.assertEqual(len(stash.created_groups), 1)
        self.assertEqual(stash.created_groups[0]["studio_id"], "studio-1")
        self.assertEqual(stash.created_groups[0]["urls"], [remote_record["url"]])
        self.assertEqual(len(stash.linked_scene_groups), 1)
        self.assertEqual(stash.linked_scene_groups[0][1], [
            {"group_id": "existing-group", "scene_index": 3},
            {"group_id": "group-2", "scene_index": None},
        ])
        self.assertIn(f"{plugin.INFO_PREFIX}Created group Movie One.", stream.getvalue())
        self.assertIn(f"{plugin.INFO_PREFIX}Linked group Movie One to scene scene-1.", stream.getvalue())

    def test_group_metadata_sync_fills_blanks_and_ignores_missing_movies_key(self):
        endpoint = "https://theporndb.net/graphql"
        remote_record = {"title": "Movie One", "url": "https://theporndb.net/movies/movie-1",
                         "date": "2024", "description": "Imported synopsis"}
        group = {"id": "group-1", "name": "Movie One", "date": None, "synopsis": "",
                 "urls": [remote_record["url"]], "front_image_path": None, "back_image_path": None,
                 "studio": None}
        scene = {"id": "scene-1", "stash_ids": [{"endpoint": endpoint, "stash_id": "tpdb-1"}],
                 "groups": [{"scene_index": None, "group": {"id": "group-1", "name": "Movie One", "urls": [remote_record["url"]]}}]}
        stash = FakeStash(scenes=[scene], groups=[group])
        with tempfile.TemporaryDirectory() as directory:
            service, _box = make_service(directory, stash, source="tpdb", settings={"syncSceneGroupsDryRun": False})
            responses = iter([{"movies": [remote_record]}, {"groups": [remote_record]}, {}])
            service.tpdb_transport = lambda _box: type("Remote", (), {"scene": lambda _self, _id: next(responses)})()
            first = service.sync_scene_groups()
            second = service.sync_scene_groups()
            third = service.sync_scene_groups()

        self.assertEqual(first["groups_updated"], 1)
        self.assertEqual(stash.group_updates[0]["synopsis"], "Imported synopsis")
        self.assertEqual(stash.group_updates[0]["date"], "2024")
        self.assertEqual(second["groups_updated"], 0)
        self.assertEqual(third["failed"], 0)
        self.assertEqual(third["skipped"], 1)

    def test_tpdb_transport_uses_bearer_auth_encodes_id_and_caches_success(self):
        requests = []

        def fake_urlopen(request, timeout):
            requests.append(request)
            return Response({"data": {"markers": [{"title": "Kissing", "start_time": 3}]}})

        with tempfile.TemporaryDirectory() as directory:
            cache = plugin.ResponseCache(Path(directory) / "cache.sqlite3", 24)
            transport = plugin.TPDBMarkersTransport("secret", cache=cache, min_delay=0)
            with patch.object(plugin.urllib.request, "urlopen", fake_urlopen):
                first = transport.scene("scene/1")
                second = transport.scene("scene/1")

        headers = {key.casefold(): value for key, value in requests[0].header_items()}
        self.assertEqual(headers["authorization"], "Bearer secret")
        self.assertTrue(requests[0].full_url.endswith("scene%2F1"))
        self.assertEqual(first, second)
        self.assertEqual(len(requests), 1)

    def test_local_stash_writes_use_stash_032_mutations_and_add_mode(self):
        requests = []
        responses = [
            {"data": {"findTags": {"count": 1, "tags": [{"id": "tag-1", "name": "Blowjob", "description": None, "aliases": [], "stash_ids": []}]}}},
            {"data": {"findScenes": {"count": 1, "scenes": [{"id": "scene-1", "tags": [], "stash_ids": []}]}}},
            {"data": {"bulkSceneUpdate": [{"id": "scene-1"}]}},
            {"data": {"sceneMarkerCreate": {"id": "marker-1", "title": "Blowjob", "seconds": 3, "primary_tag": {"id": "tag-1", "name": "Blowjob"}}}},
        ]

        def fake_urlopen(request, timeout):
            requests.append(json.loads(request.data))
            return Response(responses.pop(0))

        stash = plugin.LocalStash({"Scheme": "http", "Host": "localhost", "Port": 9999,
                                   "SessionCookie": {"Name": "session", "Value": "test-session"}})
        with patch.object(plugin.urllib.request, "urlopen", fake_urlopen):
            tags = stash.tags()
            scenes = stash.scenes_for_box("https://stashdb.org/graphql")
            stash.add_scene_tags("scene-1", ["tag-1"])
            marker = stash.create_scene_marker({"scene_id": "scene-1", "title": "Blowjob", "seconds": 3,
                                                "primary_tag_id": "tag-1", "tag_ids": ["tag-1"]})

        self.assertEqual(tags[0]["id"], "tag-1")
        self.assertEqual(scenes[0]["id"], "scene-1")
        self.assertEqual(marker["id"], "marker-1")
        self.assertEqual(requests[1]["variables"]["scene_filter"]["stash_ids_endpoint"],
                         {"endpoint": "https://stashdb.org/graphql", "modifier": "NOT_NULL"})
        self.assertEqual(requests[2]["variables"]["input"]["tag_ids"], {"ids": ["tag-1"], "mode": "ADD"})
        self.assertIn("SceneMarkerCreateInput", requests[3]["query"])
        self.assertEqual(requests[3]["variables"]["input"]["primary_tag_id"], "tag-1")

    def test_group_and_scene_link_mutations_use_stash_032_fields(self):
        requests = []
        responses = [
            {"data": {"findGroups": {"count": 0, "groups": []}}},
            {"data": {"groupCreate": {"id": "group-1", "name": "Movie One", "urls": []}}},
            {"data": {"groupUpdate": {"id": "group-1", "name": "Movie One", "urls": []}}},
            {"data": {"sceneUpdate": {"id": "scene-1"}}},
        ]

        def fake_urlopen(request, timeout):
            requests.append(json.loads(request.data))
            return Response(responses.pop(0))

        stash = plugin.LocalStash({"Scheme": "http", "Host": "localhost", "Port": 9999,
                                   "SessionCookie": {"Name": "session", "Value": "test-session"}})
        with patch.object(plugin.urllib.request, "urlopen", fake_urlopen):
            self.assertEqual(stash.groups(), [])
            created = stash.create_group({"name": "Movie One", "urls": ["https://theporndb.net/movies/1"]})
            stash.update_group({"id": created["id"], "synopsis": "Description"})
            stash.link_scene_groups("scene-1", [{"group_id": "group-1", "scene_index": None}])

        self.assertIn("findGroups", requests[0]["query"])
        self.assertIn("GroupCreateInput", requests[1]["query"])
        self.assertNotIn("stash_ids", requests[1]["variables"]["input"])
        self.assertEqual(requests[1]["variables"]["input"]["urls"], ["https://theporndb.net/movies/1"])
        self.assertIn("GroupUpdateInput", requests[2]["query"])
        self.assertIn("SceneUpdateInput", requests[3]["query"])
        self.assertEqual(requests[3]["variables"]["input"]["groups"],
                         [{"group_id": "group-1", "scene_index": None}])

    def test_marker_normalization_rejects_invalid_and_duplicate_markers(self):
        markers = [
            {"title": "Kissing", "start_time": 2},
            {"title": "Kissing", "start_time": 2.1},
            {"title": "Too late", "start_time": 91},
            {"title": "Bad", "start_time": "not-a-number"},
        ]
        result = plugin.normalize_tpdb_markers(markers, {"files": [{"duration": 90}]})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["seconds"], 2.0)

    def test_marker_duplicate_matches_same_title_and_timestamp(self):
        remote = {"title": "Kissing", "seconds": 12.0}
        local = {"title": "Kissing", "seconds": 12.2, "primary_tag": {"id": "different", "name": "Other"}}

        self.assertTrue(plugin.marker_matches_existing(remote, local, "Kissing", "tag-1"))


if __name__ == "__main__":
    unittest.main()
