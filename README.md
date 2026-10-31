# Cinema Catalog Theme for Stash

A dark, media-first UI theme for Stash. It keeps Stash's existing routes and controls, brings the main navigation into a desktop sidebar, and presents it as a slide-out drawer on mobile. Media cards remain image-led, with compact metadata and visible progress indicators.

The theme ships with Fluent-inspired Blue as its default accent. Change it in **Settings → Plugins → Cinema Catalog**. Blue, Teal, Green, Yellow, Orange, Red, Pink, and Purple are available. The selection applies immediately, is cached locally, and is also saved to Stash's UI configuration when GraphQL settings are available.

## Install

1. Download `dist/cinema-catalog-theme.zip` and extract the `cinema-catalog` folder into Stash's configured plugins directory.
2. Restart Stash or reload its plugin list.
3. Enable **Cinema Catalog** in **Settings → Plugins** and reload the Stash UI.

The plugin is UI-only; it has no server executable or database migration. To remove it, disable the plugin and delete its folder from the plugins directory.

## Package contents

- `cinema-catalog.yml` — Stash plugin manifest.
- `cinema-catalog.css` — dark catalog styling, desktop sidebar, mobile drawer, cards, controls, and accent palette.
- `cinema-catalog.js` — palette picker in plugin settings and accent persistence.

This package is prepared for local installation. One-click installation from the Stash Plugin Manager additionally requires publishing a plugin source index and hosting these files.
