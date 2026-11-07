import importlib.util
import json
import io
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "stash_metadata_sync.py"
SPEC = importlib.util.spec_from_file_location("stash_metadata_sync", SCRIPT)
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


class StashMetadataSyncTests(unittest.TestCase):
    def test_progress_uses_stash_protocol_instead_of_plain_stderr_error(self):
        stream = io.StringIO()
        with redirect_stderr(stream):
            plugin.report_progress(27, 243)

        self.assertEqual(stream.getvalue(), f"{plugin.PROGRESS_PREFIX}{27 / 243}\n")
        self.assertNotIn("Processed", stream.getvalue())

    def test_stash_032_local_auth_and_configuration_query(self):
        seen = {}

        def fake_urlopen(request, timeout):
            seen["request"] = request
            seen["timeout"] = timeout
            return Response({"data": {"configuration": {"general": {"stashBoxes": []}, "plugins": {}}}})

        stash = plugin.LocalStash({
            "Scheme": "http", "Host": "localhost", "Port": 9999,
            "SessionCookie": {"Name": "session", "Value": "test-session"},
        })
        with patch.object(plugin.urllib.request, "urlopen", fake_urlopen):
            result = stash.configuration()

        self.assertEqual(result["general"]["stashBoxes"], [])
        request = seen["request"]
        self.assertEqual(request.get_header("Cookie"), "session=test-session")
        query = json.loads(request.data)["query"]
        self.assertIn("api_key", query)
        self.assertIn('plugins(include: ["stash-metadata-sync"])', query)

    def test_maps_stashbox_metadata_to_stash_032_fields_without_clearing_data(self):
        local = {
            "id": "42", "name": "Local Name", "height_cm": 172,
            "measurements": "", "alias_list": ["Known alias"], "urls": [],
            "image_path": "/performer/42.jpg", "stash_ids": [{"endpoint": "https://stashdb.org/graphql", "stash_id": "p-1"}],
        }
        box = {"endpoint": "https://stashdb.org/graphql"}
        remote = {
            "id": "p-1", "name": "Remote Name", "aliases": ["Known alias", "New alias"],
            "gender": "FEMALE", "birth_date": "1992-05-04", "country": "Canada", "height": 168,
            "measurements": {"cup_size": "D", "band_size": 34, "waist": 25, "hip": 36},
            "career_start_year": 2012, "urls": [{"url": "https://example.test/profile", "type": "OFFICIAL"}],
            "images": [{"url": "https://example.test/image.jpg", "width": 100, "height": 100}],
        }

        update = plugin.build_performer_update(local, [(box, remote)], plugin.DEFAULT_SETTINGS)

        self.assertEqual(update["id"], "42")
        self.assertNotIn("name", update)
        self.assertNotIn("height_cm", update)
        self.assertEqual(update["birthdate"], "1992-05-04")
        self.assertEqual(update["gender"], "FEMALE")
        self.assertEqual(update["measurements"], "D34-25-36")
        self.assertEqual(update["career_start"], "2012")
        self.assertEqual(update["alias_list"], ["Known alias", "New alias"])
        self.assertEqual(update["urls"], ["https://example.test/profile"])
        self.assertNotIn("image", update)
        self.assertNotIn("stash_ids", update)
        self.assertNotIn("details", update)

    def test_overwrite_setting_updates_populated_fields_and_image(self):
        local = {"id": "8", "name": "Old", "height_cm": 165, "image_path": "/old.jpg", "stash_ids": []}
        remote = {"id": "new-id", "name": "New", "height": 170, "images": [{"url": "https://example.test/new.jpg"}]}
        settings = {**plugin.DEFAULT_SETTINGS, "overwriteExisting": True}

        update = plugin.build_performer_update(local, [({"endpoint": "https://stashdb.org/graphql"}, remote)], settings)

        self.assertEqual(update["height_cm"], 170)
        self.assertEqual(update["name"], "New")
        self.assertEqual(update["image"], "https://example.test/new.jpg")
        self.assertEqual(update["stash_ids"], [{"endpoint": "https://stashdb.org/graphql", "stash_id": "new-id"}])

    def test_sources_are_detected_and_ordered_using_stash_settings(self):
        boxes = [
            {"name": "FansDB", "endpoint": "https://fansdb.cc/graphql", "api_key": "f"},
            {"name": "StashDB", "endpoint": "https://stashdb.org/graphql", "api_key": "s"},
            {"name": "ThePornDB", "endpoint": "https://theporndb.net/graphql", "api_key": "t"},
        ]
        config = {"general": {"stashBoxes": boxes}, "plugins": {plugin.PLUGIN_ID: {
            "sourcePrecedence": "tpdb, stashdb, fansdb", "enableFansDB": False,
        }}}

        service = plugin.SyncService(object(), config, object())

        self.assertEqual([box["source"] for box in service.boxes], ["tpdb", "stashdb"])
        report = service.validate_config()
        self.assertTrue(report["ok"])
        self.assertEqual(report["enabled_sources"], ["tpdb", "stashdb"])

    def test_external_transport_sends_stashbox_apikey_and_uses_response_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = plugin.ResponseCache(Path(directory) / "cache.sqlite3", 24)
            seen = []

            def fake_urlopen(request, timeout):
                seen.append(request)
                return Response({"data": {"__typename": "Query"}})

            transport = plugin.GraphQLTransport("https://stashdb.org/graphql", "private-key", cache=cache, min_delay=0)
            with patch.object(plugin.urllib.request, "urlopen", fake_urlopen):
                first = transport.request("query Ping { __typename }")
                second = transport.request("query Ping { __typename }")

            self.assertEqual(first, second)
            self.assertEqual(len(seen), 1)
            self.assertEqual(seen[0].get_header("Apikey"), "private-key")

    def test_favorite_performer_query_uses_stashbox_pagination_and_supported_schema(self):
        box = {"name": "StashDB", "endpoint": "https://stashdb.org/graphql", "api_key": "key", "source": "stashdb"}
        config = {"general": {"stashBoxes": [box]}, "plugins": {plugin.PLUGIN_ID: {}}}
        with tempfile.TemporaryDirectory() as directory:
            service = plugin.SyncService(object(), config, plugin.ResponseCache(Path(directory) / "cache.sqlite3"))

            class FakeTransport:
                def __init__(self):
                    self.calls = []

                def request(self, query, variables, cacheable):
                    self.calls.append((query, variables, cacheable))
                    page = variables["input"]["page"]
                    count = plugin.PAGE_SIZE + 1
                    records = [{"id": str(index), "name": f"Performer {index}"}
                               for index in range(1 if page == 2 else plugin.PAGE_SIZE)]
                    return {"queryPerformers": {"count": count, "performers": records}}

            fake = FakeTransport()
            service.transport = lambda _box: fake
            favorites = service.favorite_items(box, "performers")

        self.assertEqual(len(favorites), plugin.PAGE_SIZE + 1)
        self.assertEqual(len(fake.calls), 2)
        self.assertIn("queryPerformers", fake.calls[0][0])
        self.assertIn("PerformerQueryInput", fake.calls[0][0])
        self.assertEqual(fake.calls[0][1]["input"]["is_favorite"], True)
        self.assertEqual(fake.calls[1][1]["input"]["page"], 2)

    def test_favorite_import_adds_source_id_to_name_matched_local_record(self):
        box = {"name": "StashDB", "endpoint": "https://stashdb.org/graphql", "api_key": "key", "source": "stashdb"}
        record = {"id": "5", "name": "Local Performer", "favorite": False, "stash_ids": []}

        class FakeStash:
            def __init__(self):
                self.updated = []

            def performers(self):
                return [record]

            def update_performer(self, values):
                self.updated.append(values)

        stash = FakeStash()
        config = {"general": {"stashBoxes": [box]}, "plugins": {plugin.PLUGIN_ID: {}}}
        with tempfile.TemporaryDirectory() as directory:
            service = plugin.SyncService(stash, config, plugin.ResponseCache(Path(directory) / "cache.sqlite3"))
            service.favorite_items = lambda _box, _kind: [{"id": "ext-1", "name": "Local Performer"}]
            result = service.sync_favorites("performers")

        self.assertEqual(result["marked"], 1)
        self.assertEqual(stash.updated[0]["favorite"], True)
        self.assertEqual(stash.updated[0]["stash_ids"], [{"endpoint": box["endpoint"], "stash_id": "ext-1"}])


if __name__ == "__main__":
    unittest.main()
