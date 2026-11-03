# Filmroom Theme

Filmroom is a video-first Stash theme plugin with a responsive library rail, a large home carousel for new arrivals, a Continue Watching row, light and dark modes, and seven accent colors. It preserves Stash's own player, library operations, and customizable recommendation shelves.

The home carousel and Continue Watching shelf use Stash GraphQL scene data. New arrivals can sort by the library-add time or scene release date. Continue Watching filters scenes with a saved resume position and opens the normal Stash scene route, where the built-in player applies Stash's resume behavior.

Theme preferences are stored in the current browser. The login page is served outside Stash's plugin UI, so a theme plugin alone cannot restyle it. FrontPage component patching uses Stash's documented experimental UI plugin API and should be checked against each Stash release.

## Development install

Copy this directory into Stash's configured `plugins/` directory, reload plugins in **Settings → Plugins**, then enable **Filmroom Theme**. Disable other full-app theme plugins while testing it so global styles do not conflict.

For a packaged manual install, download [Filmroom Theme 0.1.0](../../packages/filmroom-theme/0.1.0-manual.zip) and extract its `filmroom-theme/` folder into the configured plugins directory.

The plugin has no external dependencies or build step. Its JavaScript and manifest can be syntax-checked directly with Node; its styles load from `css/filmroom.css`.

Filmroom is distributed under [AGPL-3.0](./LICENSE).
