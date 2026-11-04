import importlib.util
import os
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scene_gallery_task.py"))
SPEC = importlib.util.spec_from_file_location("scene_gallery_task", SCRIPT)
TASK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TASK)


class SceneGalleryTaskTests(unittest.TestCase):
    def test_image_count_is_bounded(self):
        self.assertEqual(TASK.validate_image_count(1), 1)
        self.assertEqual(TASK.validate_image_count("30"), 30)
        with self.assertRaises(RuntimeError):
            TASK.validate_image_count(0)
        with self.assertRaises(RuntimeError):
            TASK.validate_image_count(31)
        with self.assertRaises(RuntimeError):
            TASK.validate_image_count(8.5)
        with self.assertRaises(RuntimeError):
            TASK.validate_image_count("8.5")

    def test_log_info_routes_plugin_messages_through_stash_log_api(self):
        with patch.object(TASK.log, "LogInfo") as log_info:
            TASK.log_info("Queued Stash image scan 163")
        log_info.assert_called_once_with("[Scene Gallery Generator] Queued Stash image scan 163")

    def test_logging_and_progress_support_current_stashapi_methods(self):
        calls = []
        modern_logger = type("ModernLogger", (), {
            "info": staticmethod(lambda message: calls.append(("info", message))),
            "error": staticmethod(lambda message: calls.append(("error", message))),
            "progress": staticmethod(lambda value: calls.append(("progress", value))),
        })()
        with patch.object(TASK, "log", modern_logger):
            TASK.log_info("Queued Stash image scan 163")
            TASK.log_error("Task failed: sample")
            TASK.report_progress(0.5)
        self.assertEqual(calls, [
            ("info", "[Scene Gallery Generator] Queued Stash image scan 163"),
            ("error", "[Scene Gallery Generator] Task failed: sample"),
            ("progress", 0.5),
        ])

    def test_frame_sampling_returns_requested_count_inside_safe_margins(self):
        timestamps = TASK.frame_timestamps(100.0, 4)
        self.assertEqual(len(timestamps), 4)
        self.assertGreater(timestamps[0], 6.0)
        self.assertLess(timestamps[-1], 94.0)
        self.assertEqual(timestamps, sorted(timestamps))
        self.assertAlmostEqual(TASK.frame_timestamps(100.0, 1)[0], 50.0)

    def test_smart_sampling_prefers_scene_changes_and_avoids_black_ranges(self):
        timestamps = TASK.choose_smart_timestamps(100.0, 4, [15.0, 40.0, 80.0], [(0.0, 10.0)])
        self.assertEqual(len(timestamps), 4)
        self.assertIn(15.0, timestamps)
        self.assertIn(40.0, timestamps)
        self.assertIn(80.0, timestamps)
        self.assertTrue(all(not TASK.is_black_time(value, [(0.0, 10.0)]) for value in timestamps))
        with self.assertRaises(RuntimeError):
            TASK.choose_smart_timestamps(100.0, 4, [], [(0.0, 100.0)])

    def test_sampling_mode_is_restricted_to_supported_strategies(self):
        self.assertEqual(TASK.validate_sampling_mode("smart"), "smart")
        self.assertEqual(TASK.validate_sampling_mode("uniform"), "uniform")
        with self.assertRaises(RuntimeError):
            TASK.validate_sampling_mode("random")

    def test_low_resolution_signature_flags_dark_and_near_identical_frames(self):
        base = bytes([100, 120, 140] * (16 * 9))
        almost_same = bytes([101, 119, 140] * (16 * 9))
        different = bytes([30, 210, 45] * (16 * 9))
        dark = bytes([0, 0, 1] * (16 * 9))
        self.assertGreater(TASK.signature_average_luma(base), 5)
        self.assertLess(TASK.signature_average_luma(dark), 5)
        self.assertLess(TASK.signature_difference(base, almost_same), 3.5)
        self.assertGreater(TASK.signature_difference(base, different), 3.5)

    def test_output_path_must_be_inside_the_selected_image_library(self):
        with tempfile.TemporaryDirectory() as library:
            allowed = TASK.choose_image_library({"stashes": [{"path": library, "excludeImage": False}]})
            self.assertEqual(allowed, TASK.normalize_path(library))
            with self.assertRaises(RuntimeError):
                TASK.choose_image_library({"stashes": [{"path": library, "excludeImage": True}]})
            with self.assertRaises(RuntimeError):
                TASK.choose_image_library({"stashes": [{"path": library, "excludeImage": False}]}, "/tmp")

    def test_scene_id_is_validated_before_becoming_a_path(self):
        self.assertEqual(TASK.valid_scene_id("12345"), "12345")
        for value in ("../other", "", "1/2", "abc"):
            with self.subTest(value=value):
                with self.assertRaises(RuntimeError):
                    TASK.valid_scene_id(value)

    def test_archive_filename_uses_a_portable_scene_title(self):
        self.assertEqual(TASK.scene_archive_name({"id": "123", "title": "Déjà Vu: Chapter / Finale?"}), "Déjà Vu_ Chapter _ Finale_.zip")
        self.assertEqual(TASK.scene_archive_name({"id": "123", "title": ""}), "Scene 123.zip")

    def test_output_directory_rejects_a_symlinked_plugin_folder(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            os.symlink(outside, os.path.join(root, "Scene Gallery Generator"))
            with self.assertRaises(RuntimeError):
                TASK.output_directory(root, "123")

    def test_gallery_metadata_copies_supported_scene_fields(self):
        scene = {
            "id": "123",
            "title": "Sample scene",
            "details": "Scene details",
            "url": "https://example.invalid/scene",
            "date": "2025-01-02",
            "rating100": 80,
            "organized": True,
            "studio": {"id": "9"},
            "performers": [{"id": "2"}],
            "tags": [{"id": "4"}],
        }
        fields = {"title", "details", "url", "date", "rating100", "organized", "studio_id", "performer_ids", "tag_ids", "code"}
        values = TASK.metadata_input(scene, "Sample scene — Scene Gallery", fields, include_identity=True)
        self.assertEqual(values["title"], "Sample scene — Scene Gallery")
        self.assertEqual(values["details"], "Scene details")
        self.assertEqual(values["url"], "https://example.invalid/scene")
        self.assertEqual(values["date"], "2025-01-02")
        self.assertEqual(values["rating100"], 80)
        self.assertEqual(values["studio_id"], "9")
        self.assertEqual(values["performer_ids"], ["2"])
        self.assertEqual(values["tag_ids"], ["4"])
        self.assertEqual(values["code"], "SGG-123")

    def test_gallery_scene_link_preserves_existing_scene_links(self):
        with patch.object(TASK, "graphql", side_effect=[
                {"findGallery": {"scenes": [{"id": "existing-scene"}]}},
                {"galleryUpdate": {"id": "gallery-1"}},
                {"findScene": {"galleries": [{"id": "another-gallery"}]}},
                {"sceneUpdate": {"id": "new-scene"}}]) as graphql, patch.object(TASK, "introspect_fields", return_value={"gallery_ids"}):
            TASK.link_gallery_to_scene({}, "new-scene", "gallery-1", {"scene_ids"})
        mutation_variables = graphql.call_args_list[1].args[2]
        self.assertEqual(mutation_variables["input"]["scene_ids"], ["existing-scene", "new-scene"])
        self.assertEqual(graphql.call_args_list[3].args[2]["input"]["gallery_ids"], ["another-gallery", "gallery-1"])

    def test_image_metadata_update_does_not_mutate_zip_gallery_membership(self):
        image = {"id": "image-1", "galleries": [{"id": "gallery-1"}]}
        scene = {"id": "123", "title": "Sample scene", "details": "Scene details"}
        with patch.object(TASK, "graphql") as graphql:
            TASK.update_image_metadata({}, image, scene, {"id", "title", "details", "gallery_ids"}, 1)
        update = graphql.call_args.args[2]["input"]
        self.assertEqual(update["details"], "Scene details")
        self.assertNotIn("gallery_ids", update)

    def test_gallery_generation_waits_for_every_frame_to_be_indexed(self):
        names = ["frame-001.jpg", "frame-002.jpg"]
        paths = []
        def find_image(_server, path):
            paths.append(path)
            return {"id": os.path.basename(path)}
        with patch.object(TASK, "find_image_by_path", side_effect=find_image):
            images = TASK.wait_for_indexed_images({}, "/images/scene", names, "Sample scene.zip", timeout=0)
        self.assertEqual([image["id"] for image in images], names)
        self.assertEqual(paths, ["/images/scene/Sample scene.zip/frame-001.jpg", "/images/scene/Sample scene.zip/frame-002.jpg"])

    def test_gallery_generation_does_not_continue_with_missing_indexed_frames(self):
        with patch.object(TASK, "find_image_by_path", side_effect=lambda _server, path: {"id": "frame-001"} if path.endswith("frame-001.jpg") else None):
            with self.assertRaisesRegex(RuntimeError, "No gallery was created or linked"):
                TASK.wait_for_indexed_images({}, "/images/scene", ["frame-001.jpg", "frame-002.jpg"], timeout=0)

    def test_gallery_archive_contains_exact_generated_frames_and_replaces_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            for name, payload in (("frame-001.jpg", b"one"), ("frame-002.jpg", b"two"), ("not-generated.jpg", b"keep")):
                with open(os.path.join(directory, name), "wb") as handle:
                    handle.write(payload)
            archive_path = TASK.create_gallery_archive(directory, ["frame-001.jpg", "frame-002.jpg"])
            self.assertTrue(TASK.gallery_archive_matches(directory, ["frame-001.jpg", "frame-002.jpg"]))
            with TASK.zipfile.ZipFile(archive_path, "r") as archive:
                self.assertEqual(archive.namelist(), ["frame-001.jpg", "frame-002.jpg"])
                self.assertEqual(archive.read("frame-002.jpg"), b"two")
            self.assertFalse(TASK.gallery_archive_matches(directory, ["frame-001.jpg"]))

    def test_gallery_archive_rejects_symlinked_frames(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            outside_frame = os.path.join(outside, "frame-001.jpg")
            with open(outside_frame, "wb") as handle:
                handle.write(b"frame")
            os.symlink(outside_frame, os.path.join(directory, "frame-001.jpg"))
            with self.assertRaisesRegex(RuntimeError, "missing or outside"):
                TASK.create_gallery_archive(directory, ["frame-001.jpg"])

    def test_gallery_archive_rejects_symlinked_archive_path(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            frame_path = os.path.join(directory, "frame-001.jpg")
            with open(frame_path, "wb") as handle:
                handle.write(b"frame")
            os.symlink(os.path.join(outside, "gallery.zip"), os.path.join(directory, "gallery.zip"))
            with self.assertRaisesRegex(RuntimeError, "archive cannot be a symbolic link"):
                TASK.create_gallery_archive(directory, ["frame-001.jpg"])

    def test_gallery_archive_rejects_duplicate_frame_names(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "frame list is invalid"):
                TASK.create_gallery_archive(directory, ["frame-001.jpg", "frame-001.jpg"])

    def test_stale_plugin_archives_are_removed_before_rescan(self):
        with tempfile.TemporaryDirectory() as directory:
            names = ["gallery.zip", "Old Scene.zip", "Current Scene.zip"]
            for name in names:
                with open(os.path.join(directory, name), "wb") as handle:
                    handle.write(b"zip")
            removed = TASK.remove_stale_gallery_archives(directory, {"plugin": TASK.PLUGIN_ID, "archive_file": "Old Scene.zip"}, "Current Scene.zip")
            self.assertEqual(set(os.path.basename(path) for path in removed), {"gallery.zip", "Old Scene.zip"})
            self.assertTrue(os.path.isfile(os.path.join(directory, "Current Scene.zip")))

    def test_generated_frame_copies_are_removed_after_archiving(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ("frame-001.jpg", "frame-002.jpg", "cover.jpg"):
                with open(os.path.join(directory, name), "wb") as handle:
                    handle.write(b"image")
            removed = TASK.remove_generated_frame_files(directory)
            self.assertEqual(set(os.path.basename(path) for path in removed), {"frame-001.jpg", "frame-002.jpg"})
            self.assertFalse(os.path.exists(os.path.join(directory, "frame-001.jpg")))
            self.assertTrue(os.path.isfile(os.path.join(directory, "cover.jpg")))

    def test_gallery_creation_rejects_missing_frame_records_before_mutating_stash(self):
        with patch.object(TASK, "introspect_fields", side_effect=AssertionError("Stash must not be mutated")):
            with self.assertRaisesRegex(RuntimeError, "has not indexed every generated frame"):
                TASK.create_or_update_gallery({}, {"id": "123"}, "/images/scene", ["frame-001.jpg"], [None], {})

    def test_gallery_completion_requires_all_generated_frames_and_scene_link(self):
        with tempfile.TemporaryDirectory() as directory:
            frame_path = os.path.join(directory, "frame-001.jpg")
            with open(frame_path, "wb") as handle:
                handle.write(b"frame")
            scene = {"id": "123", "title": "Sample scene"}
            archive_name = TASK.scene_archive_name(scene)
            TASK.create_gallery_archive(directory, ["frame-001.jpg"], archive_name)
            manifest = {"generated_files": ["frame-001.jpg"], "image_count": 1, "sampling_mode": "smart", "file_ids": ["file-1"], "archive_file": archive_name}
            gallery = {"id": "gallery-1"}
            snapshot = {"id": "gallery-1", "title": "Sample scene — Scene Gallery", "files": [{"id": "archive-1", "path": os.path.join(directory, archive_name)}], "scenes": [{"id": "123"}]}
            with patch.object(TASK, "current_gallery_ids_for_scene", return_value=["gallery-1"]), patch.object(TASK, "get_gallery_snapshot", return_value=snapshot), patch.object(TASK, "images_linked_to_gallery", return_value=True):
                self.assertTrue(TASK.existing_gallery_is_complete({}, scene, directory, 1, "smart", manifest, gallery))
            with patch.object(TASK, "current_gallery_ids_for_scene", return_value=[]), patch.object(TASK, "get_gallery_snapshot", return_value=snapshot), patch.object(TASK, "images_linked_to_gallery", return_value=True):
                self.assertFalse(TASK.existing_gallery_is_complete({}, scene, directory, 1, "smart", manifest, gallery))

    def test_scene_metadata_must_match_gallery_values(self):
        scene = {"id": "123", "title": "Sample scene", "details": "Copied details", "performers": [{"id": "2"}]}
        gallery = {"title": "Sample scene — Scene Gallery", "details": "Copied details", "performers": [{"id": "2"}]}
        self.assertTrue(TASK.scene_metadata_matches(scene, gallery))
        gallery["performers"] = []
        self.assertFalse(TASK.scene_metadata_matches(scene, gallery))

    def test_hook_scene_id_extraction_handles_nested_stash_payloads(self):
        self.assertEqual(TASK.scene_id_from_hook({"input": {"scene": {"id": 42}}}), "42")
        self.assertEqual(TASK.scene_id_from_hook({"scene_id": "17"}), "17")
        self.assertEqual(TASK.scene_id_from_hook({"input": {"scene": {"title": "No ID"}}}), "")


if __name__ == "__main__":
    unittest.main()
