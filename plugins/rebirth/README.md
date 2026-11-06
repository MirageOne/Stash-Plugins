# Rebirth

Rebirth is a video-first Stash theme plugin with Geist typography, a responsive library rail, a large home carousel for new arrivals, a Continue Watching row, and a Stash box mark whose tile follows the selected accent. It also themes the native Settings sections, including their form rows, scraper tables, task queue, logs, and status colors; Settings switches remain beside their labels on phones. Its Interface settings let you choose one or two scene columns on mobile. Other features include distinct accent-filled tag chips, neutral Tagger results, square mobile include/exclude controls, wrapped performer controls, compact tag actions, theme-styled dropdown menus across Stash actions, selects, and the video player, light and dark modes, four bolder accents—Cobalt, Orchid, Jade, and Terracotta—and Soft Fill buttons. Its sharp-cornered switches use Rebirth's accent and surface colors. Saved selections from the previous palette are mapped to their closest new color. It preserves Stash's own player, library operations, and customizable recommendation shelves. Its plugin ID and folder consistently use `rebirth`.

The home carousel and Continue Watching shelf use Stash GraphQL scene data. New arrivals can sort by the library-add time or scene release date. Continue Watching filters scenes with a saved resume position and opens the normal Stash scene route, where the built-in player applies Stash's resume behavior.

Geist Variable Sans 5.3.0 from Fontsource is bundled under the SIL Open Font License 1.1 and loads through Stash's local plugin asset route, so the theme does not need a remote font request.

When signed in, Rebirth syncs appearance preferences to server-side plugin settings keyed by the authenticated Stash user ID. Existing account and browser preferences migrate on first use; later sessions use the account copy across browsers, including incognito. The browser keeps a local cache and remains the fallback when the session identity or server-side plugin settings are unavailable. No preferences are written to Stash's user record. The login page is served outside Stash's plugin UI, so a theme plugin alone cannot restyle it. FrontPage component patching uses Stash's documented experimental UI plugin API and should be checked against each Stash release.

## Development install

Copy this directory into Stash's configured `plugins/` directory, reload plugins in **Settings → Plugins**, then enable **Rebirth**. After updating, reload the Stash UI in the browser so the new JavaScript and CSS load. Disable other full-app theme plugins while testing it so global styles do not conflict.

For a packaged manual install, download [Rebirth 1.0.1](../../packages/rebirth/1.0.1-manual.zip) and extract its `rebirth/` folder into the configured plugins directory.

## Screenshots

These screenshots show Rebirth's interface on a live Stash 0.32.0 instance. The library contains only fictional, non-explicit demo clips created for this capture.

### Home

The new-arrivals carousel leads the page and automatically advances every seven seconds while the page is visible. Its arrows, dots, keyboard controls, and touch swipes remain available. Continue Watching sits directly below it, followed by Stash's existing recommendation shelves.

![Rebirth home page with a new-arrivals carousel and Continue Watching row](screenshots/home-dark.png)

![Rebirth home page in light mode](screenshots/home-light.png)

![Rebirth home page on a mobile viewport](screenshots/mobile-home.png)

The mobile dock always has four items: three destinations you choose in **Settings → Interface → Theme Settings** and a final **More** button that opens the remaining pages. Stash settings show one category at a time, with a wrapped tab bar on desktop and a section picker on phones. Rebirth themes the native section rows, tables, logs, task states, and feedback colors throughout Settings. The native Plugins filter remains available, and the installed plugin list scrolls inside its panel.

![Rebirth mobile More menu showing the remaining destinations](screenshots/mobile-drawer.png)

### Scene library

![Stash scene library using Rebirth navigation and styling](screenshots/scene-library.png)

![Stash scene library in light mode with Rebirth filters and accent controls](screenshots/scene-library-light.png)

### Statistics

![Stash statistics with Rebirth cards and charts](screenshots/statistics.png)

### Accent colors

The Interface settings now offer Cobalt, Orchid, Jade, and Terracotta. [Compare the palettes in dark and light mode](mockups/accent-palettes.html).

### Buttons

Soft Fill uses pale accent fills for primary actions, a matching accent outline for secondary actions, and a separate red treatment for destructive actions. The outline text deepens in light mode for contrast.

![Soft Fill buttons with Geist typography in Stash's plugin settings](screenshots/soft-fill-buttons.png)

## Visual audit

The Rebirth interface was checked in a live Stash 0.32.0 instance at desktop and mobile widths. The audit covered the home carousel and Continue Watching shelf, scene filters and zoom, statistics cards and charts, theme settings embedded under **Settings → Interface**, native settings and logs, navigation, and the light/dark appearance. All twelve native Settings sections were selected at desktop width, and the mobile section picker was used to change sections. Scene Tagger result rows use neutral surfaces; include/exclude controls stay square at phone widths, performer action groups wrap inside the result card, and tag suggestion buttons stay separate. Search, automatic and manual carousel navigation, accent changes, card layout, the three-destination mobile dock and its More menu, flyout labels with the desktop rail collapsed, reduced effects, and sidebar collapse were exercised in the browser. Library mutations, playback, detail pages, and server settings stay on Stash's native routes and APIs.

The library in the screenshots contains fictional, non-explicit demo clips.

The plugin has no external dependencies or build step. Its JavaScript and manifest can be syntax-checked directly with Node; its styles load from `css/rebirth-1.0.1.css`.

Rebirth is distributed under [AGPL-3.0](./LICENSE).
