# Stash Plugins

This repository hosts independent Stash plugins. Each plugin keeps its manifest, UI assets, and plugin-specific documentation in its own directory under `plugins/`. The root `index.yml` is the shared package source for all plugins in the repository.

## Available plugins

- [Library Doctor](plugins/library-doctor/README.md) — Health Check, FFmpeg encoding audit and re-encoding, metadata assistance, scraping, tagging, and duplicate or alternate-version review. [Screenshots](plugins/library-doctor/README.md#screenshots)
- [StashBox Metadata Review](plugins/stashbox-metadata-review/README.md) — review performer, scene, studio, and tag metadata field by field, or tag filtered scenes across any or all configured StashBoxes with Tagger-style fingerprint matching and source-specific IDs for downstream plugins. [Manual archive](packages/stashbox-metadata-review/1.2.3-manual.zip)
- [Stash Downloader](plugins/stash-downloader/README.md) — a theme-adaptive media queue with import profiles, source duplicate checks, recoverable server downloads, managed yt-dlp install/update, metadata review, search, and status filters. [Screenshots](plugins/stash-downloader/README.md#screenshots)
- [Discovery Queue](plugins/discovery-queue/README.md) — build a scene queue with play-history, runtime, rating, tag, performer, and studio filters. Explicit like, finish, skip, and dislike choices tune account-specific recommendations.
- [Rebirth](plugins/rebirth/README.md) — A responsive Stash theme with customizable accents, light and dark modes, and streamlined navigation. [Screenshots](plugins/rebirth/README.md#screenshots)
- [TPDB Markers](plugins/tpdb-markers/README.md) — imports ThePornDB markers, logs batch progress, and can create and link Stash Groups from TPDB movie or group records.
## Install from Stash

Add the repository once in Stash under **Settings → Plugins → Add source**. Use **MirageOne Stash Plugins** as the source name and this index URL:

```text
https://raw.githubusercontent.com/MirageOne/Stash-Plugins/main/index.yml
```

Reload plugins, then install any listed plugin from **Available Plugins**. New plugins added to the shared index will appear under the same source.

## Manual install

Download a plugin's manual archive, extract its included plugin folder into Stash's configured plugins directory, then enable it in **Settings → Plugins**.

- [Library Doctor manual archive](packages/library-doctor/1.6.12-manual.zip)
- [StashBox Metadata Review manual archive](packages/stashbox-metadata-review/1.2.3-manual.zip)
- [Stash Downloader manual archive](packages/stash-downloader/0.8.4-manual.zip)
- [Discovery Queue manual archive](packages/discovery-queue/1.0.1-manual.zip)
- [Rebirth manual archive](packages/rebirth/1.2.12-manual.zip)
- [TPDB Markers manual archive](packages/tpdb-markers/1.0.0-manual.zip)

Each plugin's README links to its current manual archive.

## Repository layout

```text
index.yml                                   # shared Stash package source index
plugins/<plugin-id>/                       # plugin manifest, assets, and README
packages/<plugin-id>/<version>.zip          # flat archive for Stash's installer
packages/<plugin-id>/<version>-manual.zip   # folder-wrapped manual install
```

Each Stash package index entry points to a flat archive under `packages/<plugin-id>/`. Keep package archives versioned so existing installs can be compared with newer index entries. The manual archive includes a top-level `<plugin-id>/` directory for direct extraction.

## Adding another plugin

Create `plugins/<plugin-id>/` for the plugin manifest, assets, and README. Add a Stash-installable flat ZIP at `packages/<plugin-id>/<version>.zip` and, if desired, a folder-wrapped manual ZIP beside it. Then append an entry for that plugin to the root `index.yml`, using a unique ID and the flat ZIP's SHA-256. Keep all plugin package entries in this one index so users only need to add the repository source once.
