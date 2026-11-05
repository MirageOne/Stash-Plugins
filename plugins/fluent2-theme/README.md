# Fluent 2 Theme

Fluent 2 Theme is a separate Stash 0.32-compatible theme plugin inspired by Microsoft Fluent 2. Its home page follows the full dashboard mock-up: an application bar and navigation rail, a featured Recently Added scene, Continue Watching, library counts, recent activity, and a scene details inspector. It uses the system Segoe UI font stack, neutral Fluent surfaces, blue brand accents, rounded controls, and mica-like translucent chrome.

It carries over the compatibility and usability work from Current: the automatically cycling carousel; the Stash application mark that follows the chosen accent; theme settings inside **Settings → Interface**; responsive library navigation and a mobile route sheet; single-section settings navigation with a mobile picker; neutral Tagger result backgrounds; non-overlapping mobile include/exclude and performer controls; clear spacing for tags and action groups; styled dropdowns and selects; and the scene, performer, filter, and card layout fixes. Stash keeps control of its native player, library operations, and server preferences.

Fluent 2 has its own plugin ID, local preferences, routes, CSS namespace, and settings, so it can be installed alongside Current. Disable other full-app themes while previewing it to avoid global style conflicts.

## Install

Add or reload the MirageOne Stash Plugins source in **Settings → Plugins** and install **Fluent 2 Theme**, or manually extract the `fluent2-theme/` folder from [Fluent 2 Theme 0.1.2](../../packages/fluent2-theme/0.1.2-manual.zip) into Stash's configured `plugins/` directory. Reload the Stash UI after enabling it.

The theme has no external dependencies or build step. User preferences are stored locally in the browser. It is distributed under [AGPL-3.0](./LICENSE).
