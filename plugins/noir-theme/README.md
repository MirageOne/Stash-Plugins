# Noir

A modern, dark Fluent 2-inspired theme for Stash, with a charcoal palette, violet accent, and the Archive Monogram brand mark. It is derived from the actual [Stash Refract theme](https://github.com/ordureconnoisseur/stash-refract), upstream version 1.24.3 at commit `5a14edb`.

The redesign replaces the desktop route row with a persistent left sidebar. The home page leads with a wide, up-to-five-scene spotlight carousel above Stash’s customizable recommendation shelves. It offers arrows, position indicators, and touch swipe, preferring scenes outside the visible shelf and hiding featured duplicates when it needs to draw from that shelf. Scene and image detail pages put their primary media in the wide left column and metadata tabs in a right rail. Gallery detail pages give the image grid the wide column and keep gallery information in the rail. At tablet and phone widths, media comes first and native tabs follow underneath. Performer profiles use an image-backed hero above their native scene and gallery tabs. Stash still owns the underlying player, filters, metadata, favorites, editing tools, and navigation actions. The sidebar can collapse to icons, and Settings → Interface → Noir lets users choose which Stash and plugin buttons appear there. Mobile uses a single-column scene and performer layout plus a configurable bottom dock. The default palette uses deep charcoal surfaces and Fluent Purple (#8764b8); Teal, Green, Yellow, Orange, Red, Pink, and Blue remain available in the accent picker.

The interface uses subdued page and card surfaces, restrained active states, compact corners, and Segoe UI typography. The Archive Monogram’s violet segment follows the selected accent color.

Scene video cards use one full-width column on mobile. Performer cards also switch to one full-width column on phones so names, favorites, and stats have room; compact two-column cards remain on wider tablets. Desktop scene lists use wider cards with a 360px minimum column width, reducing the number of columns on typical screens. Fresh installs use the restrained rating treatment; the optional Extravagant flourish remains available in plugin settings.

Scrolling uses reduced blur and cards no longer lift or animate large shadows as they pass under the pointer. Performer titles use a consistent size with ellipsis for long names, and favorites use a compact, always-visible heart. Performer nameplates size to the title, long names stop before the favorite control, and the favorite button is vertically centered with the name. Pagination page counts stay on one line at narrow widths.

The quick accent picker is in **Settings → Plugins → Noir**. Full theme settings are also available in **Settings → Interface → Noir**, including sidebar collapse, sidebar destinations, mobile dock items, and existing card and player options. The theme starts in dark mode; optional light and Lite modes remain available.

Install from the repository source in the root README or [download the 1.0.9 manual archive](../../packages/noir-theme/1.0.9-manual.zip) and extract the `noir-theme/` directory into Stash’s configured plugins directory. Enable Noir after installation. Disable other full-app themes while using it so their global styles do not conflict.

Noir is distributed under [AGPL-3.0](./LICENSE). The upstream license is included with this derivative.
