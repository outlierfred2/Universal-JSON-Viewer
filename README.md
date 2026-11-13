# Universal JSON Viewer

A browser-local viewer for unpredictable JSON. Upload, drop, or paste a document; discover its fields; choose what to show and hide; and copy a reusable field selection to the clipboard. No backend, runtime dependencies, external fonts, analytics, or data uploads.

## Run

Requires Node.js 20 or later. No dependency installation is needed.

```sh
npm start
```

Open http://127.0.0.1:8000. Use `PORT=8080 npm start` for another port.

For a portable, server-free app:

```sh
npm run build
```

Open `dist/standalone.html` directly in a browser. This is the same app with inline assets and a Blob worker. The modular `dist/index.html` build should be served over HTTP or HTTPS.

## Use

- Open a `.json` or `.jsonl` file, drop one onto the page, or paste a JSON value. The example is synthetic and includes changing types, mixed arrays, nested objects, special-character keys, nulls, zero, false, and empty containers.
- The field picker scans the entire document and combines paths across array items. Expand branches or search field paths, types, and example values.
- Use **+** to include a field and its descendants or **−** to hide a branch. Click an active button again to remove its rule; clicking the other button switches the rule. Child rules remain saved when a parent changes. An excluded ancestor takes priority over every inclusion beneath it.
- **Show all except hidden** starts with every value visible. **Show only selected fields** starts empty and retains the ancestors needed to reach included fields. Missing paths do not prevent loading.
- **Readable** renders values recursively and preserves source array indexes and order. Groups and record lists load children in batches. Strings retain line breaks; long strings can be expanded.
- **Table** combines direct child fields across all visible records. Structured cells open a recursive inspector. Missing fields use an em dash; literal null, false, zero, and empty strings remain distinct. Additional rows and columns are available through “Show more” controls.
- **Collection** chooses an array as the record list. Wildcards can gather matching arrays across nested sessions. Choose **Whole document** to return to surrounding metadata.
- Drag the divider between Fields and the viewer to resize the sidebar. Double-click it to restore the original width. The focused divider also supports arrow keys, Home/End, and Enter to reset. Width changes last for the current page session; narrow screens keep the stacked layout.
- Search applies only to visible fields and values in Readable/Table views; it retains matching ancestors. Press `/` to focus it. Field-picker search also searches source example values.
- **Original JSON** shows the unchanged input, including hidden fields. Field selections are display preferences and do not sanitize the source. **Download original JSON** also contains the complete source.

Input, original values, and the active view are held in memory for the current tab. Refreshing clears them. Named saved schemas persist in browser storage and remain available after refreshing. The schema library stores selection rules, not document values.

## Saved schemas

The **Saved schema** selector is in the Fields sidebar. Choose fields, mode, and collection, then click **Save**, enter a name, and save the schema. On a later document, selecting its name immediately restores those settings without pasting JSON. Matching field branches expand in the picker. Missing fields use the existing match report.

The selector lists local schemas alphabetically first, followed by alphabetized built-in schemas.

Changing the fields, visibility mode, or collection marks the chosen schema **(modified)**. Changes do not overwrite the saved version. **Edit** updates its rules and name, or deletes it; **Save** creates a separate named schema. Names must be unique. Deleting a schema leaves the current view intact as a custom selection. **Reset** resets the active selection and retains the schema library.

User-created schemas are saved for the current browser and site address, with no backend. They do not automatically move between devices or browsers; use the existing clipboard/file controls to transfer a selection, then save it under a name at the destination. Storage errors are shown explicitly. Keep exports for backup. The library supports 100 schemas and 2 MB of saved settings.

Shared presets can be added to `src/schema-presets.mjs` and shipped with the GitHub deployment. The registry includes **Terminal Bench PDF Metadata** with its supplied inclusion and exclusion rules. Entries have `{ id, name, selection }`; `selection` uses the exact copy/paste format below. Bundled presets appear in a separate group and remain unchanged by user edits. Users can save a customized copy.

## Add another built-in schema

**Alphabetizing is automatic.** Add new entries at the end of the list in any order. The dropdown sorts names alphabetically, ignoring capitalization, with local schemas first and built-in schemas second. You do not need to rearrange existing entries or sort the field paths.

1. Open a representative JSON document in the app, choose the fields, mode, and collection you want, then click **Copy selection**. If someone has already supplied a selection JSON, use that instead.
2. Open `src/schema-presets.mjs`.
3. Add another object inside `BUNDLED_SCHEMAS`, immediately before the final `];`. Use this pattern:

   ```js
   {
     id: 'another-schema',
     name: 'Another Schema',
     selection: {
       "version": 1,
       "mode": "selected",
       "include": ["$.example_field"],
       "exclude": [],
       "collection": null
     },
   },
   ```

4. Give it a **unique `id`** using lowercase words and hyphens, and a **unique `name`** matching the label you want in the dropdown. Replace the entire example object after `selection:` with the copied selection JSON. Keep `version`, `mode`, `include`, `exclude`, and `collection` as supplied. Keep a comma after each schema entry so another can be appended later. When editing an existing schema, keep its `id` stable.
5. Run `npm test` and `npm run build`. The tests validate every built-in schema and check the generated app.
6. Open the updated app, load a document, and choose the new name under **Built-in**. Verify the expected fields are shown. Publish the changes through the normal GitHub Pages deployment to make the schema available to everyone.

The app's **Save** button creates a local browser schema. To include a schema for every user, add it to `src/schema-presets.mjs` using the steps above. No additional dropdown or sorting code needs to change.

## Copy and paste a field selection

Choose **Copy selection** in the Fields sidebar. To reuse it, load another document, choose **Paste selection** in the same sidebar, paste into the dialog, and apply. Matching rules update immediately; the rule panel reports unmatched paths. Loading another document keeps the current selection until **Reset** is used.

The copied configuration contains paths and options, never document values:

```json
{
  "version": 1,
  "mode": "selected",
  "include": ["$.events[*].role", "$.events[*].content"],
  "exclude": ["$.events[*].content[*].debug"],
  "collection": "$.events"
}
```

`collection` is optional. The Fields sidebar also supports **Download selection** and **Import file**. If clipboard writing is unavailable, a dialog provides selectable text for manual copying. Pasting uses an ordinary textarea and does not request clipboard-read permission.

Paths support root `$`, dot keys, JSON-quoted bracket keys (`$["a.b"]`), array indexes (`$[0]`), and array wildcards (`$[*]`). They are a deliberately limited path syntax, not a full JSONPath query engine. Object keys and array indexes are typed separately; an object key `"*"` is not a wildcard. No path expressions or code are evaluated. Field-picker selections use wildcards; copied individual value paths use concrete source indexes.

Renamed or relocated fields need updated rules. A path that exists but is excluded by an ancestor is still reported as matched; the picker labels it “hidden by parent.” Empty selected collections are shown explicitly. **Reset** clears includes, excludes, and collection selection.

## Deploy with GitHub Pages

This directory is ready to become a GitHub repository. The included workflow tests, builds, and deploys on pushes to `main`.

1. Create a repository and push these source files to its `main` branch.
2. In the repository, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Run **Deploy Universal JSON Viewer** from Actions (or push another commit).
4. Open the Pages URL returned by the deployment job.

All asset and worker URLs are relative, so the app works beneath a repository subpath such as `/Universal-JSON/`. No secrets or server are required. The build creates `dist/index.html`, its relative assets, and the portable `dist/standalone.html`. Do not commit user documents.

## Validation

```sh
npm test
npm run build
```

The tests cover selection precedence, nested arrays, heterogeneous types, full-document discovery, root primitives, special keys, preservation of source indexes, non-mutating projection, missing rules, clipboard round-trips, JSONL, hidden-data search, and the real worker message protocol.

## Implementation

- `src/core.mjs`: typed paths, discovery, configuration validation, visibility projection, search, collection traversal.
- `src/worker.mjs`: background parsing/discovery and selection/search processing. Uploaded strings are never interpreted as HTML.
- `src/app.mjs`: browser interactions and lazy recursive/table renderers; all input-derived text uses DOM `textContent`.
- `src/example.mjs`: synthetic demonstration data.
- `src/schemas.mjs`: named schema persistence, validation, updates, and modified-state comparison.
- `src/schema-presets.mjs`: shared presets included in the application build.
- `scripts/build.mjs`: dependency-free modular and standalone static builds.
- `.github/workflows/pages.yml`: GitHub Pages deployment.

Limits are explicit: 25 MB UTF-8 input, 1,000,000 values, 128 nesting levels, 20,000 distinct generalized paths, 1,000 rules per include/exclude list, and 256 KB selection imports. Documents exceeding discovery limits are rejected instead of silently sampled. Parsing and projection happen off the main thread; the original text, worker document, and projected view still reside in memory. Browser JavaScript number precision applies. This version does not provide schema validation, semantic trajectory adapters, editing, PDF import, or a filtered-data export.
