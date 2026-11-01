# Library Doctor

Library Doctor checks scene records for common metadata and generated-file gaps. It adds an icon beside the right-side utility controls in Stash's navigation and opens a responsive dashboard.

Library Doctor has four workspaces: **Health Check**, **Metadata Assistant**, **Duplicate & Version Review**, and **Scrape & Auto-Tag**. Health Check scans for missing file references, titles, dates, performers, studios, tags, screenshots, and previews; scenes marked unorganized; and repeated titles that may deserve review.

Run a scan to see counts, filter findings, search by scene title, studio, performer, or issue, and export flagged scenes to CSV. The **Metadata Assistant** proposes missing titles and dates from scene filenames and lists scenes without tags. For missing tags, select one or more existing Stash tags in the guided fix dialog. Title and date suggestions remain editable and are never applied automatically. Each finding links to its scene in Stash. Before applying a selected title, date, or tags, Library Doctor shows a before-and-after preview and checks that text fields have not changed since the scan. **Undo last fix** restores the previous values if they have not changed since; the latest 20 fixes can be undone during the current dashboard session.

**Scrape & Auto-Tag** uses Stash’s configured scene-identify sources, in their configured order, including Stash-box providers. Installed scene scrapers that are not in that order are also listed individually. If Stash has no configured order, the workspace lists all installed scene scrapers and lets you run all or choose one. It sends batches of scenes with a missing title, date, or tags through Stash’s fingerprint lookup. A single result may fill only a blank title or date and add its tags; existing tags are merged and preserved. Multiple results are held for manual selection, and scenes without a match remain unchanged. The optional missing-tag creation control is on by default; Stash tag records created this way remain if you undo the scene update. Recent scene updates share the same 20-entry session undo history.

**Duplicate & Version Review** groups scenes with matching normalized titles, compares their studio, date, performers, duration, and file size, and labels possible copies or alternate encodes for review. Matching titles alone do not prove two scenes are duplicates. Marking a group reviewed is saved in the current browser; Library Doctor does not delete, merge, or reorganize scenes.

Install from the repository source in the root README or download [the 1.5.1 manual archive](../../packages/library-doctor/1.5.1-manual.zip) and extract the `library-doctor/` directory into Stash's configured plugins directory. Enable the plugin in **Settings → Plugins**. Reload the plugin page after updating so its versioned assets load.

The dashboard uses the Fluent accent selected in Fluent Mica when available and falls back to Fluent blue.
