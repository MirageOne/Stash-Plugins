# TPDB Markers

TPDB Markers imports scene markers from ThePornDB for Stash scenes that have a ThePornDB Stash ID. It can also create Stash Groups from ThePornDB movie or group records and link those Groups to the scene while preserving existing links.

This repository version is based on [TPDBMarkers in Stash CommunityScripts](https://github.com/stashapp/CommunityScripts/tree/main/plugins/TPDBMarkers). It includes fixes informed by upstream reports [#813](https://github.com/stashapp/CommunityScripts/issues/813), [#640](https://github.com/stashapp/CommunityScripts/issues/640), [#611](https://github.com/stashapp/CommunityScripts/issues/611), [#512](https://github.com/stashapp/CommunityScripts/issues/512), [#501](https://github.com/stashapp/CommunityScripts/issues/501), [#486](https://github.com/stashapp/CommunityScripts/issues/486), [#485](https://github.com/stashapp/CommunityScripts/issues/485), [#455](https://github.com/stashapp/CommunityScripts/issues/455), and [#440](https://github.com/stashapp/CommunityScripts/issues/440).

## Requirements

- Stash 0.32 or newer.
- Python 3.9 or newer, configured for plugins in Settings → System. Current stashapp-tools releases use Python 3.9 type syntax; Python 3.8 fails while importing the Stash API library ([#640](https://github.com/stashapp/CommunityScripts/issues/640)).
- Python packages requests and stashapp-tools 0.2.58 or newer in the same Python environment Stash uses.
- A configured ThePornDB StashBox at https://theporndb.net/graphql, and scenes linked to it with a Stash ID.

The Stash plugin index does not install Python packages from requirements.txt. Install the dependencies using the Python executable configured in Stash:

    python -m pip install -r requirements.txt

Replace python with the exact configured executable path when needed, then reload plugins in Stash. The package archive includes requirements.txt for reference.

To install, add the **MirageOne Stash Plugins** source in Settings → Plugins → Add source using the index URL in the [repository README](../../README.md), then install **TPDB Markers**. For manual installation, download [the 1.0.0 archive](../../packages/tpdb-markers/1.0.0-manual.zip), extract its tpdb-markers/ directory into Stash's configured plugin directory, and enable it in Settings → Plugins.

## Use

Run **TPDB Markers → Sync** under Settings → Tasks to process eligible scenes. The task logs progress and a result for each scene in the Stash log. A failure fetching one scene does not stop the rest of the batch. Scenes that were deleted after being queued are skipped safely.

By default, markers are imported only when the scene has no existing markers. Enable **Merge markers** to add TPDB markers to scenes that already have markers, or enable **Replace existing scene markers** to remove the existing scene markers before import. Replace takes precedence if both options are enabled. Enable **Add the [TPDBMarker] tag** to create and apply the marker tag, and **Prefix imported marker titles** to add the same label to titles.

**Create and link Stash Groups** is enabled by default. TPDB may return the associated records under either movies or groups; the plugin accepts both, deduplicates matching records, looks for an existing Stash Group, and creates one when needed. It uses Stash's current urls field when creating a Group, then links it to the scene without discarding other Group associations. **Import group artwork** is off by default. If Stash cannot fetch a remote poster, the plugin retries creation without artwork so the metadata and scene link can still be saved.

When the optional tag **[TPDB: Skip Marker]** exists in Stash, scenes carrying it are excluded from manual batch syncs. Turn off **Disable automatic scene update sync** to queue a per-scene TPDB lookup when Stash updates a scene.

The ThePornDB API key is read from the matching StashBox configuration and sent only to ThePornDB. The plugin does not write the key to its logs.

## Validation and issue coverage

- Ignores a scene lookup that returns None, such as a scene deleted after its update hook was queued ([#813](https://github.com/stashapp/CommunityScripts/issues/813)).
- Handles absent or null TPDB groups and movies fields; imports either field when present ([#611](https://github.com/stashapp/CommunityScripts/issues/611), [#455](https://github.com/stashapp/CommunityScripts/issues/455), [#440](https://github.com/stashapp/CommunityScripts/issues/440)).
- Uses Stash Groups and the current urls create field, and requires a stashapp-tools version that supports find_groups ([#512](https://github.com/stashapp/CommunityScripts/issues/512), [#501](https://github.com/stashapp/CommunityScripts/issues/501)).
- Emits per-scene info and completion messages so batch progress is visible in Stash logs ([#486](https://github.com/stashapp/CommunityScripts/issues/486)).
- Documents and packages its Python dependency list, with a clear missing-dependency message ([#485](https://github.com/stashapp/CommunityScripts/issues/485)).
- Requires Python 3.9+ and reports a clear setup error under Python 3.8 ([#640](https://github.com/stashapp/CommunityScripts/issues/640)).

The plugin is distributed under the GNU Affero General Public License v3.0; see [LICENSE](LICENSE).

Run the plugin tests from the repository root:

    python -m unittest discover -s plugins/tpdb-markers/tests -v
