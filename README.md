# Stash Plugins

This repository hosts independent Stash plugins. Each plugin keeps its manifest, UI assets, and plugin-specific documentation in its own directory under `plugins/`. The root `index.yml` is the shared package source for all plugins in the repository.

## Available plugins

- [Fluent Mica](plugins/fluent-mica/README.md) — a Fluent 2 theme with a dark Mica foundation, Acrylic surfaces, Refract-based layout, and configurable Fluent accent colors.
- [Library Doctor](plugins/library-doctor/README.md) — Health Check, filename-based metadata suggestions, configured-source scraping and auto-tagging, guided fixes, and duplicate or alternate-version review.

## Install from Stash

Add the repository once in Stash under **Settings → Plugins → Add source**. Use **MirageOne Stash Plugins** as the source name and this index URL:

```text
https://raw.githubusercontent.com/MirageOne/Stasher/main/index.yml
```

Reload plugins, then install any listed plugin from **Available Plugins**. New plugins added to the shared index will appear under the same source.

## Manual install

Download a plugin's manual archive, extract its included plugin folder into Stash's configured plugins directory, then enable it in **Settings → Plugins**.

- [Fluent Mica manual archive](packages/fluent-mica/1.0.4-manual.zip)
- [Library Doctor manual archive](packages/library-doctor/1.4.0-manual.zip)

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
