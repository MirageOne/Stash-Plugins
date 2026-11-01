# Stash Plugins

This repository hosts independent Stash plugins. Each plugin keeps its manifest, UI assets, and plugin-specific documentation in its own directory under `plugins/`. The root `index.yml` is the shared package source for all plugins in the repository.

## Available plugins

- [Cinema Catalog](plugins/cinema-catalog/README.md) — a dark, media-first theme with a desktop sidebar, mobile drawer, and configurable Fluent-inspired accent colors.

## Install from Stash

Add the repository once in Stash under **Settings → Plugins → Add source**. Use **MirageOne Stash Plugins** as the source name and this index URL:

```text
https://raw.githubusercontent.com/MirageOne/Stasher/main/index.yml
```

Reload plugins, then install any listed plugin from **Available Plugins**. New plugins added to the shared index will appear under the same source.

## Manual install

For example, [download the Cinema Catalog manual archive](packages/cinema-catalog/0.1.3-manual.zip), extract the included plugin folder into Stash's configured plugins directory, then enable it in **Settings → Plugins**. Each plugin's README links to its current manual archive.

## Repository layout

```text
index.yml                         # shared Stash package source index
plugins/<plugin-id>/              # plugin manifest, UI assets, and README
packages/<plugin-id>/<version>.zip          # flat archive for Stash's installer
packages/<plugin-id>/<version>-manual.zip   # folder-wrapped manual install
```

Each Stash package index entry points to a flat archive under `packages/<plugin-id>/`. Keep package archives versioned so existing installs can be compared with newer index entries. The manual archive includes a top-level `<plugin-id>/` directory for direct extraction.

## Adding another plugin

Create `plugins/<plugin-id>/` for the plugin manifest, assets, and README. Add a Stash-installable flat ZIP at `packages/<plugin-id>/<version>.zip` and, if desired, a folder-wrapped manual ZIP beside it. Then append an entry for that plugin to the root `index.yml`, using a unique ID and the flat ZIP's SHA-256. Keep all plugin package entries in this one index so users only need to add the repository source once.
