"""Server-side FFmpeg and Stash GraphQL worker for Scene Gallery Generator."""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

PLUGIN_ID = "scene-gallery-generator"
TASK_NAME = "Generate scene galleries"
DEFAULT_IMAGE_COUNT = 8
MIN_IMAGE_COUNT = 1
MAX_IMAGE_COUNT = 30
DEFAULT_SAMPLING_MODE = "smart"
PAGE_SIZE = 100
ACTIVE_PROCESS = None

try:
    import log
except ImportError:  # Supports local syntax/unit checks outside Stash.
    class _Log:
        @staticmethod
        def LogInfo(message):
            sys.stderr.write(str(message) + "\n")

        @staticmethod
        def LogProgress(value):
            pass

    log = _Log()


def log_info(message):
    try:
        log.LogInfo("[Scene Gallery Generator] " + str(message))
    except Exception:
        pass


def report_progress(value):
    try:
        log.LogProgress(float(max(0.0, min(1.0, value))))
    except Exception:
        pass


def cancel_handler(_signum, _frame):
    global ACTIVE_PROCESS
    if ACTIVE_PROCESS is not None and ACTIVE_PROCESS.poll() is None:
        try:
            ACTIVE_PROCESS.terminate()
            ACTIVE_PROCESS.wait(timeout=8)
        except Exception:
            try:
                ACTIVE_PROCESS.kill()
            except Exception:
                pass
    raise SystemExit("Gallery generation cancelled. Existing source videos were left unchanged.")


for _signal in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
    if _signal is not None:
        try:
            signal.signal(_signal, cancel_handler)
        except (ValueError, OSError):
            pass


def graphql(server, query, variables=None, timeout=60):
    connection = server or {}
    port = int(connection.get("Port") or 0)
    scheme = str(connection.get("Scheme") or "http")
    if not port or scheme not in ("http", "https"):
        raise RuntimeError("Stash did not provide a valid local server connection.")
    body = {"query": query}
    if variables is not None:
        body["variables"] = variables
    request = urllib.request.Request(
        scheme + "://localhost:" + str(port) + "/graphql",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    cookie = (connection.get("SessionCookie") or {}).get("Value")
    if cookie:
        request.add_header("Cookie", "session=" + str(cookie))
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            detail = error.read().decode("utf-8", "replace")[-1200:]
        except Exception:
            detail = str(error)
        raise RuntimeError("Stash GraphQL returned HTTP " + str(error.code) + ": " + detail)
    except Exception as error:
        raise RuntimeError("Could not contact Stash's local GraphQL API: " + str(error))
    if payload.get("errors"):
        messages = [str(item.get("message", item)) for item in payload["errors"]]
        raise RuntimeError("Stash GraphQL error: " + "; ".join(messages))
    if not payload.get("data"):
        raise RuntimeError("Stash returned no data for a required GraphQL request.")
    return payload["data"]


def read_plugin_settings(server):
    query = "query SceneGalleryGeneratorSettings { configuration { plugins(include:[\"scene-gallery-generator\"]) } }"
    try:
        data = graphql(server, query)
        settings = (data.get("configuration") or {}).get("plugins") or {}
        value = settings.get(PLUGIN_ID, {}) if isinstance(settings, dict) else {}
        return value if isinstance(value, dict) else {}
    except Exception as error:
        log_info("Plugin settings could not be read; defaults will be used: " + str(error))
        return {}


def read_general_configuration(server):
    query = (
        "query SceneGalleryGeneratorGeneral { configuration { general { "
        "ffmpegPath ffprobePath configFilePath stashes { path excludeVideo excludeImage } "
        "} } }"
    )
    data = graphql(server, query)
    return (data.get("configuration") or {}).get("general") or {}


def introspect_fields(server, type_name, property_name):
    if property_name not in ("fields", "inputFields"):
        raise ValueError("Invalid GraphQL introspection property")
    query = "query SceneGalleryGeneratorType($name:String!) { __type(name:$name) { " + property_name + " { name } } }"
    data = graphql(server, query, {"name": type_name})
    gql_type = data.get("__type") or {}
    return set(item.get("name") for item in (gql_type.get(property_name) or []) if item.get("name"))


def normalize_path(path):
    return os.path.normcase(os.path.realpath(os.path.abspath(str(path or ""))))


def path_is_within(parent, child):
    parent_path = normalize_path(parent)
    child_path = normalize_path(child)
    try:
        return os.path.commonpath([parent_path, child_path]) == parent_path
    except (ValueError, OSError):
        return False


def valid_scene_id(value):
    scene_id = str(value or "")
    if not re.fullmatch(r"[0-9]{1,20}", scene_id):
        raise RuntimeError("Stash returned an invalid scene ID; no files were written.")
    return scene_id


def validate_image_count(value):
    if isinstance(value, bool):
        raise RuntimeError("Images per scene must be a whole number from 1 to 30.")
    try:
        count = int(value)
    except (TypeError, ValueError):
        if value in (None, ""):
            count = DEFAULT_IMAGE_COUNT
        else:
            raise RuntimeError("Images per scene must be a whole number from 1 to 30.")
    if isinstance(value, float) and value != count:
        raise RuntimeError("Images per scene must be a whole number from 1 to 30.")
    if isinstance(value, str) and not re.fullmatch(r"[0-9]+", value.strip()):
        raise RuntimeError("Images per scene must be a whole number from 1 to 30.")
    if count < MIN_IMAGE_COUNT or count > MAX_IMAGE_COUNT:
        raise RuntimeError("Images per scene must be between 1 and 30.")
    return count


def validate_sampling_mode(value):
    mode = str(value or DEFAULT_SAMPLING_MODE).strip().lower()
    if mode not in ("smart", "uniform"):
        raise RuntimeError("Frame selection must be Smart or Evenly spaced.")
    return mode


def configured_roots(general, image=True):
    key = "excludeImage" if image else "excludeVideo"
    roots = []
    for stash in general.get("stashes") or []:
        path = str((stash or {}).get("path") or "").strip()
        if path and not (stash or {}).get(key, False):
            roots.append(normalize_path(path))
    return roots


def choose_image_library(general, requested_path="", plugin_settings=None):
    roots = configured_roots(general, image=True)
    if not roots:
        raise RuntimeError("No image-enabled Stash library was found. Add or enable an image library in Stash Settings → Libraries.")
    selected = str(requested_path or "").strip()
    if not selected:
        selected = str((plugin_settings or {}).get("imageLibraryPath") or "").strip()
    if not selected:
        selected = roots[0]
    if not os.path.isabs(selected):
        raise RuntimeError("The selected image library path must be absolute.")
    canonical = normalize_path(selected)
    if canonical not in roots:
        raise RuntimeError("The selected output path is not an image-enabled Stash library. Choose one from the plugin page or plugin settings.")
    if not os.path.isdir(canonical):
        raise RuntimeError("The selected image library path is not available to the Stash server process: " + canonical)
    return canonical


def ensure_source_in_video_library(source, general):
    if not source or not os.path.isfile(source) or os.path.islink(source):
        raise RuntimeError("The scene's video file is missing or is a symbolic link. No gallery was generated.")
    if os.path.getsize(source) <= 0:
        raise RuntimeError("The scene's video file is empty. No gallery was generated.")
    roots = configured_roots(general, image=False)
    if roots and not any(path_is_within(root, source) for root in roots):
        raise RuntimeError("The scene video is outside Stash's configured video libraries. No file was read.")


def resolve_binary(configured, config_directory, binary_name):
    candidate = str(configured or "").strip()
    if candidate:
        if os.path.isdir(candidate):
            candidate = os.path.join(candidate, binary_name)
        if os.path.isfile(candidate):
            return candidate
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    resolved = shutil.which(binary_name)
    if resolved:
        return resolved
    if config_directory:
        fallback = os.path.join(config_directory, binary_name)
        if os.path.isfile(fallback):
            return fallback
    raise RuntimeError("Stash could not find " + binary_name + ". Check the configured FFmpeg path and the server PATH.")


def probe_duration(ffprobe, source):
    completed = subprocess.run(
        [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", source],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
        timeout=120,
        check=False,
    )
    if completed.returncode:
        raise RuntimeError("FFprobe could not read the scene duration: " + str(completed.stderr or "").strip()[-800:])
    try:
        duration = float(str(completed.stdout or "").strip())
    except ValueError:
        duration = 0
    if duration <= 0:
        raise RuntimeError("FFprobe could not confirm a usable scene duration.")
    return duration


def scene_query_fields():
    return (
        "id title details url date rating100 organized "
        "studio { id name } performers { id name } tags { id name } "
        "files { id path duration }"
    )


def get_scene(server, scene_id):
    query = "query SceneGalleryGeneratorScene($id:ID!) { findScene(id:$id) { " + scene_query_fields() + " } }"
    result = graphql(server, query, {"id": str(scene_id)}).get("findScene")
    if not result:
        raise RuntimeError("Scene " + str(scene_id) + " no longer exists in Stash.")
    return result


def get_scenes(server):
    query = (
        "query SceneGalleryGeneratorScenes($page:Int!,$perPage:Int!) { "
        "findScenes(filter:{page:$page,per_page:$perPage,sort:\"title\",direction:ASC}) { "
        "count scenes { " + scene_query_fields() + " } } }"
    )
    page = 1
    scenes = []
    count = None
    while count is None or len(scenes) < count:
        result = graphql(server, query, {"page": page, "perPage": PAGE_SIZE}).get("findScenes") or {}
        count = int(result.get("count") or 0)
        batch = result.get("scenes") or []
        if not batch:
            break
        scenes.extend(batch)
        page += 1
    return scenes


def frame_timestamps(duration, count):
    value = float(duration)
    if value <= 0:
        raise ValueError("Video duration must be positive")
    # Keep a small margin at both ends and center a single requested image.
    start = value * 0.06
    span = value * 0.88
    return [start + span * ((index + 0.5) / count) for index in range(count)]


def is_black_time(timestamp, black_ranges):
    return any(start <= timestamp <= end for start, end in black_ranges)


def choose_smart_timestamps(duration, count, scene_changes, black_ranges):
    duration = float(duration)
    start = duration * 0.06
    span = duration * 0.88
    bin_width = span / count
    minimum_gap = max(0.04, min(1.0, bin_width * 0.35))
    selected = []
    missing_bins = []
    scene_changes = sorted(set(float(value) for value in scene_changes if start <= float(value) <= start + span and not is_black_time(float(value), black_ranges)))

    for index in range(count):
        low = start + bin_width * index
        high = low + bin_width
        center = (low + high) / 2.0
        cuts = [value for value in scene_changes if low <= value < high and all(abs(value - previous) >= minimum_gap for previous in selected)]
        if cuts:
            selected.append(min(cuts, key=lambda value: abs(value - center)))
            continue
        fallback_offsets = (0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95)
        fallback_values = sorted((low + bin_width * fraction for fraction in fallback_offsets), key=lambda value: abs(value - center))
        choice = next((value for value in fallback_values if not is_black_time(value, black_ranges) and all(abs(value - previous) >= minimum_gap for previous in selected)), None)
        if choice is None:
            missing_bins.append((low, high, center))
        else:
            selected.append(choice)

    # Fill bins obscured by fades or black intervals from nearby non-black
    # scene cuts and a denser uniform grid, keeping the requested output count.
    if missing_bins:
        grid_count = max(count * 24, 48)
        grid = [start + span * ((index + 0.5) / grid_count) for index in range(grid_count)]
        pool = scene_changes + grid
        for _low, _high, center in missing_bins:
            options = [value for value in pool
                       if start <= value <= start + span
                       and not is_black_time(value, black_ranges)
                       and all(abs(value - previous) >= minimum_gap for previous in selected)]
            if not options:
                continue
            # Prefer an actual scene cut, then the nearest viable timestamp.
            cuts = [value for value in options if value in scene_changes]
            choice = min(cuts or options, key=lambda value: abs(value - center))
            selected.append(choice)

    # If a black interval consumed several whole bins, fill from the remaining
    # non-black points with the widest spacing available.
    if len(selected) < count:
        grid_count = max(count * 40, 80)
        pool = scene_changes + [start + span * ((index + 0.5) / grid_count) for index in range(grid_count)]
        while len(selected) < count:
            options = [value for value in pool
                       if start <= value <= start + span
                       and not is_black_time(value, black_ranges)
                       and all(abs(value - previous) >= minimum_gap for previous in selected)]
            if not options:
                raise RuntimeError("Smart sampling could not find the requested number of non-black frames. Try fewer images per scene or use evenly spaced sampling.")
            selected.append(max(options, key=lambda value: min([abs(value - previous) for previous in selected] or [span])))

    return sorted(selected[:count])


def analyze_scene_changes(ffmpeg, source, duration):
    global ACTIVE_PROCESS
    video_filter = "fps=2,scale='min(320,iw)':-2,blackdetect=d=0.12:pix_th=0.07,select='gt(scene,0.20)',showinfo"
    command = [
        ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "info", "-i", source,
        "-map", "0:v:0", "-vf", video_filter, "-an", "-f", "null", "-",
    ]
    try:
        ACTIVE_PROCESS = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        _stdout, stderr = ACTIVE_PROCESS.communicate(timeout=600)
        return_code = ACTIVE_PROCESS.returncode
    except subprocess.TimeoutExpired:
        ACTIVE_PROCESS.kill()
        ACTIVE_PROCESS.communicate()
        raise RuntimeError("FFmpeg scene analysis timed out; use evenly spaced sampling for this scene.")
    finally:
        ACTIVE_PROCESS = None
    if return_code:
        raise RuntimeError("FFmpeg scene analysis failed: " + str(stderr or "").strip()[-800:])
    scene_changes = [float(value) for value in re.findall(r"pts_time:([-+]?[0-9]*\.?[0-9]+)", stderr or "")]
    black_ranges = []
    for line in str(stderr or "").splitlines():
        if "black_start:" not in line:
            continue
        start_match = re.search(r"black_start:([0-9]+(?:\.[0-9]+)?)", line)
        end_match = re.search(r"black_end:([0-9]+(?:\.[0-9]+)?)", line)
        if start_match:
            black_start = max(0.0, float(start_match.group(1)))
            black_end = min(duration, float(end_match.group(1))) if end_match else duration
            if black_end >= black_start:
                black_ranges.append((black_start, black_end))
    return scene_changes, black_ranges


def run_ffmpeg_frame(ffmpeg, source, timestamp, destination):
    global ACTIVE_PROCESS
    signature_path = destination + ".signature"
    command = [
        ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", "{:.3f}".format(timestamp), "-i", source,
        "-map", "0:v:0", "-frames:v", "1", "-an",
        "-vf", "scale='min(1600,iw)':-2",
        "-q:v", "3", destination,
        "-map", "0:v:0", "-frames:v", "1", "-an",
        "-vf", "scale=16:9:flags=area,format=rgb24", "-f", "rawvideo", signature_path,
    ]
    try:
        ACTIVE_PROCESS = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        _stdout, stderr = ACTIVE_PROCESS.communicate(timeout=180)
        code = ACTIVE_PROCESS.returncode
    except subprocess.TimeoutExpired:
        ACTIVE_PROCESS.kill()
        _stdout, stderr = ACTIVE_PROCESS.communicate()
        raise RuntimeError("FFmpeg timed out while extracting a frame.")
    finally:
        ACTIVE_PROCESS = None
    if code:
        detail = str(stderr or "").strip()[-900:]
        raise RuntimeError("FFmpeg could not extract a frame" + (": " + detail if detail else "."))
    if not os.path.isfile(destination) or os.path.getsize(destination) < 128:
        raise RuntimeError("FFmpeg completed without creating a usable image.")
    try:
        with open(signature_path, "rb") as handle:
            signature = handle.read()
    except OSError:
        raise RuntimeError("FFmpeg did not create a comparison signature for the extracted frame.")
    finally:
        if os.path.exists(signature_path):
            try:
                os.remove(signature_path)
            except OSError:
                pass
    if len(signature) != 16 * 9 * 3:
        raise RuntimeError("FFmpeg returned an incomplete frame comparison signature.")
    return signature


def signature_average_luma(signature):
    if not signature:
        return 0.0
    values = [(signature[index] * 0.299 + signature[index + 1] * 0.587 + signature[index + 2] * 0.114)
              for index in range(0, len(signature), 3)]
    return sum(values) / len(values)


def signature_difference(left, right):
    if not left or len(left) != len(right):
        return 255.0
    return sum(abs(a - b) for a, b in zip(left, right)) / len(left)


def alternate_frame_timestamps(duration, count, index, preferred):
    start = float(duration) * 0.06
    span = float(duration) * 0.88
    width = span / count
    low = start + width * index
    high = low + width
    fractions = (0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95)
    candidates = [low + width * fraction for fraction in fractions]
    candidates = [value for value in candidates if abs(value - preferred) >= max(0.05, width * 0.08)]
    return sorted(set(candidates), key=lambda value: abs(value - preferred))[:3]


def extract_distinct_frame(ffmpeg, source, duration, count, index, preferred, destination, staging, previous_signatures):
    candidates = [preferred] + alternate_frame_timestamps(duration, count, index, preferred)
    best = None
    for attempt, timestamp in enumerate(candidates):
        attempt_path = os.path.join(staging, "attempt-{:03d}-{:02d}.jpg".format(index + 1, attempt + 1))
        signature = run_ffmpeg_frame(ffmpeg, source, timestamp, attempt_path)
        if signature_average_luma(signature) < 5.0:
            try:
                os.remove(attempt_path)
            except OSError:
                pass
            continue
        difference = min([signature_difference(signature, other) for other in previous_signatures] or [255.0])
        if difference >= 3.5 or not previous_signatures:
            os.replace(attempt_path, destination)
            if best and os.path.exists(best[1]):
                os.remove(best[1])
            return signature, timestamp, False
        if best is None or difference > best[0]:
            if best and os.path.exists(best[1]):
                os.remove(best[1])
            best = (difference, attempt_path, signature, timestamp)
        else:
            try:
                os.remove(attempt_path)
            except OSError:
                pass
    if best:
        os.replace(best[1], destination)
        return best[2], best[3], True
    raise RuntimeError("No usable non-black frame was found for requested image " + str(index + 1) + ".")


def output_directory(library_root, scene_id):
    safe_id = valid_scene_id(scene_id)
    base = os.path.join(library_root, "Scene Gallery Generator")
    target = os.path.join(base, "sgg-scene-" + safe_id)
    if os.path.islink(base) or os.path.islink(target):
        raise RuntimeError("The generated image directory cannot be a symbolic link.")
    os.makedirs(target, exist_ok=True)
    if not path_is_within(library_root, target):
        raise RuntimeError("The generated image directory escaped the selected library path.")
    if os.path.islink(target) or os.path.islink(base):
        raise RuntimeError("The generated image directory cannot be a symbolic link.")
    return target


def manifest_path(directory):
    return os.path.join(directory, ".scene-gallery-generator.json")


def read_manifest(directory):
    path = manifest_path(directory)
    if os.path.islink(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def write_manifest(directory, data):
    destination = manifest_path(directory)
    fd, temporary = tempfile.mkstemp(prefix=".sgg-manifest-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            try:
                os.remove(temporary)
            except OSError:
                pass


def generate_frames(scene, count, library_root, ffmpeg, sampling_mode=DEFAULT_SAMPLING_MODE, progress_start=0.0, progress_span=1.0):
    scene_id = valid_scene_id(scene.get("id"))
    files = [item for item in (scene.get("files") or []) if item and item.get("path")]
    if not files:
        raise RuntimeError("Scene has no video file.")
    video = files[0]
    source = os.path.abspath(str(video.get("path") or ""))
    directory = output_directory(library_root, scene_id)
    duration = float(video.get("duration") or 0)
    if duration <= 0:
        raise RuntimeError("Stash does not have a usable duration for this scene.")
    old_manifest = read_manifest(directory)
    old_names = []
    for name in old_manifest.get("generated_files") or []:
        if isinstance(name, str) and re.fullmatch(r"frame-[0-9]{3}\.jpg", name):
            old_names.append(name)
    staging = tempfile.mkdtemp(prefix=".sgg-stage-", dir=directory)
    names = ["frame-{:03d}.jpg".format(index + 1) for index in range(count)]
    try:
        if sampling_mode == "smart":
            report_progress(progress_start + progress_span * 0.02)
            try:
                scene_changes, black_ranges = analyze_scene_changes(ffmpeg, source, duration)
                timestamps = choose_smart_timestamps(duration, count, scene_changes, black_ranges)
                log_info("Smart sampling found " + str(len(scene_changes)) + " scene-change candidate(s) for scene " + scene_id + ".")
            except RuntimeError as error:
                if "could not find the requested number of non-black frames" in str(error).lower():
                    raise
                log_info("Scene-change analysis failed for scene " + scene_id + "; using evenly spaced frames: " + str(error))
                timestamps = frame_timestamps(duration, count)
        else:
            timestamps = frame_timestamps(duration, count)
        signatures = []
        duplicate_fallbacks = 0
        for index, (timestamp, name) in enumerate(zip(timestamps, names)):
            signature, _selected_timestamp, duplicate_fallback = extract_distinct_frame(
                ffmpeg, source, duration, count, index, timestamp,
                os.path.join(staging, name), staging, signatures,
            )
            signatures.append(signature)
            if duplicate_fallback:
                duplicate_fallbacks += 1
            report_progress(progress_start + progress_span * 0.55 * ((index + 1) / max(1, count)))
        if duplicate_fallbacks:
            log_info("Scene " + scene_id + " had limited visual variety; used the least-duplicate available frame for " + str(duplicate_fallbacks) + " image(s).")
        for name in names:
            os.replace(os.path.join(staging, name), os.path.join(directory, name))
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return directory, names, old_manifest, old_names


def trigger_scan(server, paths):
    mutation = "mutation SceneGalleryGeneratorScan($input:ScanMetadataInput!) { metadataScan(input:$input) }"
    job_id = graphql(server, mutation, {"input": {"paths": paths, "rescan": True}}).get("metadataScan")
    if not job_id:
        raise RuntimeError("Stash did not queue a scan for the generated images.")
    log_info("Queued Stash image scan " + str(job_id))
    return str(job_id)


def wait_for_job(server, job_id, timeout=600):
    query = "query SceneGalleryGeneratorWait($input:FindJobInput!) { findJob(input:$input) { id status progress error } }"
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = graphql(server, query, {"input": {"id": str(job_id)}}).get("findJob") or {}
        status = str(job.get("status") or "").upper()
        if status == "FINISHED":
            return
        if status in ("FAILED", "CANCELLED", "STOPPING"):
            raise RuntimeError("Stash could not index generated images: " + str(job.get("error") or status))
        time.sleep(1.5)
    raise RuntimeError("Stash's image scan did not finish within ten minutes.")


def find_image_by_path(server, path):
    query = (
        "query SceneGalleryGeneratorImage($path:String!) { findImages("
        "image_filter:{path:{value:$path,modifier:EQUALS}},filter:{per_page:1}) { "
        "images { id title files { id path } } } }"
    )
    values = graphql(server, query, {"path": path}).get("findImages") or {}
    images = values.get("images") or []
    return images[0] if images else None


def find_gallery_by_id(server, gallery_id):
    if not gallery_id:
        return None
    try:
        query = "query SceneGalleryGeneratorFindGallery($id:ID!) { findGallery(id:$id) { id title } }"
        return graphql(server, query, {"id": str(gallery_id)}).get("findGallery")
    except Exception:
        return None


def find_gallery_by_path(server, directory, generated_names):
    desired = set(normalize_path(os.path.join(directory, name)) for name in generated_names)
    # A scanned directory commonly becomes a Stash gallery. Search by its unique
    # folder-derived title first, then scan gallery file paths as a compatibility fallback.
    title = os.path.basename(directory)
    try:
        query = (
            "query SceneGalleryGeneratorGalleryByTitle($title:String!) { "
            "findGalleries(gallery_filter:{title:{value:$title,modifier:EQUALS}},filter:{page:1,per_page:10}) { "
            "galleries { id title files { id path } } } }"
        )
        result = graphql(server, query, {"title": title}).get("findGalleries") or {}
        for gallery in result.get("galleries") or []:
            paths = set(normalize_path(item.get("path")) for item in (gallery.get("files") or []) if item and item.get("path"))
            if desired.intersection(paths):
                return gallery
    except Exception as error:
        log_info("Folder-title gallery lookup was unavailable; checking indexed gallery paths: " + str(error))

    query = (
        "query SceneGalleryGeneratorGalleries($page:Int!,$perPage:Int!) { "
        "findGalleries(filter:{page:$page,per_page:$perPage}) { count galleries { id title files { id path } } } }"
    )
    page = 1
    count = None
    while count is None or (page - 1) * PAGE_SIZE < count:
        try:
            result = graphql(server, query, {"page": page, "perPage": PAGE_SIZE}).get("findGalleries") or {}
        except Exception as error:
            log_info("Could not enumerate Stash galleries to find the generated folder: " + str(error))
            return None
        count = int(result.get("count") or 0)
        for gallery in result.get("galleries") or []:
            paths = set(normalize_path(item.get("path")) for item in (gallery.get("files") or []) if item and item.get("path"))
            if desired.intersection(paths):
                return gallery
        if not (result.get("galleries") or []):
            break
        page += 1
    return None


def get_gallery_snapshot(server, gallery_id):
    try:
        gallery_fields = introspect_fields(server, "Gallery", "fields")
        image_fields = introspect_fields(server, "Image", "fields")
    except Exception:
        gallery_fields = {"files"}
        image_fields = {"files"}
    selections = ["id", "title"]
    if "files" in gallery_fields:
        selections.append("files { id path }")
    if "images" in gallery_fields and "files" in image_fields:
        selections.append("images { id files { id path } }")
    query = "query SceneGalleryGeneratorGallerySnapshot($id:ID!) { findGallery(id:$id) { " + " ".join(selections) + " } }"
    try:
        return graphql(server, query, {"id": str(gallery_id)}).get("findGallery")
    except Exception:
        return None


def metadata_input(scene, gallery_title, supported_fields, include_identity=False):
    studio = scene.get("studio") or {}
    performer_ids = [str(item.get("id")) for item in (scene.get("performers") or []) if item and item.get("id")]
    tag_ids = [str(item.get("id")) for item in (scene.get("tags") or []) if item and item.get("id")]
    values = {
        "title": gallery_title,
        "details": scene.get("details"),
        "date": scene.get("date"),
        "rating100": scene.get("rating100"),
        "organized": scene.get("organized"),
        "studio_id": str(studio.get("id")) if studio.get("id") else None,
        "performer_ids": performer_ids,
        "tag_ids": tag_ids,
    }
    url = str(scene.get("url") or "").strip()
    if url:
        if "url" in supported_fields:
            values["url"] = url
        elif "urls" in supported_fields:
            values["urls"] = [url]
    if include_identity and "code" in supported_fields:
        values["code"] = "SGG-" + str(scene.get("id"))
    return {key: value for key, value in values.items() if key in supported_fields and value is not None}


def current_gallery_ids_for_scene(server, scene_id):
    query = "query SceneGalleryGeneratorSceneGalleries($id:ID!) { findScene(id:$id) { galleries { id } } }"
    try:
        scene = graphql(server, query, {"id": str(scene_id)}).get("findScene") or {}
    except Exception as error:
        raise RuntimeError("Could not read the scene's existing gallery links safely: " + str(error))
    return [str(item.get("id")) for item in (scene.get("galleries") or []) if item and item.get("id")]


def link_gallery_to_scene(server, scene_id, gallery_id, gallery_update_fields):
    if "scene_ids" in gallery_update_fields:
        mutation = "mutation SceneGalleryGeneratorLinkGallery($input:GalleryUpdateInput!) { galleryUpdate(input:$input) { id } }"
        graphql(server, mutation, {"input": {"id": str(gallery_id), "scene_ids": [str(scene_id)]}})
        return
    scene_fields = introspect_fields(server, "SceneUpdateInput", "inputFields")
    if "gallery_ids" not in scene_fields:
        raise RuntimeError("This Stash version does not expose a gallery-to-scene link in its GraphQL API.")
    gallery_ids = current_gallery_ids_for_scene(server, scene_id)
    if str(gallery_id) not in gallery_ids:
        gallery_ids.append(str(gallery_id))
    mutation = "mutation SceneGalleryGeneratorLinkScene($input:SceneUpdateInput!) { sceneUpdate(input:$input) { id } }"
    graphql(server, mutation, {"input": {"id": str(scene_id), "gallery_ids": gallery_ids}})


def update_image_metadata(server, image, scene, gallery_id, image_fields, index, count):
    if not image or "id" not in image:
        return
    title = str(scene.get("title") or ("Scene " + str(scene.get("id")))) + " — Frame {:02d}".format(index)
    input_fields = set(image_fields)
    values = metadata_input(scene, title, input_fields)
    if "gallery_id" in input_fields:
        values["gallery_id"] = str(gallery_id)
    if "id" not in input_fields:
        return
    values["id"] = str(image["id"])
    if len(values) <= 1:
        return
    mutation = "mutation SceneGalleryGeneratorImageUpdate($input:ImageUpdateInput!) { imageUpdate(input:$input) { id } }"
    graphql(server, mutation, {"input": values})


def attach_generated_files_if_supported(server, gallery_id, scene_id, directory, names, old_manifest, gallery_update_fields, gallery_create_fields, snapshot):
    image_ids = []
    file_ids = []
    images_by_name = {}
    for name in names:
        path = os.path.join(directory, name)
        image = find_image_by_path(server, path)
        if image:
            images_by_name[name] = image
            image_ids.append(str(image.get("id")))
            for file in image.get("files") or []:
                if file and file.get("id"):
                    file_ids.append(str(file["id"]))

    # Gallery files may be populated automatically from the scanned folder. If the
    # API exposes explicit attachment fields, refresh them from the indexed output.
    fields = gallery_update_fields or gallery_create_fields
    patch = {"id": str(gallery_id)}
    old_image_ids = set(str(item) for item in (old_manifest.get("image_ids") or []))
    if "image_ids" in fields and len(image_ids) == len(names) and isinstance(snapshot, dict) and isinstance(snapshot.get("images"), list):
        preserved = [str(item.get("id")) for item in snapshot.get("images") or []
                     if item and item.get("id") and str(item.get("id")) not in old_image_ids
                     and not any(normalize_path(path) in set(normalize_path(os.path.join(directory, name)) for name in (old_manifest.get("generated_files") or []))
                                 for path in [f.get("path") for f in (item.get("files") or []) if f and f.get("path")])]
        patch["image_ids"] = list(dict.fromkeys(preserved + image_ids))
    elif "file_ids" in fields and isinstance(snapshot, dict) and isinstance(snapshot.get("files"), list):
        old_paths = set(normalize_path(os.path.join(directory, name)) for name in (old_manifest.get("generated_files") or []))
        new_paths = set(normalize_path(os.path.join(directory, name)) for name in names)
        preserved = [str(item.get("id")) for item in snapshot.get("files") or []
                     if item and item.get("id") and normalize_path(item.get("path")) not in old_paths | new_paths]
        # The scanner owns the folder-backed file relation when the generated
        # files are already present there. Retain those indexed file IDs as-is.
        desired_file_ids = [str(item.get("id")) for item in snapshot.get("files") or []
                            if item and item.get("id") and normalize_path(item.get("path")) in new_paths]
        if new_paths.issubset(set(normalize_path(item.get("path")) for item in snapshot.get("files") or [] if item and item.get("path"))):
            patch["file_ids"] = list(dict.fromkeys(preserved + desired_file_ids))

    if len(patch) > 1 and "id" in gallery_update_fields:
        mutation = "mutation SceneGalleryGeneratorAttachImages($input:GalleryUpdateInput!) { galleryUpdate(input:$input) { id } }"
        graphql(server, mutation, {"input": patch})

    image_fields = introspect_fields(server, "ImageUpdateInput", "inputFields")
    for index, name in enumerate(names, 1):
        update_image_metadata(server, images_by_name.get(name), scene, gallery_id, image_fields, index, len(names))
    return image_ids, file_ids


def create_or_update_gallery(server, scene, directory, names, old_manifest):
    scene_id = valid_scene_id(scene.get("id"))
    gallery_create_fields = introspect_fields(server, "GalleryCreateInput", "inputFields")
    gallery_update_fields = introspect_fields(server, "GalleryUpdateInput", "inputFields")
    title = str(scene.get("title") or ("Scene " + scene_id)) + " — Scene Gallery"
    gallery = find_gallery_by_id(server, old_manifest.get("gallery_id"))
    if not gallery:
        gallery = find_gallery_by_path(server, directory, names)

    if gallery and gallery.get("id"):
        gallery_id = str(gallery["id"])
        values = metadata_input(scene, title, gallery_update_fields, include_identity=True)
        if "id" in gallery_update_fields:
            values["id"] = gallery_id
        if len(values) > 1:
            mutation = "mutation SceneGalleryGeneratorUpdate($input:GalleryUpdateInput!) { galleryUpdate(input:$input) { id } }"
            graphql(server, mutation, {"input": values})
    else:
        # Most Stash versions create a Gallery when scanning a folder of images.
        # If they do not, create one explicitly from the indexed image/file IDs.
        frame_images = [find_image_by_path(server, os.path.join(directory, name)) for name in names]
        image_ids = [str(item["id"]) for item in frame_images if item and item.get("id")]
        file_ids = []
        for item in frame_images:
            for file in (item or {}).get("files") or []:
                if file and file.get("id"):
                    file_ids.append(str(file["id"]))
        create_fields = metadata_input(scene, title, gallery_create_fields, include_identity=True)
        attachment_added = False
        if "image_ids" in gallery_create_fields:
            create_fields["image_ids"] = image_ids
            attachment_added = True
        elif "file_ids" in gallery_create_fields and file_ids:
            create_fields["file_ids"] = file_ids
            attachment_added = True
        if "scene_ids" in gallery_create_fields:
            create_fields["scene_ids"] = [scene_id]
        if not attachment_added:
            raise RuntimeError("Stash indexed the frames but did not create a gallery, and its GraphQL API has no supported image/file attachment input. The files remain in the generated library folder.")
        mutation = "mutation SceneGalleryGeneratorCreate($input:GalleryCreateInput!) { galleryCreate(input:$input) { id } }"
        created = graphql(server, mutation, {"input": create_fields}).get("galleryCreate") or {}
        if not created.get("id"):
            raise RuntimeError("Stash did not return an ID for the generated gallery.")
        gallery_id = str(created["id"])

    link_gallery_to_scene(server, scene_id, gallery_id, gallery_update_fields)
    snapshot = get_gallery_snapshot(server, gallery_id) or {}
    image_ids, file_ids = attach_generated_files_if_supported(
        server, gallery_id, scene_id, directory, names, old_manifest,
        gallery_update_fields, gallery_create_fields, snapshot,
    )
    snapshot = get_gallery_snapshot(server, gallery_id) or snapshot
    return gallery_id, image_ids, file_ids, snapshot


def remove_stale_generated_files(directory, old_names, new_names):
    keep = set(new_names)
    removed = []
    for name in old_names:
        if name in keep:
            continue
        if not re.fullmatch(r"frame-[0-9]{3}\.jpg", name):
            continue
        path = os.path.join(directory, name)
        if os.path.isfile(path) and not os.path.islink(path):
            os.remove(path)
            removed.append(path)
    return removed


def process_scene(server, scene, count, library_root, ffmpeg, general, force=False, sampling_mode=DEFAULT_SAMPLING_MODE, progress_start=0.0, progress_span=1.0):
    scene_id = valid_scene_id(scene.get("id"))
    files = [item for item in (scene.get("files") or []) if item and item.get("path")]
    if not files:
        return "skipped", "Scene " + scene_id + " has no video file."
    source = os.path.abspath(str(files[0].get("path") or ""))
    ensure_source_in_video_library(source, general)
    try:
        duration = float(files[0].get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0
    if duration <= 0:
        config_file = str(general.get("configFilePath") or "")
        ffprobe_name = "ffprobe.exe" if os.name == "nt" else "ffprobe"
        ffprobe = resolve_binary(general.get("ffprobePath"), os.path.dirname(config_file) if config_file else "", ffprobe_name)
        scene = dict(scene)
        scene["files"] = [dict(files[0], duration=probe_duration(ffprobe, source))] + files[1:]
    directory = output_directory(library_root, scene_id)
    old_manifest = read_manifest(directory)
    old_gallery = find_gallery_by_id(server, old_manifest.get("gallery_id")) if old_manifest.get("gallery_id") else None
    try:
        previous_count = int(old_manifest.get("image_count") or 0)
    except (TypeError, ValueError):
        previous_count = 0
    if not force and old_gallery and previous_count == count and old_manifest.get("sampling_mode") == sampling_mode:
        return "skipped", "Scene " + scene_id + " already has a generated gallery with " + str(count) + " frames."

    directory, names, old_manifest, old_names = generate_frames(scene, count, library_root, ffmpeg, sampling_mode, progress_start, progress_span)
    report_progress(progress_start + progress_span * 0.62)
    scan_job = trigger_scan(server, [directory])
    wait_for_job(server, scan_job)
    report_progress(progress_start + progress_span * 0.78)
    gallery_id, image_ids, file_ids, snapshot = create_or_update_gallery(server, scene, directory, names, old_manifest)
    removed = remove_stale_generated_files(directory, old_names, names)
    if removed:
        cleanup_job = trigger_scan(server, [directory])
        wait_for_job(server, cleanup_job)
        refreshed = get_gallery_snapshot(server, gallery_id)
        if refreshed:
            snapshot = refreshed
    manifest = {
        "plugin": PLUGIN_ID,
        "scene_id": scene_id,
        "gallery_id": gallery_id,
        "image_count": count,
        "sampling_mode": sampling_mode,
        "generated_files": names,
        "image_ids": image_ids,
        "file_ids": file_ids,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    write_manifest(directory, manifest)
    log_info("Generated " + str(count) + " frame(s) and updated gallery " + gallery_id + " for scene " + scene_id + ".")
    report_progress(progress_start + progress_span * 0.99)
    return "generated", "Scene " + scene_id + " → gallery " + gallery_id


def normalize_bool(value):
    return value is True or str(value).strip().lower() in ("1", "true", "yes", "on")


def scene_id_from_hook(hook_args):
    candidates = [hook_args]
    for key in ("input", "args", "scene", "scene_data"):
        value = hook_args.get(key) if isinstance(hook_args, dict) else None
        if isinstance(value, dict):
            candidates.append(value)
            for nested_key in ("scene", "input", "object"):
                nested = value.get(nested_key)
                if isinstance(nested, dict):
                    candidates.append(nested)
    for item in candidates:
        if not isinstance(item, dict):
            continue
        for key in ("scene_id", "id"):
            value = item.get(key)
            if isinstance(value, (str, int)) and re.fullmatch(r"[0-9]{1,20}", str(value)):
                return str(value)
    return ""


def handle_scene_create_hook(input_data):
    hook_args = input_data.get("args") or input_data
    hook_value = hook_args.get("hook_name") or hook_args.get("hook") or input_data.get("hook_name") or input_data.get("hook") or ""
    if isinstance(hook_value, dict):
        hook_value = hook_value.get("name") or hook_value.get("hook_name") or ""
    hook_name = str(hook_value)
    if hook_name and hook_name != "Scene.Create.Post":
        return {"output": "Ignored hook " + hook_name}
    server = input_data.get("server_connection") or {}
    settings = read_plugin_settings(server)
    if not normalize_bool(settings.get("autoGenerate", False)):
        return {"output": "Automatic scene gallery generation is disabled."}
    scene_id = scene_id_from_hook(hook_args)
    if not scene_id:
        raise RuntimeError("Stash created a scene, but the Scene.Create.Post hook did not provide its ID.")
    try:
        image_count = validate_image_count(settings.get("defaultImageCount", DEFAULT_IMAGE_COUNT))
    except RuntimeError:
        image_count = DEFAULT_IMAGE_COUNT
    library_path = str(settings.get("imageLibraryPath") or "")
    args_map = {
        "mode": "generate",
        "scene_id": scene_id,
        "image_count": image_count,
        "sampling_mode": DEFAULT_SAMPLING_MODE,
        "library_path": library_path,
        "force": False,
    }
    mutation = (
        "mutation SceneGalleryGeneratorEnqueue($pluginId:ID!,$taskName:String!,$args:Map!) { "
        "runPluginTask(plugin_id:$pluginId,task_name:$taskName,args_map:$args) }"
    )
    job_id = graphql(server, mutation, {"pluginId": PLUGIN_ID, "taskName": TASK_NAME, "args": args_map}).get("runPluginTask")
    if not job_id:
        raise RuntimeError("Stash did not queue the automatic gallery task for scene " + scene_id + ".")
    log_info("Queued automatic gallery generation for new scene " + scene_id + " (job " + str(job_id) + ").")
    return {"output": "Queued gallery generation for scene " + scene_id + "."}


def run_task(input_data):
    args = input_data.get("args") or {}
    hook_name = args.get("hook_name") or args.get("hook") or input_data.get("hook_name") or input_data.get("hook")
    if isinstance(hook_name, dict):
        hook_name = hook_name.get("name") or hook_name.get("hook_name")
    if hook_name == "Scene.Create.Post":
        return handle_scene_create_hook(input_data)
    if not args.get("mode") and not args.get("scene_id"):
        raise RuntimeError("The Stash task did not include a supported generation mode.")
    if args.get("mode") not in (None, "generate"):
        raise RuntimeError("Unsupported Scene Gallery Generator task mode: " + str(args.get("mode")))
    server = input_data.get("server_connection") or {}
    settings = read_plugin_settings(server)
    general = read_general_configuration(server)
    count = validate_image_count(args.get("image_count", settings.get("defaultImageCount", DEFAULT_IMAGE_COUNT)))
    sampling_mode = validate_sampling_mode(args.get("sampling_mode", DEFAULT_SAMPLING_MODE))
    library_root = choose_image_library(general, args.get("library_path", ""), settings)
    config_file = str(general.get("configFilePath") or "")
    config_directory = os.path.dirname(config_file) if config_file else ""
    ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    ffmpeg = resolve_binary(general.get("ffmpegPath"), config_directory, ffmpeg_name)

    requested_id = str(args.get("scene_id") or "").strip()
    force = normalize_bool(args.get("force", False))
    if requested_id:
        scene = get_scene(server, valid_scene_id(requested_id))
        report_progress(0.02)
        status, message = process_scene(server, scene, count, library_root, ffmpeg, general, force=force, sampling_mode=sampling_mode)
        report_progress(1.0)
        return {"output": message, "status": status, "scene_id": requested_id, "image_count": count}

    scenes = get_scenes(server)
    candidates = [scene for scene in scenes if scene and scene.get("files")]
    if not candidates:
        report_progress(1.0)
        return {"output": "No scenes with video files were found.", "generated": 0, "skipped": len(scenes), "failed": 0}
    generated = 0
    skipped = 0
    failures = []
    total = len(candidates)
    for index, scene in enumerate(candidates):
        try:
            start = index / max(1, total)
            span = 1.0 / max(1, total)
            status, message = process_scene(server, scene, count, library_root, ffmpeg, general, force=force, sampling_mode=sampling_mode, progress_start=start, progress_span=span)
            if status == "generated":
                generated += 1
            else:
                skipped += 1
            log_info(message)
        except SystemExit:
            raise
        except Exception as error:
            failures.append((str(scene.get("id") or "?"), str(error)))
            log_info("Scene " + str(scene.get("id") or "?") + " failed: " + str(error))
        report_progress((index + 1) / max(1, total))

    summary = "Completed library run: " + str(generated) + " generated/refreshed, " + str(skipped) + " skipped, " + str(len(failures)) + " failed."
    log_info(summary)
    if failures:
        log_info("Failed scene IDs: " + ", ".join(item[0] for item in failures[:40]))
    report_progress(1.0)
    if generated == 0 and failures:
        raise RuntimeError(summary + " First failure: scene " + failures[0][0] + ": " + failures[0][1])
    return {"output": summary, "generated": generated, "skipped": skipped, "failed": len(failures)}


def main():
    try:
        if sys.version_info < (3, 8):
            raise RuntimeError("Scene Gallery Generator requires Python 3.8 or newer.")
        input_data = json.loads(sys.stdin.read() or "{}")
        result = run_task(input_data)
        print(json.dumps(result, ensure_ascii=False))
    except SystemExit as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        raise
    except Exception as error:
        log_info("Task failed: " + str(error))
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
