# StashBox Metadata Review

StashBox Metadata Review compares local Stash records with configured StashBoxes. **Record Review** shows returned values beside the local record, lets you choose a source for each field, checks the local record again before saving, and updates only the fields you selected. **Scene Tagger** filters a scene queue, searches any or all configured StashBoxes, combines and ranks the matches, and lets you choose metadata separately from the source IDs to link. Source IDs stay attached to their own endpoint so other plugins can use the correct StashBox identity. The responsive dashboard follows the active Stash theme using the same design system as Library Doctor.

## Requirements and support

- Stash 0.32 or newer, with raw plugin UI assets enabled.
- At least one StashBox configured in **Settings → Metadata Providers**.
- The browser must be signed in to Stash to use the same-origin GraphQL API.
- No additional Python packages or external API credentials are required by this plugin. Configured StashBox credentials are used by Stash's own API and are never requested or stored by the plugin.

The Stash 0.32 GraphQL scraper supports **performers, scenes, studios, and tags** as individual record types. Scene scraping also returns matched groups, performers, tags, and studios for linking. Stash 0.32 has no individual StashBox group scraper operation, and its scraper result does not expose scene markers. Markers can be managed with the separate TPDB Markers plugin.

## Use

1. Open the **StashBox Metadata Review** shortcut in the Stash navigation. It opens inside Stash's main view and keeps the Stash navigation available. If the shortcut is not visible after installation, reload the plugin list and refresh the browser.
2. Select a record type, search your local library, and select one record.
3. Choose the configured StashBox sources to query, then select **Compare metadata**.
4. When a source returns several matches, choose the correct one from that source's match list.
5. Select a source value for each field you want to change. Fields are not selected automatically, even when the local value is blank.
6. Review the number of selected fields and choose **Apply selected fields**. If a selected local value changed after the comparison, the update is stopped and the plugin asks you to compare again.

### Scene Tagger

1. Open **Scene Tagger** and choose one, several, or all configured StashBoxes. The source list shows each endpoint; changing it clears prior results so they cannot be mistaken for results from a different source set.
2. Choose a missing-metadata filter, a recent-scene window, or both, then load the queue. **Unorganized only** starts enabled; turn it off to include organized scenes. Optional scene search and the result limit narrow the queue. Stash's missing-field filter includes title/code/details/director/date/production date, tags, performers, studio, group, URL, StashBox ID, and pHash; the recent-scene filter uses scene creation date.
3. Select scenes and choose **Find matches across sources**. Each selected StashBox is queried independently in batches of 25 scenes. **Stop after this batch** finishes the active request, then stops before the next batch. Progress counts source-scene checks.
4. Review each scene's candidates. Results are ranked with Stash 0.32 Tagger's fingerprint rules: a pHash match (Hamming distance ≤ 8), pHash match ratio, duration matches within 5 seconds, duration-match ratio, then closest duration. Exact OSHash matches are shown as supporting evidence. The candidate selector identifies both the source and fingerprint evidence; the chosen source and endpoint are displayed beside the reviewed fields.
5. Select the scalar fields and matched studio, group, performer, or tag links to apply. StashBox IDs are independently selectable per source, so metadata can come from one box while IDs from other boxes are linked for tools that require a particular source ID. Each ID is written with the endpoint that returned it. **Preselect empty fields** only sets defaults; every checkbox remains editable. Tags can be merged or replaced. Matched performers and groups are appended without removing existing links. Related records that Stash could not match remain unlinked; the plugin does not create them.
6. Choose **Apply reviewed scenes**. The plugin refreshes each scene before saving and skips a scene if its reviewed local values or relationships changed. **Mark scenes organized** sets `organized` only on scenes whose reviewed updates succeed.

Record Review updates scalar metadata and list values supported by Stash's GraphQL update inputs. Neither workflow creates or deletes related records or chooses performer images. Empty values returned by a source are not used to clear local data. Performer height and weight are converted to integers, aliases are split into Stash lists, and invalid enum or number values are omitted.

## History and privacy

The dashboard keeps the latest 30 applied changes in the current browser's local storage, with the record, source, selected fields, and resulting values. This history is local to that browser profile and is not synced to a Stash account or server. Use **Clear history** to remove it. Source credentials remain in Stash and are not returned to this dashboard; requests use Stash's authenticated `/graphql` endpoint.

## Install

Add the **MirageOne Stash Plugins** source in **Settings → Plugins → Add source** using the index URL in the [repository README](../../README.md), then install **StashBox Metadata Review** from **Available Plugins**. For a manual installation, download [the 1.2.3 manual archive](../../packages/stashbox-metadata-review/1.2.3-manual.zip), extract its `stashbox-metadata-review/` directory into Stash's configured plugin directory, enable it, and refresh Stash in the browser.

## Validation

The bundled dependency-free conversion and Tagger-matching tests can be run with Node.js:

```sh
node --test plugins/stashbox-metadata-review/tests/core.test.js
```

The tests cover Stash input conversion, safe omission of invalid values, Tagger's fingerprint ranking thresholds, recent/unorganized/missing-field filters, and updates limited to explicitly selected fields.
