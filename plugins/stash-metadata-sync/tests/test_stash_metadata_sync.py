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


class BinaryResponse(Response):
    def __init__(self, payload):
        self.payload = payload

    def read(self, size=-1):
        return self.payload if size < 0 else self.payload[:size]


class StashMetadataSyncTests(unittest.TestCase):
    def test_progress_uses_stash_protocol_instead_of_plain_stderr_error(self):
        stream = io.StringIO()
        with redirect_stderr(stream):
            plugin.report_progress(27, 243)

        self.assertEqual(stream.getvalue(), f"{plugin.PROGRESS_PREFIX}{27 / 243}\n")
        self.assertNotIn("Processed", stream.getvalue())

    def test_info_log_uses_stash_info_protocol_and_sanitizes_control_characters(self):
        stream = io.StringIO()
        with redirect_stderr(stream):
            plugin.log_info("Updated tag:\nA\x01e\x02")

        self.assertEqual(stream.getvalue(), f"{plugin.INFO_PREFIX}Updated tag: A e\n")

    def test_image_dimension_reader_handles_png_and_jpeg_headers(self):
        png = b"\x89PNG\r\n\x1a\n" + b"\0" * 8 + (1200).to_bytes(4, "big") + (1800).to_bytes(4, "big")
        jpeg = b"\xff\xd8\xff\xc0\x00\x11\x08\x07\x08\x04\xb0\x04\x00" + b"\0" * 9

        self.assertEqual(plugin.image_dimensions_from_bytes(png), (1200, 1800))
        self.assertEqual(plugin.image_dimensions_from_bytes(jpeg), (1200, 1800))

    def test_local_image_inspection_uses_authenticated_performer_route(self):
        png = b"\x89PNG\r\n\x1a\n" + b"\0" * 8 + (1200).to_bytes(4, "big") + (1800).to_bytes(4, "big")
        seen = {}

        def fake_urlopen(request, timeout):
            seen["request"] = request
            seen["timeout"] = timeout
            return BinaryResponse(png)

        stash = plugin.LocalStash({
            "Scheme": "http", "Host": "localhost", "Port": 9999,
            "SessionCookie": {"Name": "session", "Value": "test-session"},
        })
        with patch.object(plugin.urllib.request, "urlopen", fake_urlopen):
            dimensions = stash.performer_image_dimensions("27")

        self.assertEqual(dimensions, (1200, 1800))
        self.assertEqual(seen["request"].full_url, "http://localhost:9999/performer/27")
        self.assertEqual(seen["request"].get_header("Cookie"), "session=test-session")

    def test_performer_metadata_update_is_written_to_stash_info_log(self):
        endpoint = "https://stashdb.org/graphql"
        performer = {"id": "local-1", "name": "A Performer", "country": "", "stash_ids": [
            {"endpoint": endpoint, "stash_id": "source-1"},
        ]}

        class FakeStash:
            def __init__(self):
                self.updates = []

            def update_performer(self, values):
                self.updates.append(dict(values))

        stash = FakeStash()
        config = {"general": {"stashBoxes": [{"name": "StashDB", "endpoint": endpoint, "api_key": "key"}]},
                  "plugins": {plugin.PLUGIN_ID: {}}}
        with tempfile.TemporaryDirectory() as directory:
            service = plugin.SyncService(stash, config, plugin.ResponseCache(Path(directory) / "cache.sqlite3"))
            service.external_performer = lambda _box, _source_id: {"id": "source-1", "country": "Canada"}
            stream = io.StringIO()
            with redirect_stderr(stream):
                changed = service.sync_performer(performer)

        self.assertTrue(changed)
        self.assertEqual(stash.updates[0]["country"], "Canada")
        self.assertIn(f"{plugin.INFO_PREFIX}Updated performer metadata for A Performer (1 fields).", stream.getvalue())

    def test_metadata_overwrite_does_not_replace_a_higher_resolution_local_image(self):
        endpoint = "https://stashdb.org/graphql"
        performer = {"id": "local-1", "name": "A Performer", "image_path": "/performer/local-1", "stash_ids": [
            {"endpoint": endpoint, "stash_id": "source-1"},
        ]}

        class FakeStash:
            def __init__(self):
                self.updates = []

            def performer_image_dimensions(self, _performer_id):
                return 1600, 2400

            def update_performer(self, values):
                self.updates.append(dict(values))

        stash = FakeStash()
        box = {"name": "StashDB", "endpoint": endpoint, "api_key": "key"}
        config = {"general": {"stashBoxes": [box]}, "plugins": {plugin.PLUGIN_ID: {"overwriteExisting": True}}}
        with tempfile.TemporaryDirectory() as directory:
            service = plugin.SyncService(stash, config, plugin.ResponseCache(Path(directory) / "cache.sqlite3"))
            service.external_performer = lambda _box, _source_id: {
                "id": "source-1", "name": "A Performer",
                "images": [{"url": "https://example.test/smaller.jpg", "width": 1200, "height": 1800}],
            }
            with redirect_stderr(io.StringIO()):
                changed = service.sync_performer(performer)

        self.assertTrue(changed)
        self.assertNotIn("image", stash.updates[0])

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
        remote = {"id": "new-id", "name": "New", "height": 170,
                  "images": [{"url": "https://example.test/new.jpg", "width": 1200, "height": 1800}]}
        settings = {**plugin.DEFAULT_SETTINGS, "overwriteExisting": True}

        update = plugin.build_performer_update(local, [({"endpoint": "https://stashdb.org/graphql"}, remote)], settings)

        self.assertEqual(update["height_cm"], 170)
        self.assertEqual(update["name"], "New")
        self.assertEqual(update["image"], "https://example.test/new.jpg")
        self.assertEqual(update["stash_ids"], [{"endpoint": "https://stashdb.org/graphql", "stash_id": "new-id"}])

    def test_performer_update_chooses_largest_image_across_sources_not_highest_priority(self):
        local = {"id": "local-1", "name": "Performer", "image_path": "", "stash_ids": []}
        sources = [
            ({"endpoint": "https://stashdb.org/graphql", "source": "stashdb"},
             {"id": "small", "images": [{"url": "https://images.test/small.jpg", "width": 600, "height": 900}]}),
            ({"endpoint": "https://theporndb.net/graphql", "source": "tpdb"},
             {"id": "large", "images": [{"url": "https://images.test/large.jpg", "width": 1600, "height": 2400}]}),
        ]

        update = plugin.build_performer_update(local, sources, plugin.DEFAULT_SETTINGS)

        self.assertEqual(update["image"], "https://images.test/large.jpg")

    def test_image_sync_uses_best_configured_source_and_upgrades_lower_resolution_image(self):
        boxes = [
            {"name": "StashDB", "endpoint": "https://stashdb.org/graphql", "api_key": "stash-key"},
            {"name": "ThePornDB", "endpoint": "https://theporndb.net/graphql", "api_key": "tpdb-key"},
        ]
        performer = {"id": "local-1", "name": "Performer", "image_path": "/performer/local-1", "stash_ids": [
            {"endpoint": boxes[0]["endpoint"], "stash_id": "stash-id"},
            {"endpoint": boxes[1]["endpoint"], "stash_id": "tpdb-id"},
        ]}
        remote = {
            "stashdb": {"id": "stash-id", "images": [{"url": "https://images.test/small.jpg", "width": 600, "height": 900}]},
            "tpdb": {"id": "tpdb-id", "images": [{"url": "https://images.test/large.jpg", "width": 1600, "height": 2400}]},
        }
        updates = []
        stash = type("FakeStash", (), {
            "performer_image_dimensions": lambda _self, _id: (300, 450),
            "update_performer": lambda _self, values: updates.append(dict(values)),
        })()
        configuration = {"general": {"stashBoxes": boxes}, "plugins": {plugin.PLUGIN_ID: {}}}
        with tempfile.TemporaryDirectory() as directory:
            service = plugin.SyncService(stash, configuration,
                                         plugin.ResponseCache(Path(directory) / "responses.sqlite3", 0))
            service.external_performer = lambda box, _source_id: remote[box["source"]]
            stream = io.StringIO()
            with redirect_stderr(stream):
                preview = service.sync_performer_image(performer, dry_run=True)
                result = service.sync_performer_image(performer)
                stash.performer_image_dimensions = lambda _id: (2000, 3000)
                current_is_better = service.sync_performer_image(performer)

        self.assertEqual(preview["status"], "preview")
        self.assertEqual(preview["source"], "tpdb")
        self.assertEqual(preview["width"], 1600)
        self.assertEqual(result["status"], "updated")
        self.assertEqual(updates, [{"id": "local-1", "image": "https://images.test/large.jpg"}])
        self.assertEqual(current_is_better["status"], "unchanged")
        self.assertEqual(len(updates), 1)
        self.assertIn(f"{plugin.INFO_PREFIX}Updated performer image for Performer to 1600x2400 from ThePornDB.", stream.getvalue())

    def test_performer_image_picker_lists_candidates_and_applies_selected_image(self):
        box = {"name": "StashDB", "endpoint": "https://stashdb.org/graphql", "api_key": "private-key"}
        performer = {"id": "local-1", "name": "Performer", "image_path": "/performer/local-1", "stash_ids": [
            {"endpoint": box["endpoint"], "stash_id": "stash-id"},
        ]}
        remote = {"id": "stash-id", "images": [
            {"url": "https://images.test/small.jpg", "width": 400, "height": 600},
            {"url": "https://images.test/large.jpg", "width": 1800, "height": 2700},
            {"url": "https://images.test/medium.jpg", "width": 1200, "height": 1800},
        ]}

        class FakeStash:
            def __init__(self):
                self.updates = []

            def performer(self, _performer_id):
                return performer

            def performer_image_dimensions(self, _performer_id):
                return 800, 1200

            def update_performer(self, values):
                self.updates.append(dict(values))

        stash = FakeStash()
        configuration = {"general": {"stashBoxes": [box]}, "plugins": {plugin.PLUGIN_ID: {}}}
        with tempfile.TemporaryDirectory() as directory:
            service = plugin.SyncService(stash, configuration,
                                         plugin.ResponseCache(Path(directory) / "responses.sqlite3", 0))
            service.external_performer = lambda _box, _source_id: remote
            choices = service.get_performer_image_choices("local-1")
            medium = next(item for item in choices["candidates"] if item["url"].endswith("medium.jpg"))
            below_minimum = next(item for item in choices["candidates"] if item["url"].endswith("small.jpg"))
            result = service.apply_performer_image_candidate("local-1", below_minimum["id"])

        self.assertEqual(choices["performer_name"], "Performer")
        self.assertEqual(choices["current_image_url"], "/performer/local-1")
        self.assertEqual(choices["current_image"], {"width": 800, "height": 1200})
        self.assertEqual(choices["candidates"][0]["url"], "https://images.test/large.jpg")
        self.assertTrue(choices["candidates"][0]["is_best"])
        self.assertEqual(medium["width"], 1200)
        self.assertFalse(below_minimum["meets_quality_minimum"])
        self.assertEqual(stash.updates, [{"id": "local-1", "image": "https://images.test/small.jpg"}])
        self.assertEqual(result["width"], 400)
        self.assertNotIn("private-key", json.dumps(choices))

    def test_image_sync_skips_source_below_minimum_quality(self):
        box = {"name": "StashDB", "endpoint": "https://stashdb.org/graphql", "api_key": "key"}
        performer = {"id": "local-1", "name": "Performer", "image_path": "", "stash_ids": [
            {"endpoint": box["endpoint"], "stash_id": "stash-id"},
        ]}
        updates = []
        stash = type("FakeStash", (), {"update_performer": lambda _self, values: updates.append(dict(values))})()
        configuration = {"general": {"stashBoxes": [box]}, "plugins": {plugin.PLUGIN_ID: {}}}
        with tempfile.TemporaryDirectory() as directory:
            service = plugin.SyncService(stash, configuration,
                                         plugin.ResponseCache(Path(directory) / "responses.sqlite3", 0))
            service.external_performer = lambda _box, _source_id: {
                "id": "stash-id", "images": [{"url": "https://images.test/tiny.jpg", "width": 400, "height": 600}],
            }

            result = service.sync_performer_image(performer)

        self.assertEqual(result["status"], "below_minimum")
        self.assertEqual(updates, [])

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
            stream = io.StringIO()
            with redirect_stderr(stream):
                result = service.sync_favorites("performers")

        self.assertEqual(result["marked"], 1)
        self.assertEqual(stash.updated[0]["favorite"], True)
        self.assertEqual(stash.updated[0]["stash_ids"], [{"endpoint": box["endpoint"], "stash_id": "ext-1"}])
        self.assertIn(f"{plugin.INFO_PREFIX}Marked performer as favorite: Local Performer from StashDB.", stream.getvalue())


if __name__ == "__main__":
    unittest.main()
