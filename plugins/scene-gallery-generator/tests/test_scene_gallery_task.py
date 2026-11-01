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

    def test_gallery_generation_waits_for_every_frame_to_be_indexed(self):
        names = ["frame-001.jpg", "frame-002.jpg"]
        with patch.object(TASK, "find_image_by_path", side_effect=lambda _server, path: {"id": os.path.basename(path)}):
            images = TASK.wait_for_indexed_images({}, "/images/scene", names, timeout=0)
        self.assertEqual([image["id"] for image in images], names)

    def test_gallery_generation_does_not_continue_with_missing_indexed_frames(self):
        with patch.object(TASK, "find_image_by_path", side_effect=lambda _server, path: {"id": "frame-001"} if path.endswith("frame-001.jpg") else None):
            with self.assertRaisesRegex(RuntimeError, "No gallery was created or linked"):
                TASK.wait_for_indexed_images({}, "/images/scene", ["frame-001.jpg", "frame-002.jpg"], timeout=0)

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
            manifest = {"generated_files": ["frame-001.jpg"], "image_count": 1, "sampling_mode": "smart", "file_ids": ["file-1"]}
            gallery = {"id": "gallery-1"}
            snapshot = {"id": "gallery-1", "title": "Sample scene — Scene Gallery", "files": [{"id": "file-1", "path": frame_path}]}
            with patch.object(TASK, "current_gallery_ids_for_scene", return_value=["gallery-1"]), patch.object(TASK, "get_gallery_snapshot", return_value=snapshot):
                self.assertTrue(TASK.existing_gallery_is_complete({}, scene, directory, 1, "smart", manifest, gallery))
            with patch.object(TASK, "current_gallery_ids_for_scene", return_value=[]), patch.object(TASK, "get_gallery_snapshot", return_value=snapshot):
                self.assertFalse(TASK.existing_gallery_is_complete({}, scene, directory, 1, "smart", manifest, gallery))

    def test_hook_scene_id_extraction_handles_nested_stash_payloads(self):
        self.assertEqual(TASK.scene_id_from_hook({"input": {"scene": {"id": 42}}}), "42")
        self.assertEqual(TASK.scene_id_from_hook({"scene_id": "17"}), "17")
        self.assertEqual(TASK.scene_id_from_hook({"input": {"scene": {"title": "No ID"}}}), "")


if __name__ == "__main__":
    unittest.main()
