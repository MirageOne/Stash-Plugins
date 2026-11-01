# Cinema Catalog Theme for Stash

A dark, media-first UI theme for Stash. It keeps Stash's existing routes and controls, brings the main navigation into a desktop sidebar, and presents it as a slide-out drawer on mobile. Media cards remain image-led, with compact metadata and visible progress indicators.

The theme ships with Fluent-inspired Blue as its default accent. Change it in **Settings → Plugins → Cinema Catalog**. Blue, Teal, Green, Yellow, Orange, Red, Pink, and Purple are available. The selection applies immediately, is cached locally, and is also saved to Stash's UI configuration when GraphQL settings are available.

## Install from Stash

In Stash, open **Settings → Plugins → Add source**, name it **Cinema Catalog**, and use this package index URL:

```text
https://raw.githubusercontent.com/MirageOne/Stasher/main/index.yml
```

Reload the plugin list, then install **Cinema Catalog** from **Available Plugins**. The index verifies the downloadable package with SHA-256.

## Manual install

Download `dist/cinema-catalog-theme.zip` and extract the `cinema-catalog` folder into Stash's configured plugins directory. Restart Stash or reload its plugin list, then enable **Cinema Catalog** in **Settings → Plugins**.

The plugin is UI-only; it has no server executable or database migration. To remove it, disable and uninstall it from **Settings → Plugins**, or delete its folder after a manual install.

## Package contents

- `cinema-catalog.yml` — Stash plugin manifest.
- `cinema-catalog.css` — dark catalog styling, desktop sidebar, mobile drawer, cards, controls, and accent palette.
- `cinema-catalog.js` — palette picker in plugin settings and accent persistence.
- `index.yml` — package source index for Stash's plugin manager.
- `dist/cinema-catalog-stash-plugin.zip` — flat package archive used by the plugin manager.
- `dist/cinema-catalog-theme.zip` — folder-wrapped archive for manual installation.
