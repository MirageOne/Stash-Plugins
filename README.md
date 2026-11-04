# Stash Plugins

This repository hosts independent Stash plugins. Each plugin keeps its manifest, UI assets, and plugin-specific documentation in its own directory under `plugins/`. The root `index.yml` is the shared package source for all plugins in the repository.

## Available plugins

- [Fluent Mica](plugins/fluent-mica/README.md) — a Fluent 2 theme with a dark Mica foundation, Acrylic surfaces, Refract-based layout, and configurable Fluent accent colors.
- [Noir](plugins/noir-theme/README.md) — a video-first redesign with flat charcoal surfaces, violet accents, the Archive Monogram, a collapsible desktop sidebar, and responsive mobile navigation.
- [Library Doctor](plugins/library-doctor/README.md) — Health Check, FFmpeg encoding audit and re-encoding, metadata assistance, scraping, tagging, and duplicate or alternate-version review.
- [Scene Gallery Generator](plugins/scene-gallery-generator/README.md) — Extract a user-selected number of still frames from scene videos and create metadata-rich galleries linked to their source scenes.
- [Stash Downloader](plugins/stash-downloader/README.md) — a Stash-integrated image and video URL queue with metadata extraction and server-side downloads.
- [Current Theme](plugins/current-theme/README.md) — a video-first redesign with Geist typography, a new-arrivals carousel, Continue Watching, customizable four-item mobile navigation, light and dark modes, seven accent colors, and Soft Fill buttons. [Screenshots](plugins/current-theme/README.md#screenshots)

## Install from Stash

Add the repository once in Stash under **Settings → Plugins → Add source**. Use **MirageOne Stash Plugins** as the source name and this index URL:

```text
https://raw.githubusercontent.com/MirageOne/Stash-Plugins/main/index.yml
```

Reload plugins, then install any listed plugin from **Available Plugins**. New plugins added to the shared index will appear under the same source.

## Manual install

Download a plugin's manual archive, extract its included plugin folder into Stash's configured plugins directory, then enable it in **Settings → Plugins**.

- [Fluent Mica manual archive](packages/fluent-mica/1.0.5-manual.zip)
- [Noir manual archive](packages/noir-theme/1.1.21-manual.zip)
- [Library Doctor manual archive](packages/library-doctor/1.6.4-manual.zip)
- [Scene Gallery Generator manual archive](packages/scene-gallery-generator/1.0.5-manual.zip)
- [Stash Downloader manual archive](packages/stash-downloader/0.6.2-manual.zip)
- [Current Theme manual archive](packages/current-theme/0.1.25-manual.zip)

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
