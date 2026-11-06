# Stash Downloader

Stash Downloader adds a URL queue for downloading videos and images, extracting metadata, and importing completed downloads into Stash. Its React interface uses Stash's shared `PluginApi` and samples the active host theme's rendered controls, colors, typography, and borders so it can follow stock or third-party themes without relying on theme-specific variable names. Its navigation shortcut sits beside the right-side utility buttons.

## Features

- Queue individual URLs or batch-import a list.
- Extract metadata through yt-dlp and review it before importing.
- Download supported video URLs through yt-dlp and direct image URLs through the server, with progress reporting and quality limits.
- Save downloads inside the matching video- or image-enabled Stash library so Stash can scan and index them.
- Configure the server's yt-dlp executable and optional HTTP/SOCKS proxy in Stash plugin settings.
- Use Stash's configured FFmpeg path for yt-dlp format merging when it is available.
- Persist queue state in the browser and review task logs.

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

Reload sources and install **Stash Downloader**. For a manual installation, extract the [manual archive](../../packages/stash-downloader/0.6.2-manual.zip) into Stash's configured plugin directory, install the Python dependencies, then enable the plugin.

## Configure

In **Settings → Plugins → Stash Downloader**, set `yt-dlp Path` or `HTTP Proxy` if needed. Leave `Download Path` empty to use the first matching video or image library directory. A custom path must be an absolute directory inside a library enabled for that content type; leave it blank if video and image libraries use different roots. The server validates it before writing files so Stash can scan the completed download.

The browser cannot choose a server filesystem path or executable. Downloads use the plugin settings saved in Stash, and result/progress files are kept in a private temporary directory and removed after use or after 24 hours.

## Notes and follow-up ideas

- The URL importer can access network addresses reachable from the Stash server. For shared or untrusted Stash accounts, restrict server egress to the media sites users are allowed to download from.
- The upstream source declares controls for automatic performer/tag/studio creation, a filename template, and notifications, but does not wire those controls to behavior. The importer currently resolves metadata names automatically. Those unused controls are omitted here so the Stash settings page only exposes working fields. Useful next steps are opt-out controls, a filename template, and post-import automation settings.
- Browser-extension support from the upstream monorepo is not included in this Stash plugin package.
