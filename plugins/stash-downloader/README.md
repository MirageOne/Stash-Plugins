# Stash Downloader

Stash Downloader adds a URL queue for downloading videos and images, extracting metadata, and importing completed downloads into Stash. Its React interface uses Stash's shared `PluginApi` and samples the active host theme's rendered controls, colors, typography, spacing, radii, and elevation so it can follow stock or third-party themes without relying on theme-specific variable names. Its navigation shortcut sits beside the right-side utility buttons.

## Features

- Queue individual URLs or batch-import a list.
- Extract metadata through yt-dlp and review it before importing.
- Download supported video URLs through yt-dlp and direct image URLs through the server, with progress reporting and quality limits.
- Save downloads inside the matching video- or image-enabled Stash library so Stash can scan and index them.
- Configure the server's yt-dlp executable and optional HTTP/SOCKS proxy in Stash plugin settings.
- Use Stash's configured FFmpeg path for yt-dlp format merging when it is available.
- Persist queue state in the browser and review task logs.
- Save reusable import profiles with domain matching, metadata creation rules, filename templates, auto-import behavior, and post-import actions.
- Check Stash and the queue for duplicate source URLs before adding work, with controls to open, skip, or add an existing scene anyway.
- Recover active server downloads after a page reload by reconnecting to the Stash job or resuming from the saved library file.

## Requirements

- A current Stash installation with plugin task support.
- The Python version configured for Stash and supported by the installed yt-dlp release (current yt-dlp releases may require a newer Python version).
- yt-dlp and Requests with SOCKS support installed in that Python environment.
- FFmpeg is optional for simple downloads; yt-dlp needs it to merge separate audio/video streams. The plugin passes Stash's configured FFmpeg path when available.

Install Python dependencies on the Stash host or in the Stash container:

```sh
python -m pip install -r /path/to/stash-downloader/requirements.txt
```

Use the Python interpreter configured for Stash if it differs from `python`. The plugin does not install packages or change the server's Python environment automatically.

## Install

Add the MirageOne Stash Plugins source in **Settings → Plugins → Add source** using:

```text
https://raw.githubusercontent.com/MirageOne/Stasher/main/index.yml
```

Reload sources and install **Stash Downloader**. For a manual installation, extract the [manual archive](../../packages/stash-downloader/0.6.5-manual.zip) into Stash's configured plugin directory, install the Python dependencies, then enable the plugin.

## Configure

In **Settings → Plugins → Stash Downloader**, set `yt-dlp Path` or `HTTP Proxy` if needed. Leave `Download Path` empty to use the first matching video or image library directory. A custom path must be an absolute directory inside a library enabled for that content type; leave it blank if video and image libraries use different roots. The server validates it before writing files so Stash can scan the completed download.

The browser cannot choose a server filesystem path or executable. Downloads use the plugin settings saved in Stash, and result/progress files are kept in a private temporary directory and removed after use or after 24 hours.

On the downloader queue page, use **Import profile → Manage profiles** to create per-site behavior. Domain patterns accept one host per line and `*.example.com`; a matching profile is copied onto each new queue item. Profiles can control whether missing performers, tags, and studios are created, choose `{title}`, `{site}`, `{date}`, and `{id}` filename tokens, select a post-import action, and enable no-review batch importing. Existing queued items keep the profile values they were added with.

When a source URL already belongs to a Stash scene, the downloader offers **Open existing**, **Skip**, and **Add anyway**. Queue-level duplicate checks normalize host casing, `www`, trailing slashes, query ordering, and common tracking parameters.

## Notes and follow-up ideas

- The URL importer can access network addresses reachable from the Stash server. For shared or untrusted Stash accounts, restrict server egress to the media sites users are allowed to download from.
- Import profiles and the browser queue are stored in the current browser's local storage. Stash server settings such as download paths and proxy credentials remain in Stash plugin settings.
- Browser-extension support from the upstream monorepo is not included in this Stash plugin package.
