"""Focused safety and path tests for the Stash raw-task backend."""

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts")))
import download


class DownloaderBackendTests(unittest.TestCase):
    def test_url_validation_accepts_http_and_https(self):
        self.assertEqual(download.validate_http_url("https://media.example/video.mp4"), "https://media.example/video.mp4")
        self.assertEqual(download.validate_http_url("http://media.example/item"), "http://media.example/item")

    def test_url_validation_rejects_local_files_and_embedded_credentials(self):
        for url in ("file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com/file"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                download.validate_http_url(url)

    def test_filename_is_a_portable_basename(self):
        result = download.sanitize_filename("../../CON.mp4")
        self.assertNotIn("/", result)
        self.assertNotIn("\\", result)
        self.assertEqual(result, "_CON.mp4")
        self.assertEqual(download.sanitize_filename("..."), "download")

    def test_result_id_cannot_escape_result_directory(self):
        with self.assertRaises(ValueError):
            download.get_result_path("../../outside")
        path = download.get_result_path("download-123_safe")
        self.assertEqual(os.path.dirname(path), download.RESULT_DIR)

    def test_ytdlp_error_keeps_cause_but_redacts_url_tokens_and_proxy_credentials(self):
        message = "ERROR: https://media.example/watch?id=private failed via http://alice:secret@proxy.example:8080"
        safe_message = download.redact_ytdlp_error(
            message,
            "https://media.example/watch?id=private",
            "http://alice:secret@proxy.example:8080",
        )

        self.assertIn("ERROR:", safe_message)
        self.assertIn("media.example", safe_message)
        self.assertIn("failed", safe_message)
        self.assertIn("proxy.example:8080", safe_message)
        self.assertNotIn("private", safe_message)
        self.assertNotIn("secret", safe_message)

    def test_default_destination_uses_first_video_enabled_library(self):
        with tempfile.TemporaryDirectory() as root:
            excluded = os.path.join(root, "images")
            videos = os.path.join(root, "videos")
            os.makedirs(excluded)
            os.makedirs(videos)
            config = {
                "general": {"stashes": [
                    {"path": excluded, "excludeVideo": True},
                    {"path": videos, "excludeVideo": False},
                ]},
                "plugins": {"stash-downloader": {}},
            }
            destination, library_root = download.resolve_download_destination(config)
            self.assertEqual(destination, os.path.realpath(videos))
            self.assertEqual(library_root, os.path.realpath(videos))

    def test_images_use_an_image_enabled_library(self):
        with tempfile.TemporaryDirectory() as root:
            videos = os.path.join(root, "videos")
            images = os.path.join(root, "images")
            os.makedirs(videos)
            os.makedirs(images)
            config = {
                "general": {"stashes": [
                    {"path": videos, "excludeVideo": False, "excludeImage": True},
                    {"path": images, "excludeVideo": True, "excludeImage": False},
                ]},
                "plugins": {"stash-downloader": {}},
            }
            destination, library_root = download.resolve_download_destination(config, "image")
            self.assertEqual(destination, os.path.realpath(images))
            self.assertEqual(library_root, os.path.realpath(images))

    def test_image_download_failure_does_not_fall_back_to_video_extractor(self):
        with tempfile.TemporaryDirectory() as image_library:
            config = {
                "general": {"stashes": [{"path": image_library, "excludeImage": False}]},
                "plugins": {"stash-downloader": {}},
            }
            with patch.object(download, "download_direct_file", return_value=None), patch.object(download, "check_ytdlp") as check_ytdlp:
                result = download.task_download({
                    "url": "https://images.example/picture.jpg",
                    "media_type": "image",
                    "_server_configuration": config,
                    "_server_settings": {},
                })

        self.assertFalse(result["success"])
        self.assertIn("image URL", result["result_error"])
        check_ytdlp.assert_not_called()

    def test_video_download_returns_yt_dlp_failure_details(self):
        with tempfile.TemporaryDirectory() as video_library:
            config = {
                "general": {"stashes": [{"path": video_library, "excludeVideo": False}]},
                "plugins": {"stash-downloader": {}},
            }
            with patch.object(download, "check_ytdlp", return_value=True), patch.object(
                download,
                "download_video",
                return_value=(None, "ERROR: [example] This video is unavailable"),
            ):
                result = download.task_download({
                    "url": "https://media.example/watch/123",
                    "_server_configuration": config,
                    "_server_settings": {},
                })

        self.assertFalse(result["success"])
        self.assertEqual(result["result_error"], "ERROR: [example] This video is unavailable")

    def test_custom_destination_must_stay_inside_a_video_library(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            library = os.path.join(root, "videos")
            custom = os.path.join(library, "Incoming")
            os.makedirs(library)
            config = {
                "general": {"stashes": [{"path": library, "excludeVideo": False}]},
                "plugins": {"stash-downloader": {"serverDownloadPath": custom}},
            }
            destination, library_root = download.resolve_download_destination(config)
            self.assertEqual(destination, os.path.realpath(custom))
            self.assertEqual(library_root, os.path.realpath(library))

            config["plugins"]["stash-downloader"]["serverDownloadPath"] = outside
            with self.assertRaises(RuntimeError):
                download.resolve_download_destination(config)


if __name__ == "__main__":
    unittest.main()
