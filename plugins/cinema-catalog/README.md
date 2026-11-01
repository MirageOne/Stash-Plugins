# Cinema Catalog

A dark glass UI theme for Stash with a desktop navigation rail, a mobile off-canvas drawer, and a configurable Fluent-inspired accent palette.

The menu is built from Stash's live `navbar-collapse` route list. It preserves the routes enabled in **Settings → Interface**, plugin-provided navigation entries, and Stash's original link targets instead of maintaining a separate guessed list. On mobile, the same route list opens in a drawer; Stash's utility buttons remain available in the drawer footer. This layout follows the navigation structure used by [Stash Refract](https://github.com/ordureconnoisseur/stash-refract).

The accent picker is in **Settings → Plugins → Cinema Catalog**. It offers Blue, Teal, Green, Yellow, Orange, Red, Pink, and Purple. The selected accent applies immediately and is cached locally.

Install from the shared repository source in the root README, or [download the 0.1.3 manual archive](../../packages/cinema-catalog/0.1.3-manual.zip) and extract its `cinema-catalog/` folder into Stash's configured plugins directory.
