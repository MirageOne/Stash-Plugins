# Stash Downloader

Stash Downloader adds a URL queue for downloading videos and images, extracting metadata, and importing completed downloads into Stash. Its React interface uses Stash's shared `PluginApi` and samples the active host theme's rendered controls, colors, typography, spacing, radii, and elevation so it can follow stock or third-party themes without relying on theme-specific variable names. The rebuilt dashboard follows Library Doctor's header, editorial hierarchy, rounded surfaces, theme tokens, and accent states. Queue management and activity logs now have separate workspaces, with responsive queue search and status filters. Its navigation shortcut sits beside the right-side utility buttons.

## Features

- Queue individual URLs or batch-import a list.
- Extract metadata through yt-dlp and review it before importing.
- Download supported video URLs through yt-dlp and direct image URLs through the server, with progress reporting and quality limits.
- Install or update yt-dlp from the page in an isolated Python virtual environment, without changing Stash's system Python.
- Save downloads inside the matching video- or image-enabled Stash library so Stash can scan and index them.
- Configure the server's yt-dlp executable and optional HTTP/SOCKS proxy in Stash plugin settings.
- Use Stash's configured FFmpeg path for yt-dlp format merging when it is available.
- Persist queue state in the browser and review task logs.
- Search queued items by title, source URL, metadata, or error; filter by pending, active, completed, or items needing attention.
- Separate the download queue from its activity log in two focused workspaces.
- Save reusable import profiles with domain matching, metadata creation rules, filename templates, auto-import behavior, and post-import actions.
- Check Stash and the queue for duplicate source URLs before adding work, with controls to open, skip, or add an existing scene anyway.
- Recover active server downloads after a page reload by reconnecting to the Stash job or resuming from the saved library file.

## Requirements

- A current Stash installation with plugin UI and raw plugin task support (Stash 0.32 or newer recommended).
- Python configured for Stash, with `requests[socks]` installed in that interpreter.
- yt-dlp is optional; use the page's **Install yt-dlp** action to create a downloader-managed virtual environment in the Stash user's data directory. Python's `venv` support and access to the Python package index are required.
- FFmpeg is optional for simple downloads; yt-dlp needs it to merge separate audio/video streams. The plugin passes Stash's configured FFmpeg path when available.

The bundled interface is already built; Node.js and npm are not needed on the Stash server to install or use the plugin.

Install Python dependencies on the Stash host or in the Stash container:

```sh
python -m pip install -r /path/to/stash-downloader/requirements.txt
```

Use the Python interpreter configured for Stash if it differs from `python`. The requirements file installs Requests only; yt-dlp is installed separately by the downloader page into an isolated environment.

## Install

Add the MirageOne Stash Plugins source in **Settings → Plugins → Add source** using:

```text
https://raw.githubusercontent.com/MirageOne/Stash-Plugins/main/index.yml
```

Reload sources and install **Stash Downloader** from **Available Plugins**. For a manual installation, extract the [0.8.1 manual archive](../../packages/stash-downloader/0.8.1-manual.zip) into Stash's configured plugin directory, install the Python dependencies, then enable the plugin in **Settings → Plugins**.

## Configure

In **Settings → Plugins → Stash Downloader**, set `yt-dlp Path` or `HTTP Proxy` if needed. Leave `yt-dlp Path` empty to use auto-detection and the page's managed environment. `Managed yt-dlp Environment` can point to an absolute writable virtual-environment directory; by default, Linux stores it under `~/.local/share/stash-downloader/yt-dlp` (or `$XDG_DATA_HOME/stash-downloader/yt-dlp`). For Docker, set this to a writable path on a persistent mounted volume so yt-dlp survives container replacement. `Download Path` can be left empty to use the first matching video or image library directory; a custom download path must be inside a library enabled for that content type.

The browser cannot choose a server filesystem path or executable. Downloads use the plugin settings saved in Stash, and result/progress files are kept in a private temporary directory and removed after use or after 24 hours. The Install/Update button runs `pip` only inside the managed virtual environment. The Stash container needs Python `venv` support, package-index network access (or the configured HTTP proxy), and write access to the managed path.

On the downloader queue page, use **Import profile → Manage profiles** to create per-site behavior. Domain patterns accept one host per line and `*.example.com`; a matching profile is copied onto each new queue item. Profiles can control whether missing performers, tags, and studios are created, choose `{title}`, `{site}`, `{date}`, and `{id}` filename tokens, select a post-import action, and enable no-review batch importing. Existing queued items keep the profile values they were added with.

When a source URL already belongs to a Stash scene, the downloader offers **Open existing**, **Skip**, and **Add anyway**. Queue-level duplicate checks normalize host casing, `www`, trailing slashes, query ordering, and common tracking parameters.

## Notes and follow-up ideas

- The URL importer can access network addresses reachable from the Stash server. For shared or untrusted Stash accounts, restrict server egress to the media sites users are allowed to download from.
- Import profiles and the browser queue are stored in the current browser's local storage. Stash server settings such as download paths and proxy credentials remain in Stash plugin settings.
- Browser-extension support from the upstream monorepo is not included in this Stash plugin package.

## Troubleshooting

- If the managed install cannot start, check Python `venv` support, package-index network/proxy access, and write permissions. Debian-based Docker images may need `python3-venv`; use a persistent volume path for the managed environment.
- A configured **yt-dlp Path** takes precedence over the managed environment. Clear that setting to use the page's Install/Update action, or update the custom executable yourself.
- If a download cannot be imported, leave **Download Path** blank or choose a directory inside a Stash library enabled for that media type. Confirm the Stash process can write to the directory.
- If metadata extraction or a download stalls, check the item log, proxy settings, and server network access. FFmpeg is needed when yt-dlp must combine separate audio and video streams.

## License

Stash Downloader is released under the [MIT License](LICENSE).
