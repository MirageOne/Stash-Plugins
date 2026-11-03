# Current Theme

Current is a video-first Stash theme plugin with Geist typography, a responsive library rail, a large home carousel for new arrivals, a Continue Watching row, light and dark modes, seven accent colors, and Soft Fill buttons. It preserves Stash's own player, library operations, and customizable recommendation shelves. Its plugin ID, folder, asset names, and settings route consistently use `current-theme`.

The home carousel and Continue Watching shelf use Stash GraphQL scene data. New arrivals can sort by the library-add time or scene release date. Continue Watching filters scenes with a saved resume position and opens the normal Stash scene route, where the built-in player applies Stash's resume behavior.

Geist Variable Sans 5.3.0 from Fontsource is bundled under the SIL Open Font License 1.1 and loads through Stash's local plugin asset route, so the theme does not need a remote font request.

Theme preferences are stored in the current browser. The login page is served outside Stash's plugin UI, so a theme plugin alone cannot restyle it. FrontPage component patching uses Stash's documented experimental UI plugin API and should be checked against each Stash release.

## Development install

Copy this directory into Stash's configured `plugins/` directory, reload plugins in **Settings → Plugins**, then enable **Current Theme**. Disable other full-app theme plugins while testing it so global styles do not conflict.

For a packaged manual install, download [Current Theme 0.1.8](../../packages/current-theme/0.1.8-manual.zip) and extract its `current-theme/` folder into the configured plugins directory.

## Screenshots

These screenshots were captured from a live Stash 0.32.0 instance running Current Theme. The library contains only fictional, non-explicit demo clips created for this capture.

### Home

The new-arrivals carousel leads the page, with Continue Watching directly below it. Stash's existing recommendation shelves remain further down the page.

![Current home page with a new-arrivals carousel and Continue Watching row](screenshots/home-dark.png)

![Current home page in light mode](screenshots/home-light.png)

![Current home page on a mobile viewport](screenshots/mobile-home.png)

The mobile dock always has four items: three destinations you choose in Theme settings and a final **More** button that opens the remaining pages.

![Current mobile More menu showing the remaining destinations](screenshots/mobile-drawer.png)

### Scene library

![Stash scene library using Current navigation and styling](screenshots/scene-library.png)

![Stash scene library in light mode with Current filters and accent controls](screenshots/scene-library-light.png)

### Statistics

![Stash statistics with Current cards and charts](screenshots/statistics.png)

### Theme settings

![Current theme settings for accent color, card layout, navigation, and playback](screenshots/theme-settings.png)

### Buttons

Soft Fill uses pale accent fills for primary actions, a matching accent outline for secondary actions, and a separate red treatment for destructive actions. The outline text deepens in light mode for contrast.

![Soft Fill buttons with Geist typography in Stash's plugin settings](screenshots/soft-fill-buttons.png)

## Visual audit

The current UI was checked in a live Stash 0.32.0 instance at desktop and mobile widths. The audit covered the home carousel and Continue Watching shelf, scene filters and zoom, statistics cards and charts, theme settings, native settings and logs, navigation, and the light/dark appearance. Search, carousel navigation, accent changes, card layout, the three-destination mobile dock and its More menu, flyout labels with the desktop rail collapsed, reduced effects, and sidebar collapse were exercised in the browser. Library mutations, playback, detail pages, and server settings stay on Stash's native routes and APIs.

The library in the screenshots contains fictional, non-explicit demo clips.

The plugin has no external dependencies or build step. Its JavaScript and manifest can be syntax-checked directly with Node; its styles load from `css/current-theme.css`.

Current is distributed under [AGPL-3.0](./LICENSE).
