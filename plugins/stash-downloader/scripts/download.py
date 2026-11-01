#!/usr/bin/env python3
"""
Stash Downloader - Python Backend Script

This script handles server-side downloads using yt-dlp.
It's invoked via Stash's runPluginTask GraphQL mutation.

Requirements:
- The Python version configured for Stash and supported by the installed yt-dlp release
- yt-dlp and requests (see requirements.txt)

Usage:
  Called automatically by the Stash Downloader plugin via runPluginTask.
  Not intended to be run directly.

Result Communication:
  Since runPluginTask doesn't return script output, results are stored in
  a temp file that can be read via the 'read_result' task.
"""

import json
import hashlib
import logging
import os
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

# Configure logging
# Stash shows stderr in its logs. Use INFO by default so messages appear correctly.
# Set STASH_DOWNLOADER_DEBUG=1 for verbose DEBUG logging.
DEBUG_MODE = os.environ.get("STASH_DOWNLOADER_DEBUG", "").lower() in ("1", "true", "yes")
logging.basicConfig(
    level=logging.DEBUG if DEBUG_MODE else logging.INFO,
    format="[stash-downloader] %(levelname)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
log = logging.getLogger(__name__)

# Task results are temporary IPC between Stash plugin operations. Keep them
# outside the installed plugin directory so package installs can be read-only.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.dirname(SCRIPT_DIR)
_RESULT_NAMESPACE = hashlib.sha256(os.path.realpath(PLUGIN_DIR).encode("utf-8")).hexdigest()[:12]
RESULT_DIR = os.path.join(tempfile.gettempdir(), f"stash-downloader-{_RESULT_NAMESPACE}")

# Ensure results directory exists at startup.
os.makedirs(RESULT_DIR, mode=0o700, exist_ok=True)
log.debug(f"Results directory: {RESULT_DIR}")


def ensure_result_dir():
    """Ensure the result directory exists."""
    os.makedirs(RESULT_DIR, mode=0o700, exist_ok=True)
    try:
        os.chmod(RESULT_DIR, 0o700)
    except OSError:
        pass


def cleanup_stale_results(max_age_seconds: int = 24 * 60 * 60) -> None:
    """Remove abandoned result files left by closed browser sessions."""
    try:
        cutoff = time.time() - max_age_seconds
        for name in os.listdir(RESULT_DIR):
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}\.json", name):
                continue
            path = os.path.join(RESULT_DIR, name)
            try:
                if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                    os.remove(path)
            except OSError:
                pass
    except OSError:
        pass


ensure_result_dir()
cleanup_stale_results()


def _validate_result_id(result_id: str) -> str:
    value = str(result_id or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", value):
        raise ValueError("Invalid result ID")
    return value


def get_result_path(result_id: str) -> str:
    """Get the path for a result file."""
    safe_id = _validate_result_id(result_id)
    return os.path.join(RESULT_DIR, f"{safe_id}.json")


def save_result(result_id: str, data: dict) -> bool:
    """Save a result to a file for later retrieval."""
    temp_path = None
    try:
        ensure_result_dir()
        result_path = get_result_path(result_id)
        fd, temp_path = tempfile.mkstemp(prefix=".result-", suffix=".tmp", dir=RESULT_DIR)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, result_path)
        log.debug(f"Saved result to: {result_path}")
        return True
    except Exception as e:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        log.error(f"Failed to save result: {e}")
        return False


def load_result(result_id: str, silent: bool = False) -> Optional[dict]:
    """Load a result from file.

    Args:
        result_id: ID of the result to load
        silent: If True, don't log warnings for missing files (used for progress polling)
    """
    try:
        result_path = get_result_path(result_id)
        if os.path.exists(result_path):
            with open(result_path, "r") as f:
                return json.load(f)
        else:
            if not silent:
                log.debug(f"Result file not found: {result_path}")
            return None
    except Exception as e:
        log.error(f"Failed to load result: {e}")
        return None


def delete_result(result_id: str) -> bool:
    """Delete a result file."""
    try:
        result_path = get_result_path(result_id)
        if os.path.exists(result_path):
            os.remove(result_path)
            log.debug(f"Deleted result: {result_path}")
        return True
    except Exception as e:
        log.error(f"Failed to delete result: {e}")
        return False


# Read input from stdin (Stash passes JSON)
def read_input() -> dict:
    """Read JSON input from stdin."""
    try:
        input_data = sys.stdin.read()
        if input_data:
            return json.loads(input_data)
    except json.JSONDecodeError as e:
        log.error(f"Failed to parse input JSON: {e}")
    return {}


def write_output(result: dict) -> None:
    """Write JSON output to stdout.

    IMPORTANT: Stash expects output in PluginOutput format:
    {
        "error": "optional error string",
        "output": { ... actual result data ... }
    }

    If the result has a 'result_error' field, we put it in 'error'.
    Otherwise, we wrap the entire result in 'output'.

    Based on Stash source code (pkg/plugin/common/msg.go):
    - PluginOutput struct has Error (*string) and Output (interface{})
    - If JSON doesn't match this structure, Stash may return null
    - Use ensure_ascii=True to avoid Unicode encoding issues
    - Compact JSON (no pretty printing) is recommended
    """
    try:
        # Wrap result in Stash's PluginOutput format
        plugin_output = {}

        # If there's a result_error, put it in the 'error' field
        if "result_error" in result:
            plugin_output["error"] = result["result_error"]
            # Still include the rest of the result in 'output' for context
            result_without_error = {k: v for k, v in result.items() if k != "result_error"}
            if result_without_error:
                plugin_output["output"] = result_without_error
        else:
            # No error, wrap entire result in 'output' field
            plugin_output["output"] = result

        # Use ensure_ascii=True to avoid potential Unicode encoding issues
        # Compact JSON (no separators) for maximum compatibility
        output = json.dumps(plugin_output, ensure_ascii=True, separators=(",", ":"))

        # Validate the JSON can be parsed (catches serialization issues)
        try:
            json.loads(output)
        except json.JSONDecodeError as e:
            log.error(f"Generated invalid JSON: {e}")
            log.error(f"Output that failed: {output[:500]}")
            raise

        log.debug(f"Writing PluginOutput to stdout: {output[:200]}...")  # Log first 200 chars
        log.debug(f"Output length: {len(output)} characters")

        # Write directly to stdout and flush to ensure it's sent immediately
        # Don't use print() as it adds a newline which might confuse Stash
        sys.stdout.write(output)
        sys.stdout.flush()

        # Verify output was written (debugging)
        log.debug("Output written and flushed to stdout")
    except Exception as e:
        log.error(f"Failed to serialize output: {e}", exc_info=True)
        # Fallback: write error in PluginOutput format
        try:
            error_output = json.dumps(
                {"error": f"Failed to serialize output: {str(e)}", "output": {"success": False}},
                ensure_ascii=True,
                separators=(",", ":"),
            )
            sys.stdout.write(error_output)
            sys.stdout.flush()
        except Exception as fallback_error:
            # Last resort: write minimal error in PluginOutput format
            log.error(f"Even fallback JSON serialization failed: {fallback_error}")
            sys.stdout.write('{"error":"Serialization failed","output":{"success":false}}')
            sys.stdout.flush()


def sanitize_filename(filename: str) -> str:
    """Return a safe, portable basename while retaining its extension."""
    value = os.path.basename(str(filename or "").replace("\\", "/"))
    sanitized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")
    if not sanitized or sanitized in (".", ".."):
        sanitized = "download"
    stem, extension = os.path.splitext(sanitized)
    if re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])$", stem, re.IGNORECASE):
        stem = "_" + stem
    sanitized = (stem[:170] + extension[:20]).rstrip(" .")
    return sanitized or "download"


def validate_http_url(value: Any, field_name: str = "URL") -> str:
    """Validate URL syntax before passing an input to network clients."""
    if not isinstance(value, str) or len(value) > 8192:
        raise ValueError(f"{field_name} must be an http or https URL")
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        raise ValueError(f"{field_name} must be an http or https URL")
    if parsed.username or parsed.password:
        raise ValueError(f"{field_name} must not include credentials")
    return value.strip()


def redact_proxy(value: Optional[str]) -> str:
    """Remove credentials from a proxy URL before it reaches logs or results."""
    if not value:
        return ""
    try:
        parsed = urlsplit(value)
        if parsed.username is None and parsed.password is None:
            return value
        host = parsed.hostname or ""
        if parsed.port:
            host += f":{parsed.port}"
        return f"{parsed.scheme}://***:***@{host}"
    except Exception:
        return "[configured proxy]"


# Cached yt-dlp command (resolved once, reused for all calls)
_ytdlp_cmd: Optional[list] = None


def get_ytdlp_cmd(custom_path: Optional[str] = None) -> list:
    """
    Resolve the yt-dlp command to use.

    Resolution order:
    1. Custom path from plugin settings (ytdlpPath)
    2. Python module: sys.executable -m yt_dlp (same Python env, no PATH needed)
    3. CLI binary: yt-dlp on PATH (legacy fallback)

    Returns list of command parts, e.g. ["yt-dlp"] or ["/usr/bin/python3", "-m", "yt_dlp"]
    """
    global _ytdlp_cmd

    # If a custom path is provided, always use it (don't cache - may change between calls)
    if custom_path:
        candidate = os.path.expanduser(str(custom_path).strip())
        resolved = shutil.which(candidate)
        if not resolved and os.path.isfile(candidate):
            resolved = os.path.abspath(candidate)
        if resolved and (os.name == "nt" or os.access(resolved, os.X_OK)):
            log.info("Using configured yt-dlp executable: %s", resolved)
            return [resolved]
        log.warning("Configured yt-dlp executable is not available.")
        return []

    # Return cached result if available
    if _ytdlp_cmd is not None:
        return _ytdlp_cmd

    # Strategy 1: Python module (most reliable - uses same Python that runs this script)
    try:
        result = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            log.info(f"Found yt-dlp as Python module (v{version}) via {sys.executable}")
            _ytdlp_cmd = [sys.executable, "-m", "yt_dlp"]
            return _ytdlp_cmd
    except (subprocess.TimeoutExpired, Exception) as e:
        log.debug(f"Python module check failed: {e}")

    # Strategy 2: CLI binary on PATH (fallback)
    try:
        result = subprocess.run(
            ["yt-dlp", "--version"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            log.info(f"Found yt-dlp CLI on PATH (v{version})")
            _ytdlp_cmd = ["yt-dlp"]
            return _ytdlp_cmd
    except FileNotFoundError:
        log.debug("yt-dlp CLI not found on PATH")
    except subprocess.TimeoutExpired:
        log.debug("yt-dlp CLI version check timed out")

    # Not found anywhere
    _ytdlp_cmd = None
    return []


def check_ytdlp(custom_path: Optional[str] = None) -> bool:
    """Check for yt-dlp without mutating the Stash server's Python environment."""
    return bool(get_ytdlp_cmd(custom_path))


def query_stash_configuration(server: dict) -> dict:
    """Read this plugin's trusted settings and Stash library paths."""
    import urllib.request

    if not isinstance(server, dict):
        raise RuntimeError("Stash did not provide a server connection for this task.")
    try:
        port = int(server.get("Port") or 0)
    except (TypeError, ValueError):
        port = 0
    scheme = str(server.get("Scheme") or "http").lower()
    if not port or scheme not in ("http", "https"):
        raise RuntimeError("Stash did not provide a valid local server connection.")
    cookie = (server.get("SessionCookie") or {}).get("Value") if isinstance(server.get("SessionCookie"), dict) else None

    def request_configuration(query: str) -> dict:
        body = json.dumps({"query": query}).encode("utf-8")
        request = urllib.request.Request(
            f"{scheme}://localhost:{port}/graphql",
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        if cookie:
            request.add_header("Cookie", "session=" + str(cookie))
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if payload.get("errors"):
            messages = [str(item.get("message", item)) for item in payload["errors"]]
            raise RuntimeError("Stash settings query failed: " + "; ".join(messages))
        return payload.get("data", {}).get("configuration", {})

    try:
        configuration = request_configuration(
            "query StashDownloaderLibrary { configuration { general { ffmpegPath stashes { path excludeVideo excludeImage } } } }"
        )
    except Exception as error:
        raise RuntimeError("Could not read Stash library paths: " + str(error))

    try:
        configuration["plugins"] = request_configuration(
            "query StashDownloaderPluginSettings { configuration { plugins } }"
        ).get("plugins") or {}
    except Exception as error:
        # The library path is still sufficient for default downloads. Plugin
        # settings are optional on older Stash versions.
        log.warning("Could not read Stash Downloader plugin settings: %s", str(error)[:200])
        configuration["plugins"] = {}
    return configuration


def resolve_download_destination(configuration: dict, media_type: str = "video") -> tuple:
    """Choose a server-controlled folder inside a matching Stash library."""
    image_mode = media_type == "image"
    excluded_flag = "excludeImage" if image_mode else "excludeVideo"
    general = configuration.get("general") or {}
    roots = []
    for stash in general.get("stashes") or []:
        if not isinstance(stash, dict) or stash.get(excluded_flag):
            continue
        root = str(stash.get("path") or "").strip()
        if root and os.path.isabs(root):
            roots.append(os.path.realpath(root))
    if not roots:
        content_name = "image" if image_mode else "video"
        raise RuntimeError(f"Stash has no absolute {content_name}-enabled library path configured.")

    plugin_settings = (configuration.get("plugins") or {}).get("stash-downloader") or {}
    configured = str(plugin_settings.get("serverDownloadPath") or "").strip()
    if configured:
        if not os.path.isabs(configured):
            raise RuntimeError("The configured download path must be an absolute server path.")
        destination = os.path.realpath(os.path.abspath(configured))
    else:
        destination = roots[0]

    matching_root = None
    for root in roots:
        try:
            if os.path.commonpath([root, destination]) == root:
                matching_root = root
                break
        except ValueError:
            continue
    if not matching_root:
        content_name = "image" if image_mode else "video"
        raise RuntimeError(f"The download path must be inside an {content_name}-enabled Stash library so Stash can scan imported files.")

    os.makedirs(destination, exist_ok=True)
    destination = os.path.realpath(destination)
    try:
        still_inside = os.path.commonpath([matching_root, destination]) == matching_root
    except ValueError:
        still_inside = False
    if not still_inside:
        raise RuntimeError("The download path resolves outside its Stash library directory.")
    return destination, matching_root


def server_setting(args: dict, setting_name: str, arg_name: str) -> Optional[str]:
    """Prefer Stash's plugin configuration over browser-supplied arguments."""
    settings = args.get("_server_settings")
    if isinstance(settings, dict):
        value = settings.get(setting_name)
    else:
        # Standalone invocation is useful for local validation. Stash execution
        # always attaches _server_settings before dispatching this task.
        value = args.get(arg_name)
    return str(value).strip() if value else None


def detect_content_type(metadata: dict) -> str:
    """
    Detect content type from yt-dlp metadata.

    Args:
        metadata: yt-dlp metadata dictionary

    Returns:
        Content type: 'video', 'image', or 'gallery'
    """
    # Check _type field (yt-dlp sets this for playlists, etc.)
    if metadata.get("_type") == "playlist":
        return "gallery"

    # Check file extension
    ext = (metadata.get("ext") or "").lower()
    image_extensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp"]
    if ext in image_extensions:
        log.debug(f"Detected image from extension: {ext}")
        return "image"

    # Check video codec - if 'none' or missing, likely not a video
    vcodec = metadata.get("vcodec")
    acodec = metadata.get("acodec")

    if vcodec == "none" or not vcodec:
        # No video codec - check audio codec
        if acodec == "none" or not acodec:
            # No video, no audio = likely an image
            log.debug("Detected image: no video or audio codecs")
            return "image"
        else:
            # Audio-only content (treat as video for now)
            log.debug("Detected audio-only content (treating as video)")
            return "video"

    # Check formats array for video characteristics
    formats = metadata.get("formats", [])
    has_video_format = False
    for fmt in formats:
        if fmt.get("height") and fmt.get("height") > 0:
            has_video_format = True
            break
        if fmt.get("vcodec") and fmt.get("vcodec") != "none":
            has_video_format = True
            break

    if not has_video_format and formats:
        log.debug("Detected image: no video formats found")
        return "image"

    # Has duration? Definitely a video
    if metadata.get("duration") and metadata.get("duration") > 0:
        log.debug(f"Detected video: has duration of {metadata.get('duration')}s")
        return "video"

    # Check if width/height suggest video dimensions
    width = metadata.get("width", 0)
    height = metadata.get("height", 0)
    if height > 0:
        # Video-like dimensions (most images don't report this in yt-dlp)
        log.debug(f"Detected video: has dimensions {width}x{height}")
        return "video"

    # Default to video (most common case for yt-dlp usage)
    log.debug("Defaulting to video (no clear indicators)")
    return "video"


def extract_metadata(url: str, proxy: Optional[str] = None, ytdlp_path: Optional[str] = None) -> dict:
    """
    Extract metadata using yt-dlp without downloading.

    Args:
        url: URL to extract metadata from
        proxy: Optional HTTP/HTTPS/SOCKS proxy (e.g., http://proxy.example.com:8080)
        ytdlp_path: Optional custom path to yt-dlp binary

    Returns:
        dict with metadata on success, or dict with 'extraction_error' key on failure
    """
    cmd = get_ytdlp_cmd(ytdlp_path) + [
        "--dump-json",
        "--no-download",
        "--no-playlist",
    ]

    # Add proxy if provided
    if proxy:
        cmd.extend(["--proxy", proxy])
        log.debug("Proxy configured for metadata extraction: %s", redact_proxy(proxy))
    else:
        log.debug("ℹ No proxy configured for metadata extraction - using direct connection")

    cmd.append(url)

    log.info("Extracting metadata from %s", urlsplit(url).hostname or "remote host")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)

        if result.returncode == 0 and result.stdout:
            log.info("✓ Metadata extracted")
            return json.loads(result.stdout)
        else:
            # Enhanced error logging with proxy context
            error_msg = result.stderr or result.stdout or "Unknown error"
            # Clean up yt-dlp error message for display
            clean_error = error_msg.strip().split('\n')[-1] if error_msg else "Unknown error"
            if proxy:
                clean_error = clean_error.replace(proxy, redact_proxy(proxy))
            clean_error = clean_error.replace(url, urlsplit(url).hostname or "remote host")
            if proxy:
                log.error("yt-dlp extraction failed (proxy %s): %s", redact_proxy(proxy), clean_error[:200])
            else:
                log.error("yt-dlp extraction failed: %s", clean_error[:200])
            return {"extraction_error": clean_error, "used_proxy": bool(proxy)}
    except subprocess.TimeoutExpired:
        timeout_msg = f"Timed out after 60s"
        log.error("yt-dlp metadata extraction timed out (proxy configured: %s)", bool(proxy))
        return {"extraction_error": timeout_msg, "used_proxy": bool(proxy)}
    except json.JSONDecodeError as e:
        log.error(f"Failed to parse yt-dlp output: {e}", exc_info=True)
        return {"extraction_error": f"Failed to parse yt-dlp output: {e}", "used_proxy": bool(proxy)}
    except Exception as e:
        error_msg = f"Extraction error: {e}"
        if proxy:
            error_msg = error_msg.replace(proxy, redact_proxy(proxy))
        error_msg = error_msg.replace(url, urlsplit(url).hostname or "remote host")
        log.error(error_msg)
        return {"extraction_error": error_msg, "used_proxy": bool(proxy)}


def is_direct_file_url(url: str) -> bool:
    """
    Check if URL is a direct file URL (video/image) that doesn't need yt-dlp.

    These are URLs that point directly to media files and should be downloaded
    with a simple HTTP request instead of yt-dlp.
    """
    # Common video/image extensions
    direct_extensions = [
        ".mp4",
        ".webm",
        ".mkv",
        ".avi",
        ".mov",
        ".flv",
        ".wmv",
        ".m4v",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".bmp",
    ]

    try:
        # Parse URL and check path
        from urllib.parse import urlparse, unquote

        parsed = urlparse(url)
        path = unquote(parsed.path).lower()

        # Check if path ends with a known extension
        for ext in direct_extensions:
            if path.endswith(ext) or f"{ext}?" in path or f"{ext}/" in path:
                return True

        # Check query parameters for download hints
        query = parsed.query.lower()
        if "download=" in query or "download_filename=" in query:
            return True

    except Exception:
        pass

    return False


def download_direct_file(
    url: str, output_dir: str, filename: Optional[str] = None, proxy: Optional[str] = None,
    progress_id: Optional[str] = None
) -> Optional[str]:
    """
    Download a direct file URL using requests (no yt-dlp).

    Args:
        url: Direct file URL to download
        output_dir: Directory to save the file
        filename: Optional custom filename (will extract from URL if not provided)
        proxy: Optional HTTP/HTTPS/SOCKS proxy
        progress_id: Optional ID for progress file updates (for frontend polling)

    Returns:
        Path to downloaded file, or None if failed
    """
    import requests
    from urllib.parse import unquote, parse_qs

    temp_path = None
    response = None
    output_path = None
    try:
        url = validate_http_url(url)
        os.makedirs(output_dir, exist_ok=True)
        parsed = urlsplit(url)
        if not filename:
            query_params = parse_qs(parsed.query)
            filename = query_params.get("download_filename", [None])[0]
            filename = filename or unquote(parsed.path.rsplit("/", 1)[-1]) or "downloaded_file"
        filename = sanitize_filename(filename)

        proxies = {"http": proxy, "https": proxy} if proxy else None
        referer = f"{parsed.scheme}://{parsed.netloc}/"
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; StashDownloader/0.6)",
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "Referer": referer,
            "Origin": f"{parsed.scheme}://{parsed.netloc}",
        }
        response = requests.get(
            url, headers=headers, proxies=proxies, stream=True,
            timeout=(15, 60), allow_redirects=True,
        )
        response.raise_for_status()

        content_type = str(response.headers.get("content-type", "")).split(";", 1)[0].lower()
        if content_type.startswith("text/") or content_type in ("application/json", "application/xml", "text/html"):
            raise IOError("The server returned a web page or document, not a media file.")
        if "." not in filename:
            extensions = {
                "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
                "image/gif": ".gif", "video/webm": ".webm", "video/quicktime": ".mov",
                "video/x-matroska": ".mkv", "video/x-msvideo": ".avi", "video/mp4": ".mp4",
            }
            filename += extensions.get(content_type, ".mp4")

        total_size = int(response.headers.get("content-length", 0) or 0)
        if progress_id:
            save_result(f"progress-{progress_id}", {
                "status": "starting", "percentage": 0, "downloaded_bytes": 0,
                "total_bytes": total_size, "last_updated": time.time(),
            })

        handle = tempfile.NamedTemporaryFile(prefix=".stash-downloader-", suffix=".part", dir=output_dir, delete=False)
        temp_path = handle.name
        downloaded = 0
        last_progress_update = 0.0
        try:
            for chunk in response.iter_content(chunk_size=1024 * 128):
                if not chunk:
                    continue
                handle.write(chunk)
                downloaded += len(chunk)
                now = time.time()
                if progress_id and now - last_progress_update >= 0.5:
                    percentage = (downloaded / total_size * 100) if total_size else 0
                    save_result(f"progress-{progress_id}", {
                        "status": "downloading", "percentage": percentage,
                        "downloaded_bytes": downloaded, "total_bytes": total_size,
                        "last_updated": now,
                    })
                    last_progress_update = now
            handle.flush()
            os.fsync(handle.fileno())
        finally:
            handle.close()

        if downloaded <= 0:
            raise IOError("The server returned an empty file.")
        if total_size and downloaded != total_size:
            raise IOError("The download ended before the full file was received.")

        stem, ext = os.path.splitext(filename)
        for index in range(10000):
            suffix = f" ({index})" if index else ""
            candidate = os.path.join(output_dir, f"{stem}{suffix}{ext}")
            try:
                # Hard-linking is atomic and will never overwrite another file.
                os.link(temp_path, candidate)
                output_path = candidate
                break
            except FileExistsError:
                continue
        if not output_path:
            raise IOError("Could not reserve a unique destination filename.")
        os.unlink(temp_path)
        temp_path = None
        if progress_id:
            save_result(f"progress-{progress_id}", {
                "status": "complete", "percentage": 100, "downloaded_bytes": downloaded,
                "total_bytes": total_size or downloaded, "file_path": output_path,
                "last_updated": time.time(),
            })
        return output_path
    except requests.exceptions.RequestException as error:
        log.error("Direct download failed (network error): %s", type(error).__name__)
        return None
    except Exception as error:
        log.error("Direct download failed: %s", str(error))
        return None
    finally:
        if response is not None:
            response.close()
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def parse_ytdlp_progress(line: str) -> Optional[dict]:
    """
    Parse yt-dlp progress output line.

    Example lines:
    [download]  50.0% of 100.00MiB at 5.00MiB/s ETA 00:10
    [download]  50.0% of ~100.00MiB at 5.00MiB/s ETA 00:10 (frag 5/10)
    [download] Destination: /path/to/file.mp4

    Returns dict with progress info or None if not a progress line.
    """
    if not line.startswith("[download]"):
        return None

    # Match percentage progress line
    # Pattern: [download]  XX.X% of [~]XXX.XXMIB at XXX.XXMIB/s ETA XX:XX
    import re

    progress_match = re.search(
        r"\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\d+\.?\d*)(Ki?B|Mi?B|Gi?B)",
        line,
    )
    if progress_match:
        percentage = float(progress_match.group(1))
        size_value = float(progress_match.group(2))
        size_unit = progress_match.group(3)

        # Convert to bytes
        multipliers = {"KiB": 1024, "KB": 1000, "MiB": 1024 * 1024, "MB": 1000 * 1000, "GiB": 1024 * 1024 * 1024, "GB": 1000 * 1000 * 1000}
        total_bytes = int(size_value * multipliers.get(size_unit, 1))
        downloaded_bytes = int(total_bytes * percentage / 100)

        result = {
            "percentage": percentage,
            "downloaded_bytes": downloaded_bytes,
            "total_bytes": total_bytes,
        }

        # Try to parse speed
        speed_match = re.search(r"at\s+(\d+\.?\d*)(Ki?B|Mi?B|Gi?B)/s", line)
        if speed_match:
            speed_value = float(speed_match.group(1))
            speed_unit = speed_match.group(2)
            result["speed"] = int(speed_value * multipliers.get(speed_unit, 1))

        # Try to parse ETA
        eta_match = re.search(r"ETA\s+(\d+):(\d+)", line)
        if eta_match:
            minutes = int(eta_match.group(1))
            seconds = int(eta_match.group(2))
            result["eta"] = minutes * 60 + seconds

        return result

    return None


_ACTIVE_PROCESS = None


def terminate_process_tree(process) -> None:
    """Stop yt-dlp and its helpers when Stash cancels a task."""
    if process is None or process.poll() is not None:
        return
    try:
        if os.name == "nt":
            process.terminate()
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=8)
    except Exception:
        try:
            if os.name == "nt":
                process.kill()
            else:
                os.killpg(process.pid, signal.SIGKILL)
        except Exception:
            pass


def _cancel_download(_signum, _frame):
    terminate_process_tree(_ACTIVE_PROCESS)
    raise SystemExit("Download cancelled by Stash.")


def _linux_parent_death_signal():
    """Ensure yt-dlp exits if Stash forcibly terminates this Python task."""
    import ctypes

    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGTERM) != 0:  # PR_SET_PDEATHSIG
        os._exit(1)
    if os.getppid() == 1:
        os.kill(os.getpid(), signal.SIGTERM)


def download_video(
    url: str,
    output_dir: str,
    filename_template: str = "%(title)s.%(ext)s",
    quality: str = "best",
    progress_callback: Optional[callable] = None,
    proxy: Optional[str] = None,
    progress_id: Optional[str] = None,
    ytdlp_path: Optional[str] = None,
    ffmpeg_path: Optional[str] = None,
) -> Optional[str]:
    """
    Download video using yt-dlp with real-time progress reporting.

    Args:
        url: Video URL to download
        output_dir: Directory to save the video
        filename_template: yt-dlp output template
        quality: Quality preference (best, 1080p, 720p, 480p)
        progress_callback: Optional callback for progress updates
        proxy: Optional HTTP/HTTPS/SOCKS proxy (e.g., http://proxy.example.com:8080)
        progress_id: Optional ID for progress file updates (for frontend polling)
        ytdlp_path: Optional custom path to yt-dlp binary

    Returns:
        Path to downloaded file, or None if failed
    """
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    url = validate_http_url(url)
    download_started = time.time()

    # Build format string based on quality preference
    format_str = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
    if quality == "1080p":
        format_str = "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best"
    elif quality == "720p":
        format_str = "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best"
    elif quality == "480p":
        format_str = "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best"

    output_template = os.path.join(output_dir, filename_template)
    staging_dir = tempfile.mkdtemp(prefix=".stash-downloader-", dir=output_dir)

    cmd = get_ytdlp_cmd(ytdlp_path) + [
        "-f",
        format_str,
        "-o",
        output_template,
        "--no-playlist",
        "--no-overwrites",
        "--paths",
        f"temp:{staging_dir}",
        "--newline",  # Output progress on new lines for parsing
        "--progress",  # Show progress bar
        # Use progress template to ensure consistent output format
        "--progress-template", "download:[download] %(progress._percent_str)s of %(progress._total_bytes_str)s at %(progress._speed_str)s ETA %(progress._eta_str)s",
        "--print",
        "after_move:filepath",  # Print final path
    ]

    # Set TERM environment variable to trick yt-dlp into outputting progress
    # (yt-dlp suppresses progress when not in a TTY; this makes it think it is)
    env = os.environ.copy()
    env["TERM"] = "xterm"

    # Add proxy if provided (yt-dlp supports http://, https://, socks4://, socks5://)
    if proxy:
        cmd.extend(["--proxy", proxy])
        log.debug("Proxy configured: %s", redact_proxy(proxy))
    else:
        log.debug("ℹ No proxy configured - using direct connection")

    if ffmpeg_path:
        cmd.extend(["--ffmpeg-location", ffmpeg_path])

    cmd.append(url)

    log.info("Downloading from %s", urlsplit(url).hostname or "remote host")
    log.debug(f"Output directory: {output_dir}")
    log.debug(f"Quality: {quality}")
    # Avoid logging full URLs or proxy credentials; both can contain secrets.

    # Create initial progress file so frontend knows download has started
    if progress_id:
        progress_file_id = f"progress-{progress_id}"
        log.info(f"Creating progress file: {progress_file_id}")
        initial_progress = {
            "status": "starting",
            "percentage": 0,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "last_updated": time.time(),
        }
        save_success = save_result(progress_file_id, initial_progress)
        log.info(f"Progress file created: {save_success}")
        # Verify file was created
        result_path = get_result_path(progress_file_id)
        log.info(f"Progress file path: {result_path}, exists: {os.path.exists(result_path)}")
    else:
        log.warning("No progress_id provided - progress tracking disabled")

    global _ACTIVE_PROCESS
    previous_handlers = {}
    for caught_signal in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
        if caught_signal is not None:
            try:
                previous_handlers[caught_signal] = signal.signal(caught_signal, _cancel_download)
            except (ValueError, OSError):
                pass

    timeout_timer = None
    try:
        # Use Popen for streaming output to get real-time progress
        # Merge stderr into stdout so we get all output in one stream
        popen_options = {
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "env": env,
        }
        if os.name == "nt":
            popen_options["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            popen_options["start_new_session"] = True
        if sys.platform.startswith("linux"):
            popen_options["preexec_fn"] = _linux_parent_death_signal

        process = subprocess.Popen(cmd, **popen_options)
        _ACTIVE_PROCESS = process
        timeout_timer = threading.Timer(6 * 60 * 60, terminate_process_tree, args=(process,))
        timeout_timer.daemon = True
        timeout_timer.start()

        stdout_lines = []  # To capture the final file path
        last_progress_update = 0
        progress_update_interval = 0.5  # Update progress file every 0.5 seconds

        # Read combined stdout/stderr for progress updates
        # yt-dlp uses \r (carriage return) to update progress in place
        # We need to read in chunks and split on both \r and \n
        lines_read = 0
        progress_updates = 0
        log.info("Reading yt-dlp output for progress updates...")

        output_buffer = ""
        if process.stdout:
            while True:
                # Read in small chunks to handle progress updates in real-time
                chunk = process.stdout.read(256)
                if not chunk:
                    break

                # Decode and add to buffer
                output_buffer += chunk.decode('utf-8', errors='replace')

                # Split on both \r and \n to get progress lines
                # yt-dlp uses \r to overwrite progress lines
                while '\r' in output_buffer or '\n' in output_buffer:
                    # Find the first line terminator
                    r_pos = output_buffer.find('\r')
                    n_pos = output_buffer.find('\n')

                    if r_pos == -1:
                        split_pos = n_pos
                    elif n_pos == -1:
                        split_pos = r_pos
                    else:
                        split_pos = min(r_pos, n_pos)

                    line = output_buffer[:split_pos].strip()
                    output_buffer = output_buffer[split_pos + 1:]

                    if not line:
                        continue
                    lines_read += 1

                    # Check if this is the final file path (from --print after_move:filepath)
                    if line.startswith('/') or (len(line) > 2 and line[1] == ':'):  # Unix or Windows path
                        stdout_lines.append(line)
                        log.debug(f"Captured output path: {line}")
                        continue

                    # Parse progress from yt-dlp output
                    progress = parse_ytdlp_progress(line)
                    if progress:
                        progress_updates += 1
                        current_time = time.time()
                        # Update progress file periodically (not on every line)
                        if progress_id and (current_time - last_progress_update) >= progress_update_interval:
                            progress["status"] = "downloading"
                            progress["last_updated"] = current_time
                            save_result(f"progress-{progress_id}", progress)
                            last_progress_update = current_time
                            log.info(f"Progress: {progress['percentage']:.1f}% ({progress.get('downloaded_bytes', 0)}/{progress.get('total_bytes', 0)} bytes)")

                        if progress_callback:
                            progress_callback(progress)
                    else:
                        # Log non-progress lines at debug level
                        if "[download]" in line or "[info]" in line:
                            log.debug(f"yt-dlp: {line}")
                            # Update heartbeat even without progress data (for HLS/DASH streams)
                            current_time = time.time()
                            if progress_id and (current_time - last_progress_update) >= progress_update_interval:
                                save_result(f"progress-{progress_id}", {
                                    "status": "downloading",
                                    "last_updated": current_time,
                                    "message": line[:100],  # Include last status message
                                })
                                last_progress_update = current_time
                        elif "ERROR" in line or "error" in line.lower():
                            log.error(f"yt-dlp: {line}")

        log.info(f"Finished reading output: {lines_read} lines, {progress_updates} progress updates")

        # Wait for process to complete
        process.wait()

        if output_buffer.strip():
            stdout_lines.append(output_buffer.strip())

        if process.returncode == 0:
            # Last line of stdout should be the file path
            file_path = stdout_lines[-1] if stdout_lines else None

            if file_path and os.path.exists(file_path):
                log.info(f"✓ Download complete: {os.path.basename(file_path)}")
                # Update progress to 100%
                if progress_id:
                    save_result(f"progress-{progress_id}", {
                        "status": "complete",
                        "percentage": 100,
                        "file_path": file_path,
                        "last_updated": time.time(),
                    })
                return file_path
            else:
                # Try to find the file in output directory
                log.warning("Could not determine output path, searching directory...")
                files = [
                    path for path in Path(output_dir).glob("*")
                    if path.is_file() and path.stat().st_mtime >= download_started
                ]
                if files:
                    newest = max(files, key=os.path.getmtime)
                    log.debug(f"Found downloaded file: {newest}")
                    if progress_id:
                        save_result(f"progress-{progress_id}", {
                            "status": "complete",
                            "percentage": 100,
                            "file_path": str(newest),
                            "last_updated": time.time(),
                        })
                    return str(newest)

        # Failed - update progress with error
        error_msg = "Download failed"
        if progress_id:
            save_result(f"progress-{progress_id}", {
                "status": "error",
                "error": error_msg,
                "last_updated": time.time(),
            })

        log.error("yt-dlp download failed (proxy configured: %s)", bool(proxy))
        return None

    except Exception as e:
        error_msg = f"Download error: {type(e).__name__}: {e}"
        log.error("%s", error_msg, exc_info=True)
        if progress_id:
            save_result(f"progress-{progress_id}", {"status": "error", "error": str(e), "last_updated": time.time()})
        return None
    finally:
        if timeout_timer:
            timeout_timer.cancel()
        _ACTIVE_PROCESS = None
        for caught_signal, old_handler in previous_handlers.items():
            try:
                signal.signal(caught_signal, old_handler)
            except (ValueError, OSError):
                pass
        try:
            import shutil
            shutil.rmtree(staging_dir, ignore_errors=True)
        except OSError:
            pass


def task_download(args: dict) -> dict:
    """
    Handle download task.

    Args:
        url: URL to download (may be direct file URL or page URL)
        fallback_url: Original page URL for yt-dlp fallback (if url is direct file)
        output_dir: Ignored. The server resolves this from Stash settings and library paths.
        filename: Optional custom filename
        quality: Quality preference (best, 1080p, 720p, 480p)
        proxy: Optional HTTP/HTTPS/SOCKS proxy (e.g., http://proxy.example.com:8080)
        result_id: Optional ID for storing result (for async retrieval)
        progress_id: Optional ID for progress updates (frontend can poll this)

    Returns:
        Dict with file_path on success, error on failure.
        If result_id is provided, also saves to file for later retrieval.
    """
    url = args.get("url")
    fallback_url = args.get("fallback_url")
    filename = args.get("filename")
    quality = args.get("quality", "best")
    media_type = "image" if args.get("media_type") == "image" else "video"
    proxy = server_setting(args, "httpProxy", "proxy")
    ytdlp_path = server_setting(args, "ytdlpPath", "ytdlp_path")
    result_id = args.get("result_id")
    progress_id = args.get("progress_id")  # For real-time progress updates

    # Log all received args for debugging
    log.info(f"Download task received args: {list(args.keys())}")
    log.info(f"Download task started: progress_id={progress_id}, result_id={result_id}")
    if proxy:
        log.debug("Proxy configured: %s", redact_proxy(proxy))

    if not url:
        result = {"result_error": "No URL provided", "success": False}
        if result_id:
            save_result(result_id, result)
        return result

    try:
        url = validate_http_url(url)
        if fallback_url:
            fallback_url = validate_http_url(fallback_url, "Fallback URL")
        configuration = args.get("_server_configuration")
        if not isinstance(configuration, dict):
            raise RuntimeError(args.get("_configuration_error") or "Could not read Stash library configuration.")
        output_dir, library_root = resolve_download_destination(configuration, media_type)
    except (ValueError, RuntimeError, OSError) as error:
        result = {"result_error": str(error), "success": False}
        if result_id:
            save_result(result_id, result)
        return result

    if quality not in ("best", "1080p", "720p", "480p"):
        quality = "best"

    # Track which URL to use for yt-dlp fallback
    ytdlp_url = url

    # Check if this is a direct file URL (try direct download first, fallback to yt-dlp)
    if media_type == "image" or is_direct_file_url(url):
        log.info(f"Detected direct file URL, trying direct download first")
        file_path = download_direct_file(url, output_dir, filename, proxy=proxy, progress_id=progress_id)

        if file_path:
            file_size = os.path.getsize(file_path)
            result = {"file_path": file_path, "file_size": file_size, "library_path": library_root, "success": True}
            if result_id:
                save_result(result_id, result)
                log.debug(f"Direct download result saved with result_id: {result_id}")
            return result
        else:
            # Direct download failed (likely 403/hotlink protection)
            # Fall back to yt-dlp with the original page URL (if provided)
            if media_type == "image":
                result = {"result_error": "The image URL did not return a downloadable image file.", "success": False}
                if result_id:
                    save_result(result_id, result)
                return result
            if fallback_url:
                log.info(f"Direct download failed, using yt-dlp fallback")
                ytdlp_url = fallback_url
            else:
                log.warning("[task_download] Direct download failed, no fallback URL - trying yt-dlp with direct URL")

    # Check yt-dlp availability
    if not check_ytdlp(ytdlp_path):
        result = {"result_error": "yt-dlp is unavailable. Install it in the Python environment used by Stash, or configure its executable path in Stash plugin settings.", "success": False}
        if result_id:
            save_result(result_id, result)
        return result

    # Build filename template for yt-dlp
    if filename:
        # Sanitize custom filename
        safe_name = os.path.splitext(sanitize_filename(filename))[0]
        template = f"{safe_name}.%(ext)s"
    else:
        template = "%(title)s.%(ext)s"

    # Download using yt-dlp (with proxy if provided)
    # Use ytdlp_url which may be the original page URL if direct download failed
    ffmpeg_path = (args.get("_server_configuration", {}).get("general") or {}).get("ffmpegPath")
    file_path = download_video(
        ytdlp_url,
        output_dir,
        template,
        quality,
        proxy=proxy,
        progress_id=progress_id,
        ytdlp_path=ytdlp_path,
        ffmpeg_path=str(ffmpeg_path).strip() if ffmpeg_path else None,
    )

    if file_path:
        file_size = os.path.getsize(file_path)
        result = {"file_path": file_path, "file_size": file_size, "library_path": library_root, "success": True}
        # Save result if result_id provided (for async retrieval)
        if result_id:
            save_result(result_id, result)
            log.debug(f"Download result saved with result_id: {result_id}")
        return result
    else:
        result = {"result_error": "Download failed", "success": False}
        if result_id:
            save_result(result_id, result)
        return result


def task_extract_metadata(args: dict) -> dict:
    """
    Extract metadata without downloading.

    Args:
        url: URL to extract metadata from
        proxy: Optional HTTP/HTTPS/SOCKS proxy (e.g., http://proxy.example.com:8080)
        result_id: Optional ID for storing result (for async retrieval)

    Returns:
        Dict with metadata on success, error on failure.
        If result_id is provided, also saves to file for later retrieval.
    """
    url = args.get("url")
    proxy = server_setting(args, "httpProxy", "proxy")
    ytdlp_path = server_setting(args, "ytdlpPath", "ytdlp_path")
    result_id = args.get("result_id")

    # Log proxy configuration for troubleshooting
    if proxy:
        log.debug("Proxy configured: %s", redact_proxy(proxy))
    else:
        log.debug("[task_extract_metadata] No proxy configured - using direct connection")

    if not url:
        result = {"result_error": "No URL provided", "success": False}
        if result_id:
            save_result(result_id, result)
        return result

    try:
        url = validate_http_url(url)
    except ValueError as error:
        result = {"result_error": str(error), "success": False}
        if result_id:
            save_result(result_id, result)
        return result

    if not check_ytdlp(ytdlp_path):
        result = {"result_error": "yt-dlp is unavailable. Install it in the Python environment used by Stash, or configure its executable path in Stash plugin settings.", "success": False}
        if result_id:
            save_result(result_id, result)
        return result

    metadata = extract_metadata(url, proxy=proxy, ytdlp_path=ytdlp_path)

    # Check if extraction returned an error
    if "extraction_error" in metadata:
        error_msg = metadata["extraction_error"]
        # Add hint about proxy if not used
        if not metadata.get("used_proxy") and not proxy:
            error_msg += " (tip: try configuring a proxy in settings)"
        result = {"result_error": error_msg, "success": False}
        if result_id:
            save_result(result_id, result)
        return result

    if metadata:
        # Extract all formats with their URLs (important for HLS streams)
        # For HLS, yt-dlp may include URLs in formats or only at top level
        formats_list = []
        for f in metadata.get("formats", []):
            # Include format if it has video characteristics or is explicitly a video format
            # Don't filter too aggressively - include all formats that might be video
            is_video_format = (
                f.get("height")  # Has height = likely video
                or (f.get("vcodec") and f.get("vcodec") != "none")  # Has video codec
                or (
                    f.get("format_id")
                    and any(
                        keyword in f.get("format_id", "").lower() for keyword in ["hls", "mp4", "video", "dash", "http"]
                    )
                )  # Format ID suggests video
            )

            if is_video_format:
                format_data = {
                    "format_id": f.get("format_id"),
                    "ext": f.get("ext"),
                    "height": f.get("height"),
                    "width": f.get("width"),
                    "filesize": f.get("filesize"),
                    "vcodec": f.get("vcodec"),
                    "acodec": f.get("acodec"),
                }
                # Include URL if available (for HLS, this might be manifest_url or url)
                # yt-dlp may provide URLs in various fields for HLS streams
                if f.get("url"):
                    format_data["url"] = f.get("url")
                if f.get("manifest_url"):
                    format_data["manifest_url"] = f.get("manifest_url")
                if f.get("fragment_base_url"):
                    format_data["fragment_base_url"] = f.get("fragment_base_url")
                formats_list.append(format_data)

        result = {
            "success": True,
            "title": metadata.get("title"),
            "description": metadata.get("description"),
            "duration": metadata.get("duration"),
            "uploader": metadata.get("uploader"),
            "channel": metadata.get("channel"),  # Channel name (fallback for studio)
            "upload_date": metadata.get("upload_date"),
            "thumbnail": metadata.get("thumbnail"),
            # Tags and categories (site-specific, may be empty)
            "tags": metadata.get("tags", []),  # List of tags
            "categories": metadata.get("categories", []),  # List of categories
            # Performers (site-specific, may be empty)
            "cast": metadata.get("cast", []),  # List of cast members (Pornhub, etc.)
            "creators": metadata.get("creators", []),  # List of creators
            "artist": metadata.get("artist"),  # Artist name (music videos)
            # Include direct video URL (important for download service)
            # For HLS streams, this is typically the best quality manifest URL
            # yt-dlp's top-level 'url' is usually the best quality available
            "url": metadata.get("url"),  # Direct video URL from yt-dlp (best quality for HLS)
            "webpage_url": metadata.get("webpage_url"),  # Original page URL
            "original_url": metadata.get("original_url"),  # Fallback URL
            "height": metadata.get("height"),  # Best quality height (if available)
            "width": metadata.get("width"),  # Best quality width (if available)
            "formats": formats_list,  # All video formats with URLs
        }

        log.debug(f"Extracted {len(formats_list)} video formats from yt-dlp output")
        if result.get("url"):
            log.debug("Top-level media URL available")
        else:
            log.warning("No top-level URL found in yt-dlp output")

    # Save result for async retrieval if result_id provided
    if result_id:
        save_result(result_id, result)
        log.debug(f"Metadata saved with result_id: {result_id}")

    return result


def task_read_result(args: dict) -> dict:
    """
    Read a previously saved result.

    Args:
        result_id: ID of the result to read

    Returns:
        The saved result data, or error if not found

    Note: When using runPluginOperation, Stash treats any top-level 'error' field
    as a GraphQL error. So we wrap errors in 'result_error' instead and always
    return success: true for the read operation itself.
    """
    result_id = args.get("result_id")

    # Only log progress file reads at debug level (they're frequent during download)
    is_progress_read = result_id and result_id.startswith("progress-")
    if is_progress_read:
        log.debug(f"Reading progress file: {result_id}")
    else:
        log.debug(f"Reading result for result_id: {result_id}")

    if not result_id:
        log.error("No result_id provided to read_result")
        # Don't use 'error' field - Stash treats it as GraphQL error
        return {"success": False, "result_error": "No result_id provided", "retrieved": False}

    # For progress files, missing file is expected (download may not have started yet)
    # Don't log errors for these - just return not found quietly
    is_progress_file = result_id.startswith("progress-")

    # Check if result directory exists
    if not os.path.exists(RESULT_DIR):
        if not is_progress_file:
            log.error(f"Result directory does not exist: {RESULT_DIR}")
        return {"success": True, "retrieved": False, "not_found": True}

    data = load_result(result_id, silent=is_progress_file)
    if data:
        log.debug(f"Successfully loaded result for {result_id}")

        # Return the data as-is, but ensure we don't have any field that would
        # cause write_output to set the 'error' field in PluginOutput
        # (which Stash interprets as a GraphQL error, returning null)
        result = {**data, "retrieved": True}

        # IMPORTANT: Rename 'result_error' to 'task_error' to prevent write_output
        # from promoting it to PluginOutput.error (which causes GraphQL errors)
        # The caller should check 'task_error' field instead
        if "result_error" in result:
            result["task_error"] = result.pop("result_error")

        # Also rename 'error' field if present
        if "error" in result:
            result["task_error"] = result.pop("error")

        # Ensure we always have a 'success' field for consistency
        if "success" not in result:
            # If there's a task_error, success should be False, otherwise True
            result["success"] = "task_error" not in result

        return result
    else:
        # File not found - for progress files this is expected, don't log error
        if not is_progress_file:
            log.debug(f"Result not found for result_id: {result_id}")
        # Return success:true but retrieved:false - this is not an error condition
        return {"success": True, "retrieved": False, "not_found": True}


def task_cleanup_result(args: dict) -> dict:
    """
    Delete a saved result file.

    Args:
        result_id: ID of the result to delete

    Returns:
        Success status
    """
    result_id = args.get("result_id")

    if not result_id:
        return {"result_error": "No result_id provided", "success": False}

    if delete_result(result_id):
        return {"success": True, "deleted": True}
    else:
        return {"result_error": "Failed to delete result", "success": False}


def task_check_ytdlp(args: dict) -> dict:
    """Check if yt-dlp is available and return version info.

    Note: We use 'status_message' instead of 'result_error' here because
    this is a status check, not an error condition. Using 'result_error'
    would cause write_output to set PluginOutput.error, which Stash
    interprets as a GraphQL error and returns null data.
    """
    custom_path = server_setting(args, "ytdlpPath", "ytdlp_path")
    cmd = get_ytdlp_cmd(custom_path)

    if not cmd:
        log.warning("yt-dlp not found via Python module or PATH")
        return {
            "available": False,
            "success": True,
            "version": None,
            "status_message": "yt-dlp is unavailable. Install it in Stash's Python environment or configure its executable path in plugin settings.",
            "resolution_method": None,
        }

    try:
        result = subprocess.run(cmd + ["--version"], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            version = result.stdout.strip()
            # Determine how yt-dlp was found for status reporting
            if custom_path:
                method = f"custom path ({custom_path})"
            elif cmd[0] == sys.executable:
                method = f"Python module ({sys.executable})"
            else:
                method = "CLI on PATH"
            log.debug(f"yt-dlp version: {version} (via {method})")
            return {
                "available": True,
                "success": True,
                "version": version,
                "resolution_method": method,
            }
        else:
            return {"available": False, "success": True, "version": None, "status_message": "yt-dlp check failed"}
    except subprocess.TimeoutExpired:
        log.error("yt-dlp version check timed out")
        return {"available": False, "success": True, "version": None, "status_message": "yt-dlp check timed out"}
    except (OSError, subprocess.SubprocessError) as error:
        log.warning("yt-dlp version check failed: %s", type(error).__name__)
        return {"available": False, "success": True, "version": None, "status_message": "The configured yt-dlp executable could not be started."}


def task_test_proxy(args: dict) -> dict:
    """
    Test proxy connectivity by fetching a URL through the proxy.

    Args:
        url: URL to fetch (default: https://www.google.com)
        proxy: HTTP/HTTPS/SOCKS proxy URL

    Returns:
        Dict with success status and response info
    """
    try:
        url = validate_http_url(args.get("url") or "https://example.com/")
    except ValueError as error:
        return {"status_message": str(error), "success": False}
    proxy = server_setting(args, "httpProxy", "proxy")

    if not proxy:
        return {"status_message": "No HTTP/SOCKS proxy is configured in Stash plugin settings.", "success": False}

    safe_proxy = redact_proxy(proxy)
    try:
        import requests

        parsed_proxy = urlsplit(proxy)
        if parsed_proxy.scheme.lower() not in ("http", "https", "socks4", "socks4a", "socks5", "socks5h") or not parsed_proxy.hostname:
            return {"status_message": "Enter a valid HTTP, HTTPS, or SOCKS proxy URL in Stash plugin settings.", "success": False}
        proxies = {"http": proxy, "https": proxy}
        with requests.get(url, proxies=proxies, timeout=(10, 20), allow_redirects=True, stream=True) as response:
            response.raise_for_status()
        return {"success": True, "proxy": safe_proxy, "message": "Proxy connection succeeded with TLS verification enabled."}
    except Exception as error:
        message = str(error).replace(proxy, safe_proxy) if proxy else str(error)
        log.error("Proxy test failed: %s", message[:300])
        if "timed out" in message.lower():
            return {
                "status_message": "Proxy connection timed out after 20 seconds.",
                "success": False,
                "proxy": safe_proxy,
            }
        return {
            "status_message": f"Proxy connection failed: {message[:180]}",
            "success": False,
            "proxy": safe_proxy,
        }


def task_fetch_image(args: dict) -> dict:
    """
    Fetch an image URL and return as base64.
    Used for setting cover images from thumbnails (bypasses browser CSP).

    Args:
        url: Image URL to fetch
        proxy: Optional HTTP/HTTPS/SOCKS proxy URL

    Returns:
        {success: True, image_base64: "data:image/...;base64,..."}
        or {success: False, result_error: "..."}
    """
    import base64
    import requests
    url = args.get("url")
    proxy = server_setting(args, "httpProxy", "proxy")

    if not url:
        return {"result_error": "No URL provided", "success": False}

    try:
        url = validate_http_url(url, "Image URL")
    except ValueError as error:
        return {"result_error": str(error), "success": False}

    parsed = urlsplit(url)
    referer = f"{parsed.scheme}://{parsed.netloc}/"

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; StashDownloader/0.6)",
        "Accept": "image/*,*/*",
        "Accept-Encoding": "identity",
        "Referer": referer,
    }

    try:
        proxies = {"http": proxy, "https": proxy} if proxy else None
        with requests.get(
            url, headers=headers, proxies=proxies, stream=True,
            timeout=(10, 30), allow_redirects=True,
        ) as response:
            response.raise_for_status()
            content_type = str(response.headers.get("Content-Type", "image/jpeg")).split(";", 1)[0].strip().lower()
            if content_type not in ("image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"):
                return {"result_error": "The image server returned an unsupported content type.", "success": False}
            content_length = int(response.headers.get("content-length", 0) or 0)
            if content_length > 8 * 1024 * 1024:
                return {"result_error": "The image exceeds the 8 MiB preview limit.", "success": False}
            data = bytearray()
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if chunk:
                    data.extend(chunk)
                    if len(data) > 8 * 1024 * 1024:
                        return {"result_error": "The image exceeds the 8 MiB preview limit.", "success": False}
        image_data = base64.b64encode(data).decode("ascii")
        return {"success": True, "image_base64": f"data:{content_type};base64,{image_data}"}
    except Exception as error:
        message = str(error).replace(proxy, redact_proxy(proxy)) if proxy else str(error)
        log.error("Image fetch failed: %s", message[:300])
        return {"result_error": f"Failed to fetch image: {message[:200]}", "success": False}


def main():
    """Main entry point."""
    try:
        input_data = read_input()

        # Get task name and arguments
        # Stash sends JSON to stdin: {"args": {"mode": "...", ...}, "server_connection": {...}}
        # Using "mode" key matches community plugin patterns (FileMonitor, etc.)

        # Check for nested args first (standard Stash format)
        if "args" in input_data and isinstance(input_data.get("args"), dict):
            args = dict(input_data["args"])
            # Try 'mode' first (community pattern), then 'task' for backwards compat
            task_name = args.get("mode") or args.get("task", "download")
        else:
            # Direct format (runPluginOperation or direct call)
            args = dict(input_data)
            task_name = input_data.get("mode") or input_data.get("task", "download")

        log.debug("Detected task %s with argument keys %s", task_name, sorted(args.keys()))

        if task_name in {"download", "extract_metadata", "check_ytdlp", "test_proxy", "fetch_image"}:
            try:
                configuration = query_stash_configuration(input_data.get("server_connection") or {})
                args["_server_configuration"] = configuration
                args["_server_settings"] = (configuration.get("plugins") or {}).get("stash-downloader") or {}
            except Exception as error:
                args["_configuration_error"] = str(error)
                args["_server_settings"] = {}

        # Route to appropriate task handler
        tasks = {
            "download": task_download,
            "extract_metadata": task_extract_metadata,
            "read_result": task_read_result,
            "cleanup_result": task_cleanup_result,
            "check_ytdlp": task_check_ytdlp,
            "test_proxy": task_test_proxy,
            "fetch_image": task_fetch_image,
        }

        handler = tasks.get(task_name)
        if handler:
            result = handler(args)
        else:
            # Use 'result_error' instead of 'error' to prevent Stash from treating it as GraphQL error
            result = {"result_error": f"Unknown task: {task_name}", "success": False}

        write_output(result)
    except Exception as e:
        log.error(f"Unhandled exception in main: {e}", exc_info=True)
        # Use 'result_error' instead of 'error' to prevent Stash from treating it as GraphQL error
        error_result = {"result_error": f"Internal error: {str(e)}", "success": False}
        write_output(error_result)
        sys.exit(1)


if __name__ == "__main__":
    main()
