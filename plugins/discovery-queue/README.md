# Discovery Queue

Discovery Queue builds a scene queue from the Stash library and can rank scenes by personal taste, rating, recent additions, or a random draw. Filter by title, tag, performer, studio, minimum rating, runtime, and whether a scene has been played. Scene pages open in Stash in a separate tab, so the queue stays available.

## Learning

Learning is an explainable preference model, not an external AI service. **More like this** increases the weight of the scene's tags, performers, and studio. **Less like this** lowers those weights. **Skip** and **Finished** also teach the queue; finished and skipped scenes are hidden from the current pool and temporarily excluded from later queues. The plugin displays learned preferences on the page, and **Reset learned tastes** clears them.

The profile and queue filters are stored in `configuration.ui` for the signed-in Stash user, so they follow that account across browser profiles. Feedback changes only Discovery Queue preferences. It does not edit scene metadata, Stash ratings, or Stash play history. Scene lists and account preferences are read and written through Stash's same-origin GraphQL API. No credentials leave Stash.

## Install

Add the **MirageOne Stash Plugins** source in **Settings → Plugins → Add source** using the index URL in the [repository README](../../README.md), then install **Discovery Queue** from **Available Plugins**. For a manual installation, download the [1.0.0 manual archive](../../packages/discovery-queue/1.0.0-manual.zip) and extract its `discovery-queue/` directory into Stash's configured plugins directory. Enable it in **Settings → Plugins**, reload the plugin list, and refresh the browser.

The plugin targets Stash 0.32 or newer and requires no Python packages or external services. Its navigation shortcut appears in the Rebirth plugin flyout when Rebirth is active.

## Recommendation behavior

The first release loads at most the 1,000 most recently added matching scenes, then applies the selected filters and ranking style in the browser. A scene marked unplayed is based on Stash's `play_count`. For You combines scene rating with learned tag, performer, and studio preferences, while adding a small random component to keep ties varied. Feedback weights are bounded, and the account profile retains the latest 100 feedback events.

The **Finished** action is an explicit learning signal; it does not infer completion from a scene player session. A future build could add opt-in player-state detection if Stash exposes a reliable completion event to plugin UIs.

## Validation

`core.js` is dependency-free and includes tests for profile normalization, feedback updates, ranking, filters, and clearing learned preferences. Run them with:

```sh
node tests/core.test.js
```
