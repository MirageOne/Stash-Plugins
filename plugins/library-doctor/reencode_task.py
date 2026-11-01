"""Stash raw plugin task for safe, server-side FFmpeg re-encoding."""
import json
import hashlib
import os
import re
import shutil
import signal
import stat
import subprocess
import sys

try:
    # Stash exposes task logging through its Python API package. Keep the
    # top-level import as a compatibility fallback for older plugin runners.
    from stashapi import log
except ImportError:
    try:
        import log
    except ImportError:  # Allows the validation harness to run outside Stash.
        class _Log:
            @staticmethod
            def LogInfo(message):
                sys.stderr.write(str(message) + "\n")

            @staticmethod
            def LogProgress(value):
                pass

        log = _Log()


ACTIVE_PROCESS = None
ACTIVE_JOB_HANDLE = None
ACTIVE_WATCHDOG = None


def log_info(message):
    try:
        log.LogInfo(str(message))
    except Exception:
        pass


def report_progress(value):
    try:
        log.LogProgress(float(max(0.0, min(1.0, value))))
    except Exception:
        pass


def ffmpeg_elapsed_seconds(line):
    """Read FFmpeg's progress time across its common -progress formats."""
    field, separator, value = line.partition("=")
    if not separator:
        return None
    if field in ("out_time_us", "out_time_ms"):
        try:
            # FFmpeg reports these fields in microseconds despite the legacy
            # out_time_ms name.
            return int(value) / 1000000.0
        except ValueError:
            return None
    if field == "out_time":
        try:
            hours, minutes, seconds = value.split(":", 2)
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        except ValueError:
            return None
    return None


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
    raise SystemExit("Re-encode cancelled; source file was left unchanged.")


for _signal in (getattr(signal, "SIGTERM", None), getattr(signal, "SIGINT", None)):
    if _signal is not None:
        try:
            signal.signal(_signal, cancel_handler)
        except (ValueError, OSError):
            pass


def graphql(server, query, variables=None):
    import urllib.error
    import urllib.request

    port = int(server.get("Port") or 0)
    scheme = str(server.get("Scheme") or "http")
    if not port or scheme not in ("http", "https"):
        raise RuntimeError("Stash did not provide a valid local server connection.")
    request_data = {"query": query}
    if variables is not None:
        request_data["variables"] = variables
    request = urllib.request.Request(
        scheme + "://localhost:" + str(port) + "/graphql",
        data=json.dumps(request_data).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    cookie = (server.get("SessionCookie") or {}).get("Value")
    if cookie:
        request.add_header("Cookie", "session=" + str(cookie))
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        operation = re.search(r"\b(?:query|mutation)\s+(\w+)", query)
        operation_name = operation.group(1) if operation else "request"
        try:
            detail = error.read(1200).decode("utf-8", "replace").strip()
        except Exception:
            detail = ""
        suffix = ": " + detail if detail else ""
        raise RuntimeError(
            "Stash GraphQL rejected " + operation_name + " with HTTP " + str(error.code) + suffix
        )
    except Exception as error:
        raise RuntimeError("Could not contact Stash's local GraphQL API: " + str(error))
    if payload.get("errors"):
        messages = [str(item.get("message", item)) for item in payload["errors"]]
        raise RuntimeError("Stash GraphQL error: " + "; ".join(messages))
    if not payload.get("data"):
        raise RuntimeError("Stash returned no data for a required GraphQL request.")
    return payload["data"]


def resolve_binary(configured, config_directory, name):
    candidate = str(configured or "").strip()
    if candidate:
        if os.path.isdir(candidate):
            candidate = os.path.join(candidate, name)
        if os.path.isfile(candidate):
            return candidate
        # A configured command may deliberately be resolved through PATH.
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    resolved = shutil.which(name)
    if resolved:
        return resolved
    fallback = os.path.join(config_directory, name)
    if os.path.isfile(fallback):
        return fallback
    raise RuntimeError("Stash could not find " + name + ". Check Settings → Configuration → General and the server PATH.")


def probe(ffprobe, path):
    completed = subprocess.run(
        [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        universal_newlines=True,
        timeout=120,
        check=False,
    )
    if completed.returncode:
        raise RuntimeError("FFprobe could not read the video: " + completed.stderr[-1200:].strip())
    try:
        data = json.loads(completed.stdout)
    except ValueError:
        raise RuntimeError("FFprobe returned invalid video details.")
    videos = [stream for stream in data.get("streams", []) if stream.get("codec_type") == "video" and not stream.get("disposition", {}).get("attached_pic")]
    if not videos:
        raise RuntimeError("The selected file has no playable video stream.")
    duration = float(data.get("format", {}).get("duration") or videos[0].get("duration") or 0)
    if duration <= 0:
        raise RuntimeError("FFprobe could not confirm the video duration.")
    return data, duration, int(videos[0].get("index", 0))


def copy_file_exclusive(source, destination):
    created = False
    try:
        with open(source, "rb") as input_file:
            with open(destination, "xb") as output_file:
                created = True
                shutil.copyfileobj(input_file, output_file, 1024 * 1024)
        shutil.copystat(source, destination)
        if os.path.getsize(source) != os.path.getsize(destination):
            raise RuntimeError("The copied file size did not match the verified source.")
    except Exception:
        if created:
            try:
                os.remove(destination)
            except OSError:
                pass
        raise


def acquire_file_lock(metadata_path, file_id, source):
    lock_directory = os.path.join(metadata_path, "LibraryDoctor", "Locks")
    os.makedirs(lock_directory, exist_ok=True)
    lock_name = hashlib.sha256((str(file_id) + "\n" + source).encode("utf-8")).hexdigest() + ".lock"
    handle = open(os.path.join(lock_directory, lock_name), "a+b")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except Exception:
        handle.close()
        raise RuntimeError("Another Library Doctor FFmpeg task is already running for this scene file.")
    return handle


def release_file_lock(handle):
    if handle is None:
        return
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except Exception:
        pass
    handle.close()


PRESETS = {
    "h264_compat": {"codec": "libx264", "crf": 22, "speed": "medium", "height": 0, "audio": "aac192"},
    "h264_quality": {"codec": "libx264", "crf": 18, "speed": "slow", "height": 0, "audio": "copy"},
    "hevc_saver": {"codec": "libx265", "crf": 28, "speed": "medium", "height": 0, "audio": "copy"},
    "hevc_quality": {"codec": "libx265", "crf": 23, "speed": "slow", "height": 0, "audio": "copy"},
}


def validated_settings(args):
    preset = str(args.get("preset") or "custom")
    if preset in PRESETS:
        chosen = dict(PRESETS[preset])
    elif preset == "custom":
        chosen = {
            "codec": args.get("codec"),
            "crf": int(args.get("crf", 23)),
            "speed": args.get("speed"),
            "height": int(args.get("max_height", 0)),
            "audio": args.get("audio"),
        }
    else:
        raise RuntimeError("Choose one of the listed encoding presets or Custom settings.")
    if chosen["codec"] not in ("libx264", "libx265"):
        raise RuntimeError("The video codec must be H.264 (x264) or H.265 (x265).")
    if chosen["speed"] not in ("fast", "medium", "slow"):
        raise RuntimeError("Choose Fast, Balanced, or Smaller file for encoding speed.")
    if chosen["audio"] not in ("copy", "aac160", "aac192", "aac256"):
        raise RuntimeError("Choose Copy audio or one of the listed AAC bitrates.")
    if chosen["crf"] < 16 or chosen["crf"] > 35:
        raise RuntimeError("Custom CRF must be between 16 and 35.")
    if chosen["height"] not in (0, 720, 1080, 1440, 2160):
        raise RuntimeError("Choose a listed maximum resolution.")
    container = str(args.get("container") or "mkv").lower()
    if container not in ("mkv", "mp4"):
        raise RuntimeError("Choose MKV or MP4 as the output container.")
    return chosen, container


def ffmpeg_arguments(ffmpeg, source, temporary, settings, container, video_stream_index):
    command = [ffmpeg, "-hide_banner", "-nostdin", "-i", source, "-map", "0:" + str(video_stream_index), "-map", "0:a?", "-map", "0:s?", "-map_metadata", "0", "-map_chapters", "0"]
    command.extend(["-c:v", settings["codec"], "-preset", settings["speed"], "-crf", str(settings["crf"]), "-pix_fmt", "yuv420p"])
    if settings["height"]:
        height = settings["height"]
        width = height * 16 // 9
        command.extend(["-vf", "scale=w='min(iw," + str(width) + ")':h='min(ih," + str(height) + ")':force_original_aspect_ratio=decrease:force_divisible_by=2"])
    if settings["audio"] == "copy":
        command.extend(["-c:a", "copy"])
    else:
        bitrate = settings["audio"][3:]
        command.extend(["-c:a", "aac", "-b:a", bitrate + "k"])
    command.extend(["-c:s", "copy" if container == "mkv" else "mov_text"])
    if container == "mp4":
        command.extend(["-movflags", "+faststart"])
    command.extend(["-progress", "pipe:1", "-nostats", temporary])
    return command


def linux_parent_death_setup(parent_pid):
    def setup_child():
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        # PR_SET_PDEATHSIG: have the kernel stop FFmpeg if Stash kills this task.
        if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
            os._exit(127)
        if os.getppid() != parent_pid:
            os.kill(os.getpid(), signal.SIGTERM)
    return setup_child


def attach_windows_kill_job(process):
    """Tie FFmpeg lifetime to this Python task with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE."""
    import ctypes
    from ctypes import wintypes

    class BasicLimitInformation(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD),
        ]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_ulonglong) for name in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class ExtendedLimitInformation(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BasicLimitInformation), ("IoInfo", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise RuntimeError("Windows could not create an FFmpeg cancellation job.")
    info = ExtendedLimitInformation()
    info.BasicLimitInformation.LimitFlags = 0x00002000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not kernel.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
        kernel.CloseHandle(job)
        raise RuntimeError("Windows could not configure FFmpeg cancellation for this task.")
    if not kernel.AssignProcessToJobObject(job, wintypes.HANDLE(process._handle)):
        kernel.CloseHandle(job)
        raise RuntimeError("Windows could not attach FFmpeg to the Stash task lifetime.")
    return kernel, job


def start_macos_watchdog(parent_pid, child_pid):
    # macOS lacks Linux's PR_SET_PDEATHSIG and Windows job objects. This tiny
    # helper watches both PIDs and terminates FFmpeg if Stash kills the task.
    watcher = (
        "import os,signal,sys,time\n"
        "parent=int(sys.argv[1]); child=int(sys.argv[2])\n"
        "def alive(pid):\n"
        " try: os.kill(pid,0); return True\n"
        " except OSError: return False\n"
        "while alive(parent) and alive(child): time.sleep(0.2)\n"
        "if not alive(parent) and alive(child):\n"
        " try: os.kill(child,signal.SIGTERM)\n"
        " except OSError: sys.exit(0)\n"
        "for _ in range(20):\n"
        " if not alive(child): sys.exit(0)\n"
        " time.sleep(0.1)\n"
        "try: os.kill(child,signal.SIGKILL)\n"
        "except OSError: pass\n"
    )
    return subprocess.Popen(
        [sys.executable, "-c", watcher, str(parent_pid), str(child_pid)],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        close_fds=True,
    )


def run_ffmpeg(command, duration):
    global ACTIVE_PROCESS, ACTIVE_JOB_HANDLE, ACTIVE_WATCHDOG
    popen_options = {
        "stdout": subprocess.PIPE, "stderr": subprocess.STDOUT,
        "universal_newlines": True, "bufsize": 1,
    }
    parent_pid = os.getpid()
    if sys.platform.startswith("linux"):
        popen_options["preexec_fn"] = linux_parent_death_setup(parent_pid)
    ACTIVE_PROCESS = subprocess.Popen(command, **popen_options)
    windows_kernel = None
    if sys.platform == "darwin":
        try:
            ACTIVE_WATCHDOG = start_macos_watchdog(parent_pid, ACTIVE_PROCESS.pid)
        except Exception:
            ACTIVE_PROCESS.terminate()
            ACTIVE_PROCESS.wait()
            ACTIVE_PROCESS = None
            raise RuntimeError("Could not set up FFmpeg cancellation for this macOS task.")
    if os.name == "nt":
        try:
            windows_kernel, ACTIVE_JOB_HANDLE = attach_windows_kill_job(ACTIVE_PROCESS)
        except Exception:
            ACTIVE_PROCESS.terminate()
            ACTIVE_PROCESS.wait()
            ACTIVE_PROCESS = None
            raise
    recent = []
    last_progress = -1
    try:
        for line in ACTIVE_PROCESS.stdout:
            line = line.rstrip()
            if not line:
                continue
            recent.append(line)
            recent = recent[-16:]
            elapsed = ffmpeg_elapsed_seconds(line)
            if elapsed is not None and duration > 0:
                progress = min(0.94, max(0.0, elapsed / duration * 0.94))
                rounded = int(progress * 100)
                if rounded != last_progress:
                    report_progress(progress)
                    last_progress = rounded
        return_code = ACTIVE_PROCESS.wait()
    finally:
        if ACTIVE_WATCHDOG is not None:
            try:
                ACTIVE_WATCHDOG.wait(timeout=3)
            except subprocess.TimeoutExpired:
                ACTIVE_WATCHDOG.terminate()
                ACTIVE_WATCHDOG.wait()
            ACTIVE_WATCHDOG = None
        if windows_kernel is not None and ACTIVE_JOB_HANDLE is not None:
            windows_kernel.CloseHandle(ACTIVE_JOB_HANDLE)
            ACTIVE_JOB_HANDLE = None
        ACTIVE_PROCESS = None
    if return_code:
        error = "\n".join(recent)
        raise RuntimeError("FFmpeg failed. The source was not changed. " + error[-1600:])


def run_task(input_data):
    args = input_data.get("args") or {}
    token = str(args.get("token") or "")
    if not re.match(r"^[a-fA-F0-9]{16,40}$", token):
        raise RuntimeError("Invalid re-encode job token.")
    scene_id = str(args.get("scene_id") or "")
    file_id = str(args.get("file_id") or "")
    if not scene_id or not file_id:
        raise RuntimeError("Select a scene file before starting the task.")
    settings, container = validated_settings(args)
    replace_original = args.get("replace_original") is True

    server = input_data.get("server_connection") or {}
    scene_file_query = "query LibraryDoctorReencodeSceneFiles($id: ID!) { findScene(id: $id) { id files { id path size duration } } }"
    scene_record = graphql(server, scene_file_query, {"id": scene_id}).get("findScene")
    if not scene_record:
        raise RuntimeError("The selected scene no longer exists. Run Health Check again.")
    record = next(
        (item for item in (scene_record.get("files") or []) if str(item.get("id")) == file_id),
        None,
    )
    if not record:
        raise RuntimeError("The selected video file is no longer attached to this scene. Run Health Check again.")
    source = os.path.abspath(str(record.get("path") or ""))
    if not source or not os.path.isfile(source) or os.path.islink(source):
        raise RuntimeError("The Stash source file is missing or is a symbolic link. No changes were made.")
    source_stat = os.stat(source)
    if source_stat.st_size <= 0:
        raise RuntimeError("The source file is empty. No changes were made.")

    config_query = "query LibraryDoctorReencodeConfig { configuration { general { ffmpegPath ffprobePath metadataPath configFilePath } } }"
    general = graphql(server, config_query).get("configuration", {}).get("general", {})
    config_file = str(general.get("configFilePath") or "")
    config_directory = os.path.dirname(config_file) if config_file else ""
    ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    ffprobe_name = "ffprobe.exe" if os.name == "nt" else "ffprobe"
    ffmpeg = resolve_binary(general.get("ffmpegPath"), config_directory, ffmpeg_name)
    ffprobe = resolve_binary(general.get("ffprobePath"), config_directory, ffprobe_name)
    _, duration, video_stream_index = probe(ffprobe, source)

    metadata_value = str(general.get("metadataPath") or "").strip()
    if not metadata_value:
        raise RuntimeError("Stash did not provide its metadata directory. Check the server configuration.")
    metadata_path = os.path.abspath(metadata_value)
    if not metadata_path or not os.path.isdir(metadata_path):
        raise RuntimeError("Stash's metadata directory is unavailable. Check the server configuration.")
    source_name = os.path.basename(source)
    stem, source_extension = os.path.splitext(source_name)
    source_extension = source_extension.lstrip(".") or "mkv"
    if replace_original:
        source_container = source_extension.lower()
        if source_container not in ("mkv", "mp4") or source_container != container:
            raise RuntimeError("For in-place replacement, the source must be an MP4 or MKV and the selected container must match. Save a new file for other formats.")
    output_root = os.path.join(metadata_path, "LibraryDoctor", "Reencoded")
    backup_root = os.path.join(metadata_path, "LibraryDoctor", "Backups")
    output_extension = source_extension if replace_original else container
    destination = source if replace_original else os.path.join(output_root, stem + ".ld-reencoded-" + token + "." + output_extension)
    temporary = os.path.join(os.path.dirname(source), "." + stem + ".ld-" + token + ".partial." + container)
    backup = os.path.join(backup_root, stem + ".ld-backup-" + token + "." + source_extension) if replace_original else ""
    os.makedirs(os.path.dirname(temporary), exist_ok=True)
    if not replace_original:
        os.makedirs(output_root, exist_ok=True)
    else:
        os.makedirs(backup_root, exist_ok=True)
    if os.path.exists(temporary) or (not replace_original and os.path.exists(destination)) or (replace_original and os.path.exists(backup)):
        raise RuntimeError("A file with this job's unique name already exists. Start a new re-encode task.")

    log_info("Starting " + settings["codec"] + " re-encode for Stash file " + file_id + ".")
    report_progress(0.01)
    lock_handle = None
    try:
        lock_handle = acquire_file_lock(metadata_path, file_id, source)
        latest_source_stat = os.stat(source)
        if latest_source_stat.st_size != source_stat.st_size or latest_source_stat.st_mtime_ns != source_stat.st_mtime_ns:
            raise RuntimeError("The source changed while the task was being prepared. Run Health Check again before encoding it.")
        command = ffmpeg_arguments(ffmpeg, source, temporary, settings, container, video_stream_index)
        run_ffmpeg(command, duration)
        if not os.path.isfile(temporary) or os.path.getsize(temporary) <= 0:
            raise RuntimeError("FFmpeg completed without creating a usable output. The source was not changed.")
        _, output_duration, _ = probe(ffprobe, temporary)
        if output_duration < duration * 0.9 or output_duration > duration * 1.1:
            raise RuntimeError("The output duration differs significantly from the source. The source was not changed.")
        if replace_original:
            before_backup = os.stat(source)
            if before_backup.st_size != source_stat.st_size or before_backup.st_mtime_ns != source_stat.st_mtime_ns:
                raise RuntimeError("The source changed during encoding. The replacement was cancelled and the source was kept.")
            copy_file_exclusive(source, backup)
            after_backup = os.stat(source)
            if os.path.getsize(backup) != source_stat.st_size or after_backup.st_size != source_stat.st_size or after_backup.st_mtime_ns != source_stat.st_mtime_ns:
                try:
                    os.remove(backup)
                except OSError:
                    pass
                raise RuntimeError("The source changed while its backup was being copied. The replacement was cancelled and the source was kept.")
            os.chmod(temporary, stat.S_IMODE(source_stat.st_mode))
            try:
                os.replace(temporary, source)
            except OSError as error:
                try:
                    os.remove(backup)
                    backup_note = " The temporary backup was removed."
                except OSError:
                    backup_note = " A backup remains at " + backup + "."
                raise RuntimeError("Could not replace the source file; it was left unchanged." + backup_note + " " + str(error))
            report_progress(0.96)
            log_info("Verified replacement complete. Original backup: " + backup)
            scan_mutation = "mutation LibraryDoctorRefreshFile($paths: [String!]!) { metadataScan(input: { paths: $paths, rescan: true }) }"
            try:
                scan_job = graphql(server, scan_mutation, {"paths": [source]}).get("metadataScan")
            except Exception as error:
                raise RuntimeError("The source was replaced and a backup is saved at " + backup + ", but Stash could not queue a metadata refresh: " + str(error))
            if not scan_job:
                raise RuntimeError("The replacement is installed and backed up, but Stash did not queue a metadata refresh.")
            log_info("Queued a Stash metadata refresh task: " + str(scan_job))
            report_progress(1.0)
            return {"output": "Replaced the source after verification. Backup: " + backup + ". Stash metadata refresh queued: " + str(scan_job)}
        copy_file_exclusive(temporary, destination)
        try:
            os.remove(temporary)
        except OSError:
            pass
        report_progress(1.0)
        log_info("Verified re-encode saved to " + destination)
        return {"output": "Re-encoded file: " + destination}
    finally:
        if os.path.exists(temporary):
            try:
                os.remove(temporary)
            except OSError:
                pass
        release_file_lock(lock_handle)


def main():
    if sys.version_info < (3, 8):
        print(json.dumps({"error": "Library Doctor's FFmpeg task requires Python 3.8 or newer."}))
        sys.exit(1)
    try:
        input_data = json.loads(sys.stdin.read() or "{}")
        result = run_task(input_data)
        print(json.dumps(result))
    except SystemExit as error:
        print(json.dumps({"error": str(error)}))
        raise
    except Exception as error:
        log_info("Library Doctor re-encode failed: " + str(error))
        print(json.dumps({"error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
