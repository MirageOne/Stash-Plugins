import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "tpdb_markers.py"
SPEC = importlib.util.spec_from_file_location("tpdb_markers", SCRIPT)
tpdb_markers = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tpdb_markers)


class Logger:
    def __init__(self):
        self.messages = []
        self.progress_values = []

    def info(self, message):
        self.messages.append(("info", message))

    def warning(self, message):
        self.messages.append(("warning", message))

    def error(self, message):
        self.messages.append(("error", message))

    def debug(self, message):
        self.messages.append(("debug", message))

    def progress(self, value):
        self.progress_values.append(value)


class Response:
    status_code = 200

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class Session:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def get(self, url, timeout):
        self.calls.append((url, timeout))
        return Response(self.payload)


class Stash:
    def __init__(self):
        self.created_groups = []
        self.updated_scenes = []
        self.deleted_markers = []
        self.tags = []
        self.existing_groups = []

    def find_tag(self, name, create=False):
        self.tags.append((name, create))
        return {"id": 42}

    def find_groups(self, f=None, q=None):
        if f and f.get("url"):
            target = f["url"]["value"]
            return [group for group in self.existing_groups if target in group.get("urls", [])]
        if q:
            return [group for group in self.existing_groups if group.get("name") == q]
        return []

    def find_studio(self, name, create=False):
        return {"id": 8, "name": name}

    def create_group(self, group_input):
        created = {"id": 100 + len(self.created_groups), **group_input}
        self.created_groups.append(group_input)
        return created

    def update_scene(self, scene):
        self.updated_scenes.append(scene)

    def destroy_scene_markers(self, scene_id):
        self.deleted_markers.append(scene_id)


def scene(scene_id=1, markers=None, groups=None):
    return {
        "id": scene_id,
        "stash_ids": [{"endpoint": tpdb_markers.TPDB_STASH_ENDPOINT, "stash_id": "scene/a"}],
        "scene_markers": markers or [],
        "groups": groups or [],
    }


class TPDBMarkersTests(unittest.TestCase):
    def setUp(self):
        self.logger = Logger()
        self.stash = Stash()
        self.settings = tpdb_markers.DEFAULT_SETTINGS.copy()
        self.imported = []

    def import_markers(self, stash, markers, scene_id, pad):
        self.imported.append((scene_id, markers, pad))

    def test_missing_deleted_scene_is_skipped_without_http_request(self):
        session = Session({"data": {}})
        result = tpdb_markers.process_scene(
            self.stash, session, None, self.settings, self.logger, self.import_markers
        )
        self.assertEqual(result["status"], "skipped")
        self.assertEqual(session.calls, [])
        self.assertTrue(any("no longer exists" in message for _, message in self.logger.messages))

    def test_missing_optional_movie_and_group_fields_do_not_break_marker_import(self):
        session = Session({"data": {"markers": [{"title": "Hair", "start_time": 12}]}})
        result = tpdb_markers.process_scene(
            self.stash, session, scene(), self.settings, self.logger, self.import_markers
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["markers"], 1)
        self.assertEqual(len(self.imported), 1)
        self.assertEqual(self.imported[0][0], 1)
        self.assertEqual(self.stash.updated_scenes, [])

    def test_movies_and_groups_are_created_and_linked_without_replacing_existing_links(self):
        session = Session({
            "data": {
                "markers": [],
                "movies": [{"id": "movie-1", "title": "Movie One", "url": "https://tpdb/m1"}],
                "groups": [
                    {"id": "group-2", "title": "Group Two", "url": "https://tpdb/g2"},
                    {"id": "movie-1", "title": "Movie One", "url": "https://tpdb/m1"},
                ],
            }
        })
        existing_link = {"group": {"id": 77}, "scene_index": 3}
        result = tpdb_markers.process_scene(
            self.stash,
            session,
            scene(groups=[existing_link]),
            self.settings,
            self.logger,
            self.import_markers,
        )
        self.assertEqual(result["groups"], 2)
        self.assertEqual(len(self.stash.created_groups), 2)
        self.assertEqual(self.stash.created_groups[0]["urls"], ["https://tpdb/g2"])
        self.assertNotIn("url", self.stash.created_groups[0])
        self.assertEqual(
            self.stash.updated_scenes[0]["groups"],
            [
                {"group_id": 77, "scene_index": 3},
                {"group_id": 100, "scene_index": None},
                {"group_id": 101, "scene_index": None},
            ],
        )

    def test_group_image_failure_retries_without_artwork(self):
        class ImageFailStash(Stash):
            def create_group(inner, group_input):
                inner.created_groups.append(group_input.copy())
                if "front_image" in group_input:
                    raise RuntimeError("groupCreate processing front image: http error 470")
                return {"id": 88, **group_input}

        stash = ImageFailStash()
        remote_group = {
            "title": "Movie",
            "url": "https://tpdb/movie",
            "image": "https://images.example/movie.jpg",
        }
        settings = {**self.settings, "importGroupImages": True}
        result = tpdb_markers._get_or_create_group(stash, remote_group, settings, self.logger)
        self.assertEqual(result["id"], 88)
        self.assertEqual(len(stash.created_groups), 2)
        self.assertIn("front_image", stash.created_groups[0])
        self.assertNotIn("front_image", stash.created_groups[1])

    def test_settings_match_stash_plugin_key_case_and_legacy_group_setting(self):
        settings = tpdb_markers.load_settings({
            "plugins": {
                "tPdBmarkers": {
                    "createMovieFromScene": False,
                    "mergeMarkers": True,
                }
            }
        })
        self.assertFalse(settings["createGroupsFromScene"])
        self.assertTrue(settings["mergeMarkers"])

    def test_python_38_gets_an_actionable_dependency_error(self):
        with patch.object(tpdb_markers.sys, "version_info", (3, 8)):
            with patch("sys.stderr", new_callable=io.StringIO) as stderr:
                result = tpdb_markers.main(io.StringIO('{"server_connection": {}}'))
        self.assertEqual(result, 1)
        self.assertIn("requires Python 3.9 or newer", stderr.getvalue())

    def test_batch_logs_each_scene_and_enables_marked_scene_filter_for_merge(self):
        scenes = [scene(1, markers=[{"id": 11}]), scene(2, markers=[{"id": 12}])]

        class BatchStash(Stash):
            def find_scenes(inner, filters, filter, get_count=False):
                inner.last_filter = filters
                if get_count:
                    return (2, [])
                return scenes

        stash = BatchStash()
        settings = {**self.settings, "mergeMarkers": True}
        result = tpdb_markers.sync_all(
            stash,
            Session({"data": {"markers": []}}),
            settings,
            self.logger,
            self.import_markers,
            sleep_fn=lambda _: None,
        )
        self.assertEqual(result, {"total": 2, "processed": 2, "errors": 0})
        self.assertNotIn("has_markers", stash.last_filter)
        self.assertEqual(self.logger.progress_values, [0.5, 1.0])
        self.assertTrue(any("Processed 1/2" in message for _, message in self.logger.messages))


if __name__ == "__main__":
    unittest.main()
