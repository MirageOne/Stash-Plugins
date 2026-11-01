# Library Doctor

Library Doctor checks scene records for common metadata and generated-file gaps. It adds an icon beside the right-side utility controls in Stash's navigation and opens a responsive dashboard.

Library Doctor has three workspaces: **Health Check**, **Metadata Assistant**, and **Duplicate & Version Review**. Health Check scans for missing file references, titles, dates, performers, studios, tags, screenshots, and previews; scenes marked unorganized; and repeated titles that may deserve review.

Run a scan to see counts, filter findings, search by scene title, studio, performer, or issue, and export flagged scenes to CSV. The **Metadata Assistant** proposes missing titles and dates from the scene filename; suggestions are editable and never applied automatically. Each finding links to its scene in Stash. Before applying a selected title or date, Library Doctor shows a before-and-after preview and checks that the field has not changed since the scan. **Undo last fix** restores the previous blank values if they have not changed since; the latest 20 fixes can be undone during the current dashboard session.

**Duplicate & Version Review** groups scenes with matching normalized titles, compares their studio, date, performers, duration, and file size, and labels possible copies or alternate encodes for review. Matching titles alone do not prove two scenes are duplicates. Marking a group reviewed is saved in the current browser; Library Doctor does not delete, merge, or reorganize scenes.

Install from the repository source in the root README or download [the 1.3.0 manual archive](../../packages/library-doctor/1.3.0-manual.zip) and extract the `library-doctor/` directory into Stash's configured plugins directory. Enable the plugin in **Settings → Plugins**. Reload Stash if the navigation icon does not appear.

The dashboard uses the Fluent accent selected in Fluent Mica when available and falls back to Fluent blue.
