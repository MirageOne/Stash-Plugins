# Library Doctor

Library Doctor checks scene records for common metadata and generated-file gaps. It adds an icon beside the right-side utility controls in Stash's navigation and opens a responsive dashboard.

The first release checks for missing file references, titles, dates, performers, studios, tags, screenshots, and previews; scenes marked unorganized; and repeated titles that may deserve review. A repeated title is only a suggestion, not a claim that the media files are duplicates.

Run a scan to see counts, filter findings, search by scene title, studio, performer, or issue, and export flagged scenes to CSV. Each row links to its scene in Stash. For missing titles and dates, **Fix fields** opens a guided editor with an exact before-and-after preview. Select the field and apply the change yourself. Before writing, the plugin checks that the field has not changed since the scan, and only updates selected fields. **Undo last fix** restores the previous blank values if they have not changed since; the latest 20 fixes can be undone during the current dashboard session. Other findings remain available to review in Stash.

Install from the repository source in the root README or download [the 1.1.0 manual archive](../../packages/library-doctor/1.1.0-manual.zip) and extract the `library-doctor/` directory into Stash's configured plugins directory. Enable the plugin in **Settings → Plugins**. Reload Stash if the navigation icon does not appear.

The dashboard uses the Fluent accent selected in Fluent Mica when available and falls back to Fluent blue.
