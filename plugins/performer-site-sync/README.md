# Performer Site Sync

Performer Site Sync is a Stash 0.32 raw plugin for synchronizing performer metadata and favorite performers or studios with configured StashBox sources. It uses Stash's authenticated local GraphQL connection and the StashBox endpoints and API keys already configured in **Settings → Metadata Providers → Stash-boxes**.

## Features

- Update all performers or start a sync from the **Sync metadata** button on a performer page.
- Match by an existing Stash ID first. When enabled, a missing ID can be resolved only by one exact name match.
- Merge values in the configured source order. Empty source values never clear local metadata. Existing values are preserved unless **Overwrite Existing Metadata** is enabled.
- Map StashBox names, aliases, URLs, gender, dates, height, measurements, physical details, career years, images, and source IDs to the fields in Stash 0.32's `PerformerUpdateInput`.
- Import StashBox favorite performers or favorite studios as local Stash favorites. Matching records gain the Stash ID for that source; creating missing local records is optional.
- Cache successful GraphQL responses in a deterministic SQLite cache, honor source request limits, retry temporary HTTP failures, and report per-source connection errors without displaying API keys.

The upstream plugin called studios “sites” and attempted to query `me.favorites.sites`, which is not part of the StashBox schema. This rewrite uses the supported **favorite studios** query and local `Studio` mutations.

## Install and configure

Install from the MirageOne Stash Plugins source described in the repository root README, or extract the [2.0.1 manual archive](../../packages/performer-site-sync/2.0.1-manual.zip) into Stash's configured plugin directory. Enable **Performer Site Sync** in **Settings → Plugins** and reload plugins.

Add the StashBox sources you use under **Settings → Metadata Providers → Stash-boxes**. The plugin recognizes StashDB, ThePornDB, and FansDB by their configured name or endpoint. It does not read API keys from guessed config files or log credentials. Then review **Settings → Plugins → Performer Site Sync**:

- **Source Precedence** is a comma-separated priority list; the default is `stashdb,tpdb,fansdb`.
- **Match Performers by Name** is enabled by default and requires exactly one case-insensitive exact-name result.
- **Overwrite Existing Metadata** is off by default. With it off, the plugin fills blank fields and adds aliases, URLs, and source IDs while preserving populated scalar fields.
- **Update Performer Images** is enabled; existing images are replaced only if overwrite is also enabled.
- **Create Missing Performers/Studios** are off by default and apply only when importing favorites.
- **Minimum Request Delay** adds a delay between calls. The configured StashBox requests-per-minute limit is also observed.
- **Cache Expiration** controls how long successful StashBox responses are reused. Use **Clear Cache** after changing source data or credentials.

## Tasks

Run **Update All Performers**, **Sync Favorite Performers**, **Sync Favorite Studios**, **Test Connections**, **Validate Configuration**, **Clear Cache**, or **Generate Sync Report** from the plugin task list. The performer page button queues the same single-performer operation through Stash 0.32's `runPluginTask(plugin_id, args_map)` GraphQL mutation.

Favorite imports use the StashBox `queryPerformers` and `queryStudios` queries with `is_favorite: true`. The connected account must be authorized to read its own favorites. Sources that do not expose those queries will be reported as failed while other configured sources continue.

## Stash 0.32 compatibility

The backend uses Stash's `raw` plugin task input (`server_connection`, `args`), `SessionCookie`, `configuration.plugins(include: ...)`, `findPerformers`, `findStudios`, `performerUpdate`, `performerCreate`, `studioUpdate`, and `studioCreate`. It uses 0.32 field names and types, including `alias_list: [String!]`, `urls: [String!]`, `height_cm`, `career_start`, and `career_end`; it has no Python package dependencies. Task progress uses Stash's `SOH p STX` stderr protocol so progress updates are not recorded as errors.

## License

This rewrite is released under the MIT License. See [LICENSE](LICENSE) for the upstream copyright notice and license terms.
