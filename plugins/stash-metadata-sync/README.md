# Stash Metadata Sync

Stash Metadata Sync updates performers, existing local tag metadata, scene tags, and ThePornDB scene markers from sources configured in **Settings → Metadata Providers → Stash-boxes**. It uses Stash's authenticated local GraphQL connection and each source's configured API key.

Stash Metadata Sync is a new plugin ID and folder. Reinstall it as a fresh plugin; settings from Performer Site Sync or earlier versions are not migrated.

## What it syncs

- **Performers:** Update all performers or use the **Sync metadata** button on an individual performer. It matches by source stash ID first; optional name matching requires one exact case-insensitive result. Descriptions, aliases, URLs, physical details, image and IDs map to Stash 0.32 fields. Populated scalar values are preserved unless **Overwrite Existing Metadata** is enabled.
- **Favorite performers and studios:** Import favorite flags from configured StashBox accounts. Creating missing local performers or studios is optional and disabled by default.
- **Tag metadata:** Match existing local tags by source stash ID, then exact name or local alias. Fill blank descriptions, merge aliases, and add missing source IDs. Names and populated descriptions stay as they are unless their respective overwrite settings are enabled. Unmatched tags are left alone; this task does not import the entire StashDB tag catalog or change local tag parents.
- **Scene tags:** Add missing local tags from each linked StashBox scene using Stash's additive `bulkSceneUpdate` mutation. Tags you remove after a live sync are recorded in local sync history and won't be added back on the next run. The default dry run previews at most 200 scenes across enabled sources.
- **Scene markers:** Merge markers from ThePornDB for local scenes carrying a ThePornDB stash ID. Existing local markers are preserved, duplicate markers are skipped, and a scene deleted during a run is skipped safely. The primary local tag is created when the marker label does not already match a local tag name or alias. The default dry run previews at most 200 scenes.
- **Groups and movies:** Import ThePornDB movie records as Stash 0.32 groups, merge missing group dates, synopsis, images and URLs, and link each group to its matching scene while preserving other scene-group links. The importer accepts both TPDB `movies` and `groups` response keys, matches existing groups by TPDB URL or a unique exact name, and uses URLs as the persistent source link because Stash groups do not have `stash_ids`. A matching local studio is linked when one unique name or alias match exists; missing studios are not created. The default dry run previews at most 200 scenes.
- **Stash log:** Successful performer, tag, scene-tag, marker, group, and favorite updates are written as INFO entries while the task runs. Dry-run previews for scene tags, markers, and groups are also logged as previews.

StashBox's GraphQL scene schema provides scene tags but no marker fields. Marker import therefore uses ThePornDB's REST scene endpoint and the Bearer API key already configured for ThePornDB. StashDB or FansDB alone cannot provide scene markers through this plugin.

## Install and configure

Install from the MirageOne Stash Plugins source in the repository root README, or extract the [1.0.1 manual archive](../../packages/stash-metadata-sync/1.0.1-manual.zip) into Stash's configured plugin directory. Enable **Stash Metadata Sync** in **Settings → Plugins** and reload plugins.

Add the sources you use under **Settings → Metadata Providers → Stash-boxes**. The plugin recognizes StashDB, ThePornDB, and FansDB by configured name or endpoint, and uses the API keys from Stash's own configuration. It does not search local files for keys or print credentials.

Review **Settings → Plugins → Stash Metadata Sync**:

- **Source Precedence** controls which source wins for performer or tag descriptions; the default is `stashdb,tpdb,fansdb`.
- **Overwrite Existing Metadata** controls populated performer fields. **Overwrite Tag Descriptions** and **Overwrite Tag Names** are separate and disabled by default.
- **Scene Tag Sync Dry Run** and **Scene Marker Sync Dry Run** are enabled by default. Review task output before disabling either setting.
- **Scene Group Sync Dry Run** is also enabled by default. Run **Sync ThePornDB Groups** once to review which groups and scene links would be added, then disable dry run to apply it. **Overwrite Group Metadata** can replace dates, synopsis, and images; local group names and studio links are preserved.
- **Scene Tag Sync Exclusions** accepts exact tag names separated by commas, semicolons, or newlines.
- **Tag Imported Markers** optionally adds a `[TPDBMarker]` source tag. The marker's primary tag is always created if needed.
- **Minimum Request Delay** and each box's requests-per-minute limit are applied to network calls.
- **Cache Expiration** controls cached successful StashBox GraphQL and ThePornDB REST responses. Use **Clear Cache** after changing source data or API keys.

## Tasks

The task list includes **Update All Performers**, **Sync All Tag Metadata**, **Sync Scene Tags**, **Reset Scene Tag Sync History**, **Sync ThePornDB Scene Markers**, **Sync ThePornDB Groups**, **Sync Favorite Performers**, **Sync Favorite Studios**, **Test Connections**, **Validate Configuration**, **Clear Cache**, and **Generate Sync Report**. The performer page button queues the same single-performer operation through Stash 0.32's `runPluginTask(plugin_id, args_map)` API.

The reset task forgets which source tags were previously synchronized to scenes, so a subsequent live sync may add those tags again. Marker sync is additive and does not delete or replace any local marker.

## Compatibility and checks

The backend uses Stash's `raw` plugin task input (`server_connection`, `args`), `SessionCookie`, `configuration.plugins(include: ...)`, and Stash 0.32 GraphQL inputs including `TagUpdateInput`, `BulkSceneUpdateInput` with `tag_ids` in `ADD` mode, `SceneMarkerCreateInput`, `GroupCreateInput`, `GroupUpdateInput`, and `SceneUpdateInput`. It has no Python package dependencies. API calls are rate-limited, retry temporary HTTP failures, and report per-source errors without exposing API keys. Scene tasks advance progress even when scenes have no markers or groups, or all markers and groups already exist.

Offline tests:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/test_ui_patch.mjs
```

The implementation was checked against the linked [Tag Manager](https://github.com/carrotwaxr/stash-plugins/tree/main/plugins/tagManager) scene-tag workflow and [TPDBMarkers](https://github.com/stashapp/CommunityScripts/tree/main/plugins/TPDBMarkers) marker endpoint behavior. The implementation uses Stash's current GraphQL mutations and a merge-only marker policy.

## License

This plugin is released under the MIT License. See [LICENSE](LICENSE) for the copyright notice and terms.
