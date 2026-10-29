# IndoorID: finished phases

What was built, measured and decided in each finished phase, moved out of [plan.md](../plan.md)
on 2026-10-29 so the plan only holds what comes next. Legacy code: commit `cd1e955`.

## Why a rewrite (findings from the 1.x code)

- **Upload logic is the main source of bugs.** 1.x edits GeoJSON (via osmtogeojson), then a
  ~560-line heuristic (`_analyzeDiff`, `src/ctrl/VectorDataManager.js:1535-2095`) guesses which
  OSM nodes, ways and relations changed. Known failures:
  - the analysis promise can hang forever (no try/catch inside a `setTimeout`);
  - multipolygon matching crashes or maps two rings to one way (`splice(i, 0)` no-op, null
    dereferences);
  - deleting a relation member makes the upload fail part-way (HTTP 412);
  - it mutates the live edit cache with fake nodes whose ids can collide with new ones;
  - elements are sent one request at a time, so a failure leaves a half-uploaded, open
    changeset and a retry duplicates data;
  - re-downloading an area corrupts the cache (string version compare, duplicates).
- **Level bugs:** editing any tag can drop `level` (written as a number, then filtered out);
  unparseable levels are rewritten to `"0"`; decimal ranges don't round-trip;
  `building:levels=0` adds level -1; level 0 is treated as falsy (copy level fails on it);
  `repeat_on` is written for stairs and elevators instead of `level=0;1;2`.
- **Slow rendering:** SVG renderer, full layer rebuild on every state change, uncached MapCSS
  evaluation, turf buffers per render, a 1 s timer scanning the whole imagery index, floor
  plans kept as full-resolution images and only hidden with opacity.
- **Laborious floor plans:** arbitrary initial size, no control points or known-distance
  scaling, rotation only around the centre, no snapping, nothing saved across reloads.
- **Outdated tagging:** `room=*` as the primary type (`room=stairs`, `room=elevator`),
  `diaper`, `building:height`; missing `level:ref`, door and accessibility details, corridor
  lines, common indoor POIs.
- **Security:** an OAuth secret and API keys were shipped in `public/config.json` and CI. They
  are still in git history: never reuse them; register a new OAuth 2 app.
- Nearly every dependency (CRA, react-leaflet 2, leaflet-draw, Bootstrap 4, ...) is
  unmaintained, so modernising in place would have touched almost every file anyway.


## Phases

Each phase ends with lint, check, unit and e2e tests green, and a status update in this file.

### P0: Scaffold — done

- Legacy code removed (kept at `cd1e955`); SvelteKit 3, Svelte 5, Tailwind 4, bits-ui,
  MapLibre 6; Bun, Biome, Vitest, Playwright, CI; `CLAUDE.md` and project skills.
- Map with keyless OpenFreeMap basemap from `static/config.json` (no secrets).
- URL hash `#zoom/lat/lon/level`, compatible with 1.x links, keeping fractional zooms and
  decimal levels; level up/down control.
- Lesson: MapLibre 6 under Vite needs `setWorkerUrl()`; covered by an e2e test that checks a
  GeoJSON polygon actually renders.

### P1: Core data model — done

140 unit tests, all through the agreed seams (public functions; HTTP mocked at `fetch`).

- `levels/`: `parseLevels`, `formatLevels`, `isOnLevel`, `featureLevels`. Levels are ranges, so
  `0-2` covers a 0.5 mezzanine but `0;1` doesn't. Unreadable values (`G`, `1,5`) return null
  instead of becoming level 0; `building:levels=0` no longer invents level -1; IndoorOSM
  `buildingpart:verticalpassage:floorrange` is no longer read (validation will flag it).
- `osm/`: immutable entities with iD-style ids, `Graph` (server data + local edits, parent
  indexes, `newId`, `changes()`), `History` (graph snapshots), `buildOsmChange` and
  `applyDiffResult` (tiny parser, no XML dependency).
- `actions/`: `changeTags`, `addNode`, `moveNode`, `addWay`, `insertNodeInWay`,
  `deleteEntities` with iD-style cleanup. The 1.x `_analyzeDiff` scenarios that still apply are
  covered; the ones about guessing topology from coordinates disappear with the graph model.
- `api/`: `OsmApi.loadMap(bbox)` and `OsmApi.upload(graph, tags)` (one request, changeset always
  closed, typed errors).

Moved out of P1: autosave and orthogonalize / copy level / copy-paste → P5 (they need the
editing UI); merging re-downloaded data into the graph → P2 (map loader); OAuth login → P3.

### P2: Fast read-only viewer — done

228 unit tests and 17 browser tests in total; the browser tests check rendered pixels.

- Data: `map/tiles.ts` (slippy-map tiles), `api/map-loader.ts` (each zoom-16 tile downloaded
  once, at most 4 at a time, failed tiles retried on the next move, zoomed-out views skipped),
  `History.merge` (same version → skip; newer and untouched → replace; newer and edited locally
  → conflict, local edit kept).
- Features: `map/features.ts` turns the graph into GeoJSON (areas, lines, tagged points,
  multipolygons with holes). Each feature carries `@lv` (known levels it covers), so a level
  switch is a `setFilter`, never a data rebuild. `map/classify.ts` decides `@kind`, `@icon`,
  `@label`, `@restricted` in code instead of long style expressions.
- Style: `map/style/layers.ts` (fills and lines under the basemap labels, doors and labels
  above), validated with MapLibre's validator; 1.x icons bundled and rasterised on demand at
  the screen's pixel density through MapLibre 6's `setMissingStyleImageResolver`.
- UI: `EditorView` with the `Editor` state class, a level selector built from the data,
  Nominatim search on submit (`nominatim_url`), and a Background panel listing
  Editor Layer Index imagery for the view (`imagery_index_url`; TMS, `{switch:}`, `{-y}`, WMS in
  EPSG:3857; Bing, keyed and long-expired sources left out).
- Performance: no polling timers. Measured in Node on 10,000 rooms (50,000 entities): merging 9
  tiles 64 ms in total, building all features 85 ms. Each downloaded tile still rebuilds every
  feature; incremental `updateData()` comes with editing (P5). The level-switch time has not been
  measured in a real browser yet (headless tests use software WebGL).

Moved out of P2: Maki/Temaki icons → P3 (they come with the presets); door widths and
incline/conveying arrows → P5.

### P3: Presets, validation, upload — done

295 unit tests and 28 browser tests in total.

- Presets: `scripts/build-presets.ts` keeps 1,049 presets and 396 fields of
  `@openstreetmap/id-tagging-schema` 7.3 (indoor, amenity, shop, door and entrance, elevator,
  steps, corridor and other features found inside buildings) with English labels, plus
  `deprecated.json`; `presets/overlay.json` adds "Indoor Level Outline" (`indoor=level`,
  `level:ref`), a generic Door preset and door fields (`swinging`, `automatic_door`, `handle`).
  `PresetIndex` matches like iD (indexed by key, cached per tags object) and searches by name
  and terms.
- Inspector: click to select (feature-state highlight), preset name and icon, "Change type"
  picker (defaults per geometry, search), fields (text, combo with suggestions, check, select,
  textarea), raw tag text, undo/redo buttons and shortcuts, Escape to deselect. It opens in
  the side panel on the left, which the floor plan editor uses in floor plan mode.
- Validation (`validation/validate.ts`) on the selected feature and on every edited one before
  upload, with one-click fixes: outdated tags (`room=stairs|elevator`, `buildingpart=*`, and the
  schema's `deprecated.json`, e.g. `diaper` → `changing_table`); vertical features using
  `repeat_on` → `level=a;b;c`; unreadable levels (a comma explains `;`, no guessed fix); door
  not on a wall or room outline.
- Login and upload: osm-auth popup with PKCE and `/auth/callback`; upload dialog with comment,
  source, review request and `imagery_used` from the backgrounds picked; one atomic osmChange;
  each API error explained, with the edits kept. The e2e test asserts the exact osmChange.
- Icons: the presets' Maki and Temaki icons (CC0) on the map and in the inspector, falling back
  to the 1.x icons; rooms, walls, doors and other structure get none. Icon files are loaded on
  demand rather than inlined in the bundle.
- Performance: building the features of 10,000 rooms with presets takes ~290 ms the first time
  (matching every preset) and ~40 ms after, thanks to the match cache.

Moved out of P3: the spatial rules (level outside the building's levels, missing `indoor=level`
outline) and the empty key/value check → P5, with the geometry tools; translations of presets
and recent presets → P6 (i18n); number fields and semiCombo lists edited as plain text for now
(values are kept as typed, never rewritten). Upload tests mock the API with `page.route` in each
test instead of a shared `mock-osm.ts`.

### P4: Floor plans — done

324 unit tests and 39 browser tests in total.

- Georeferencing (`floorplans/georef.ts`, pure): least-squares fits in Web Mercator from control
  points (similarity from 2, affine from 3, perspective from 4), residuals and RMS in ground
  metres, image corners for MapLibre, the pixel under a map position, a starting placement,
  scaling to a measured distance, rotation about a pinned pixel, moving onto one point. Tested
  against spherical geometry at several latitudes.
- Plan files (`floorplans/plan-file.ts`, pure): IndoorID JSON export/import (images as data
  URLs), and OsmInEdit 1.x `osminedit_floor_imagery.json`. 1.x corners become an exact
  perspective transform (as 1.x drew them with CSS `matrix3d`) instead of the affine first
  planned, which would have reshaped plans that are not parallelograms.
- Import (`floorplans/import.ts`): PNG/JPEG/WebP through `createImageBitmap` (scaled down past
  8192 px); SVG rendered through an `<img>`, so its scripts never run; PDF page picker with
  thumbnails and DPI (default 150). pdf.js is lazy-loaded from its legacy build: pdf.js 6 uses
  JavaScript (`Map.getOrInsertComputed`) that current browsers lack.
- Drawing (`map/floorplan-layers.ts`): plans cut into tiles of at most 2048 px, each a MapLibre
  image source warped in perspective, above the indoor fills and below their outlines and
  labels, half-transparent by default, updated by identity (moving only sets coordinates).
  MapLibre doesn't mipmap image sources, so each plan is imported as a pyramid of halved
  images and the map draws the level matching the zoom: large plans keep their thin lines
  when shown small.
- Alignment (`state/floorplans.svelte.ts`, `ui/FloorPlansPanel.svelte`): control points (click
  the plan, then the map; snaps to OSM nodes within 8 px) with per-point residuals and the fit
  kind; measuring a known distance; rotating about a picked spot; opacity. Map clicks go to the
  active tool instead of selecting OSM features.
- Storage (`persist/plan-store.ts`, `idb`): images and settings in IndexedDB, restored on
  reload. Each plan has a level and shows only on it.
- Floor plan mode (as in 1.x): the map shows only building outlines (any area with a
  `building` tag, malls included); OSM selection, the feature editor and the edit toolbar are
  off, and the floor plans are edited in the left side panel. New plans go in the middle of
  the map beside that panel. As in photo editors, the selected plan is dragged to move it, by a corner handle to
  resize it around the opposite corner (`georef.dragCorner`: Shift stretches, Ctrl/⌘ resizes
  from the centre, Alt moves that corner alone, giving a perspective), and by the handle above
  it to turn it around its centre (`georef.dragRotation`, Shift for 15° steps). Drags are
  previewed live and saved on release (`map/plan-dragging.ts`).

Moved out of P4, to P5 with the editing tools: snapping control points to building outlines
(edges, not only nodes), numeric offset inputs, and assigning plans to a building. pdf.js standard fonts are not bundled yet: PDFs that rely on non-embedded fonts render
with fallback fonts (P6).

### P4.1: Floor plan layers, edit sessions, align fixes — done

Feedback from placing real plans (Vindhya Bhavan, 4-page A3 PDF). Decisions agreed with the
user are marked ✔; the rest follow from them.

**Align tool fixes**
- Crosshair cursor whenever an align tool is on. Today the class on the canvas container loses
  to MapLibre's `.maplibregl-canvas-container.maplibregl-interactive { cursor: grab }`, so the
  cursor is set on the canvas element itself, like plan dragging does.
- Measure: a dashed line follows the pointer from the first spot; after the second click it
  stays, solid, between the two spots until Scale or a new measure ✔.
- A Clear button removes every control point of the plan in Edit and any half-done measure or
  rotate pick; the plan stays where the points put it ✔.

**Layer list** (the sidebar list becomes the floor plan mode's layer stack)
- Top of the list is drawn on top. Rows reorder by a drag grip, or Alt+↑/↓ with the grip
  focused ✔; the map's layer order follows.
- A Buildings entry (the pink outlines) sits in the same list: it can be moved between plans
  and hidden. Its position and visibility are saved in the browser and in exported plan
  files ✔.
  New plans go above the other plans (under the outlines when those are on top). Stored
  `order` counts the outlines' place too; the outlines' record lives in IndexedDB's
  `settings` store (database version 2). Importing a plan file puts the outlines where the
  file had them among its plans.
- Each plan has its own colour, picked at random among a palette of distinct colours not yet
  used (never the buildings' pink). In floor plan mode every visible plan has a frame in its
  colour; the plan in Edit also gets its handles in it. The row shows a swatch; in Edit the
  swatch opens the palette to change it ✔. Plans saved before P4.1 get a colour on restore.
  (`floorplans/colors.ts`.)
- Clicking a row switches the map to the plan's level: a plan on every level leaves the level
  alone; with several levels (`0;1`, `0-2`) the map stays if the shown level is one of them,
  else goes to the lowest ✔. (`levels.levelToShow`; pressing Edit does the same.)
- The header button that leaves floor plan mode becomes Close ✔.

**Edit sessions**
- Plans are locked by default: they can't be dragged, aligned or changed. A row's Edit
  unlocks that plan (one at a time); name, level, opacity, colour, placement and the align
  tools all need Edit ✔. A locked row only has show/hide, Edit and delete.
- In Edit, changes are previewed but not saved; Done saves them, Cancel restores the plan as
  it was when Edit was pressed ✔. Leaving floor plan mode, or pressing another plan's Edit,
  with unsaved changes asks to save or discard. Reordering and show/hide are not part of a
  session: they save at once.
- The name is edited inline: in Edit, the row's name becomes a text field ✔ (slice 5).
- Imported plans open in Edit, saved as imported. `FloorPlans.whenSaved` asks before anything
  that would end a session with unsaved changes (Close, Escape, another plan's Edit, Import),
  through `ui/UnsavedPlanDialog.svelte`: Save, Discard or Keep editing.

**PDF import**
- The page picker takes several pages. Each becomes its own plan, `file, page N`, all in the
  same spot on the level shown ✔ (changed by the user from one level apart).

**Slices and test seams** (to agree before writing tests)
1. ✅ Align fixes. Unit: `toolFeatures` with a pointer position (dashed segment, then solid
   pair); `FloorPlans.clearPoints()`. E2E: canvas cursor is `crosshair` for each tool; the
   measure line's colour is drawn under the pointer; Clear empties the control point list and
   leaves the plan in place.
2. ✅ Colours. Unit: `floorplans/colors.ts` `pickColor(used, random)` (unused first, never pink);
   plan file round trip with `color`, and files without one. E2E: a plan's frame is drawn in
   its colour, a second plan in another.
3. ✅ Edit sessions. Unit (`FloorPlans` with a fake store): `edit`, `done`, `cancel`; nothing is
   stored before Done; Cancel restores transform, control points and settings; one plan in
   Edit at a time. E2E: a locked plan doesn't move when dragged; Edit → drag → Cancel puts it
   back; Edit → drag → Done survives a reload; Close with unsaved changes asks.
4. ✅ Layer list. Unit: `FloorPlans.move(id, index)` including the buildings entry, saved
   order; `FloorPlanLayers` order as MapLibre layer ids bottom to top (pure helper). E2E:
   two overlapping plans, reordered with the grip and with Alt+↑, show the top one's colour
   where they overlap; buildings moved under a plan are hidden by it; buildings hidden.
5. ✅ Rows. Unit: `levelToShow(planLevel, shown)` with `null`, `0`, `0;1`, `0-2`, `-1`. E2E:
   clicking a row switches the level; inline rename saved by Done, dropped by Cancel.
6. ✅ PDF pages. E2E: importing pages 1 and 2 of `plan.pdf` adds two plans, both on level 0.

### P5: Feature editor, fast core, geometry editing — P5.0 to P5.3 done

Order agreed with the user: quick performance fixes, then the iD-style feature editor, then
the fast core (needed before anything is dragged), then geometry editing. Decisions agreed
with the user are marked ✔. Each slice agrees its test seams before tests are written.

#### P5.0 Quick performance fixes — done

Measured on a synthetic area of 10,000 rooms (50,000 entities, 3.2 MB of GeoJSON).
- Downloaded tiles are merged one by one, each followed by a full feature rebuild (71–116 ms,
  up to 64 tiles): buffer tile results and merge once per animation frame
  (`api/map-loader.ts`, `state/editor.svelte.ts`).
- `Editor.editCount` is a getter that recomputes `graph.changes()` on every read: make it a
  `$derived`.
- Floor plan pyramid levels flip back and forth when zooming across a switch point (each flip
  re-uploads every tile texture): add hysteresis (±0.25 in log2) in `map/floorplan-layers.ts`.
- Cheap extras: normalise preset names and terms once (first search 184 ms, then 3 ms per
  keystroke), look up parent relations only for entities without a `level` of their own, and
  save a plan reorder in one IndexedDB transaction.

#### P5.1 Feature editor, as in iD

Slices: (1) ✅ preset data: field properties, universal fields, categories
(`generated/categories.json`); (2) ✅ layout and sections (`ui/InspectorSection.svelte`); (3) ✅ feature type
list (`ui/PresetList.svelte`, `presets/recent.ts`); (4) ✅ Fields
section (`presets/field-list.ts`, `ui/FieldsSection.svelte`); (5) ✅ combo, chip and choice fields with taginfo (`api/taginfo.ts`,
`presets/combo.ts`, `presets/choice.ts`, `ui/ComboField.svelte`, `ui/ChipsField.svelte`,
`ui/CheckField.svelte`, `ui/RadioField.svelte`); (6) ✅ text, number, date, colour,
localized, address and access fields (`presets/text.ts`, `localized.ts`, `address.ts`,
`access.ts`; `ui/TextField.svelte`, `TextareaField`, `LocalizedField`, `AddressField`,
`AccessField`); (7) ✅ Wikidata, Wikipedia and wiki references
(`api/wikidata.ts`, `api/osm-wikibase.ts`, `presets/wiki.ts`, `ui/WikidataField.svelte`,
`ui/WikipediaField.svelte`, `ui/TagReference.svelte`); (8) ✅ tag
table (`ui/TagEditor.svelte`, `osm/tag-rows.ts`, `presets/tag-table.ts`); (9) ✅ relations and
members (`actions/members.ts`, `osm/relations.ts`, `ui/RelationsSection.svelte`,
`ui/MembersSection.svelte`); (10) ✅ one undo step per field edit, text applied as it is
typed (`Editor.setTags(…, { live })`). Hover preview and
multi-selection come with P5.3.

The inspector is rebuilt to follow iD's entity editor (`modules/ui/inspector.js`,
`entity_editor.js`, `sections/*`, `fields/*`), with shadcn components.
- **Layout**: a header ("Edit feature", or "Edit features" for several; back to "Change
  feature type"; close, shown as ✓ once something changed) and collapsible sections, each
  remembering whether it is open ✔: "Features (N)" (multi-selection only), "Feature Type"
  (preset icon and name, ⓘ), "Issues (N)", "Fields", "Tags (N)" (collapsed by default, open
  for features without a matching preset ✔), "Members (N)" (relations), "Relations (N)"
  (parent relations). Footer: "View on openstreetmap.org", last edited when and by whom
  (hidden for new features) ✔.
- **Feature type list** (slides in over the editor): search ranked like iD (names and aliases
  at word starts, without accents, terms, tag values, fuzzy matches, `key=value`) ✔, up to 8
  recent presets per geometry (30 kept) ✔, IndoorID's indoor defaults (`DEFAULT_PRESETS`,
  not the schema's) ✔, categories that expand in place ✔, ⓘ beside each row ✔,
  keyboard navigation (↑↓, Enter picks the highlighted row, the first by default, → and ←
  open and close a category) ✔. Choosing a preset follows iD's `actionChangePreset` ✔:
  drop the old preset's `removeTags` and field defaults and the field keys the new one does
  not use, then add the new `addTags`, `area=yes` when needed and field defaults. Two
  indoor rules on top ✔: `level`, `level:ref` and `repeat_on` always stay, and a feature
  with a level or `indoor=*` gets no `building` default (iD's `building_area_yes` would make
  a room turned cafe a building).
- **Fields** ✔: the preset's fields, then its `moreFields` and the universal fields (by
  label) once they have a value or were added; an "Add field" combobox for the others,
  universal ones last (matching labels, terms and keys; adding sets the field's default).
  Each label row: remove (clears all the field's keys), revert (back to the downloaded
  values), ⓘ ✔, and a lock for locked fields (iD's rule: `name` when the
  feature has `wikidata` or `name:etymology:wikidata`). `prerequisiteTag` hides a field
  until its condition is met, unless it has a value. Fields for some countries only (US
  GNIS, French SIRET…) are left out of the build: IndoorID doesn't know the country. The preset build keeps the field properties this needs (option titles
  and descriptions, `universal`, `prerequisiteTag`, `snakeCase`, `caseSensitive`,
  `customValues`, `increment`, `minValue`/`maxValue`, `urlFormat`/`pattern`, `terms`,
  `reference`, `default`) and the preset categories.
- **Field types**: all of iD's except road ones ✔ (no turn-restriction editor, maxspeed or
  height units, oneway reversal or cycleway sides; those keys get plain combo/text fields):
  - combo, typeCombo, networkCombo ✔: dropdown of preset options (with titles) and taginfo
    values, snake_case and lowercase unless the field says otherwise, read-only when
    `customValues` is false (Backspace takes the value off); iD's inline completion and
    fuzzy filter; a value is only written once the user changed something;
  - multiCombo, manyCombo (chips for `key:*=yes`, with a yes/no box), semiCombo (chips for
    a `;` list, reorderable by dragging or Alt+←/→) ✔; typed values are split at `;` and
    commas before being spelled (iD snake_cases first: "Thai, pizza" gave `_pizza`);
  - check, defaultCheck (tri-state unset/yes/no; unset/yes), radio, structureRadio (with
    its type field and layer; a layer already on the right side of the ground stays) ✔;
    onewayCheck is a plain check (no reversal);
  - text, tel, email, url and identifier (with link), schedule (YoHours link), date
    (picker, "today" for survey dates), colour (swatch and picker), number and integer
    (− / + steppers, min/max, compass points for directions), textarea; values cleaned
    as iD (trimmed, NFC, 255 characters, with iD's length indicator) ✔. Numbers are shown
    as stored, without grouping (iD shows "1,500" in English); phone placeholders aren't
    by country (no country detection);
  - localized (name plus `name:<lang>` rows, languages named by the browser's
    `Intl.DisplayNames` instead of iD's language list), address (iD's default rows,
    house number + street and city + postcode, everywhere; street, place, city and
    postcode suggested from nearby loaded data, house numbers from the building the
    feature is in), access (a row per kind of traffic, implied access as placeholder) ✔;
    brand, network, operator and flag are locked with Wikidata, as iD ✔; wikidata
    (searched by the feature's name when nothing is typed, its description and
    identifier shown, its English Wikipedia article set in the same undo step) and
    wikipedia (language from iD's wmf-sitematrix list, titles suggested by Wikipedia, an
    article address can be pasted, its Wikidata item set in the same undo step) ✔. Searches
    and descriptions are in English; the dropdowns of these two fields don't complete
    inline as iD's do.
- **Tags (N)** ✔: a table of key and value inputs with a delete button and ⓘ, an
  always-present empty "Add new tag" row, key/value autocomplete from taginfo (keys not set,
  not discardable, not numbered), Enter/`=` moving between cells, a duplicate key jumping to
  the existing row, rows kept in place while editing, and a List/Text toggle remembered per
  browser; the text quotes as iD's. Differences: a key typed in the new row waits for its
  value (the editor keeps no tag without a value, where iD adds `key=` at once), an emptied
  value removes the tag, and the text view is sorted by key (iD's follows the list). Mixed
  values in a multi-selection show "Multiple values" (with P5.3).
- **Relations and members** ✔: "Relations (N)" lists a row per membership (sorted by type and
  name, those just added last) with its role (taginfo's roles for the relation type and the
  member's geometry), select, zoom-to, remove and, for incomplete relations, download
  (`/relation/{id}/full`); "Add to a relation" offers a new relation (selected, its type
  list open) or one typed by id or in view (connected ones first, then the newest). A
  relation's "Members (N)" lists its members with roles, select (zooming when out of view),
  zoom-to, remove (an emptied relation is deleted), download for incomplete members, and
  reorder by dragging or Alt+↑/↓ (an addition to iD). Differences: members are added at
  the end (iD orders ways along routes), the download loads the whole relation, and rows
  don't highlight on the map until hover comes with P5.3.
- **Multi-selection** ✔ (with P5.3's multi-select): "Features (N)" list, the fields the
  selected presets share, "Multiple values", edits applied to each feature in one undo step.
- **Hover preview** ✔: hovering a feature shows its editor read-only.
- **Services** ✔: taginfo (suggestions, debounced 300 ms and cached), Wikidata and Wikipedia
  (their fields), and the OSM wiki's Wikibase for ⓘ tag references (description, image,
  link) ✔; ⓘ on fields, the Feature Type and the type list ✔ (the tag table's come with
  slice 8). Their URLs go in `config.json`; e2e tests serve them from fixtures.
- **Undo** ✔: one history step per field edit, as in iD's entity editor: text, textarea, the
  localized name and address parts are applied as they are typed (kept as typed, an emptied
  field waiting until it is left), folded into one step that leaving the field (change or
  blur) cleans and closes; a change of another feature, any other edit, undo, redo or a new
  selection starts a new step, and tags left as they were make none. Combos, chips and the
  other fields apply once chosen, translation rows when left (as iD). Each keystroke is
  applied at once since P5.2 (a 150 ms pause before); a combo applying as it is typed (address
  parts) completes again once the value applied is drawn back into its input.

#### P5.2 Fast core (before anything is dragged) — done

Slices agreed with the user ✔: (1) ✅ `bun run bench` (`scripts/bench-core.ts`, 10,000 synthetic
rooms; targets: a tag edit to the map under 16 ms, deleting 1,000 rooms under 150 ms, a snap
under 1 ms, the full build no slower); (2) ✅ incremental map updates (`map/feature-store.ts`,
`Graph.changedSince`; a new level set redraws everything, as agreed); (3) ✅ batched graph
edits (`Graph.update`, used by `History`); (4) ✅ rbush index of the drawn features' nodes (`StoredFeatures.nodesNear`, filtered by
level, brought up to date on the first query after changes), floor plan snapping to nodes
on the shown level only ✔;
(5) ✅ live typing without the pause. The drag overlay source waits for P5.3. Measured under
Bun: a tag edit 46 → 3–5 ms; deleting 1,000 rooms 1,296 → 9–13 ms (the local parent index was
also copied on every lookup); a snap 2.5–4 ms → under 0.1 ms; the first build and a download
into an empty editor stay at the full build's 45–60 ms (big downloads are rebuilt whole).

- **Incremental map updates** ✅ (and the 150 ms pause of live typing dropped ✅): every
  edit rebuilds all features and re-sends them to the map
  (about 120 ms per edit on 10,000 rooms, so dragging would run at ~8 fps). Cache each
  feature by entity identity, work out the changed ids (plus ways and relations using
  changed nodes) and send only those with `updateData`. Make `@lv` independent of the levels
  in the whole dataset (or fall back to `setData` when they change), and draw drags on a
  small overlay source, committed on release.
- **Batched graph edits** ✅: `replace`/`remove` copy all local edits and parent indexes are
  rebuilt per graph, so changing many entities is quadratic (deleting 1,000 rooms: 1.6 s).
  Add a batch API with a mutable draft frozen at the end.
- **Spatial index** ✅: snapping walks every node in the graph; use `rbush` per level for
  snapping (hit-testing stays with MapLibre's `queryRenderedFeatures` until drawing needs
  more in P5.3).
- Then switch the feature editor to live typing ✅ (each keystroke, as iD).

#### P5.3 Geometry editing

Replanned after the review below: see R1, P4.2, P5.3 and P5.4 in the roadmap.

## Review before geometry editing (October 2026)

A read-through of the whole codebase (about 23,000 lines, 571 unit and 115 e2e tests) against
what comes next: geometry editing, vector floor plans, light raster plans, autosave, conflicts
and translations. Most of the code is in good shape; what blocks or slows the next phases is
listed here, with the file and the fix. Effort: S small, M medium, L large.

**Bugs found on the way**

- Duplicate issue ids: `validate.ts` builds `${rule}:${entity.id}`, and `levelIssues` can raise
  `unreadable-level` for both `level` and `repeat_on`; `level=G` with `repeat_on=G` gives two
  issues with one id, a duplicate key in the Inspector's and the Save dialog's keyed lists (S).
- Map readiness race: `indoor-map.ts`, `floorplan-layers.ts` and `PlanToolLayer` install with
  `map.isStyleLoaded() ? install() : map.once("load", install)`. In MapLibre 6
  `isStyleLoaded()` is false while any tile or image loads, and `load` fires only once, so a
  layer owner created later (mid-pan) never installs. It works today only because all owners
  exist before the first load; every P5.3 overlay and the vector plan layer would hit it (S).
- `plan-store.ts` `load()` drops plans without an image blob: a plan without a raster would
  vanish on reload (S, with the schema change below).
- `graph.newId()` doesn't reserve the id: two calls before a `replace` return the same one;
  drawing an area or pasting needs several (S).
- `History.perform` adds a step even when an action changed nothing (S).
- Deleting a relation leaves its untagged member ways behind, invisible but uploaded (iD
  deletes members left untagged and in no other relation) (S).
- Conflicts can't be resolved: `History.merge` drops the server's newer version of an entity
  edited locally, `MapLoader` never downloads a tile twice, and every 409 is a "conflict" (a
  closed changeset is one too); the Save dialog's advice, "reload the area, then upload again",
  leads nowhere (L, phase C).

**Map and view: what blocks geometry editing**

- No mode or event owner: the mode is two flags (`planMode`, `floorplans.tool`) read in about
  eight places of `EditorView.svelte` (606 lines); three separate click listeners
  (`IndoorMap.onClick`, the alignment tool, `PlanDragging`) each decide whether they apply; one
  window keydown handler guesses "typing" from `closest("input, textarea, select")`; the
  cursor is written from three places. Every new mode would add a flag to every listener (M–L).
- Layer order is set in four places, by other modules' layer ids (`ABOVE_LABELS`,
  `"indoor-outline"`, `"indoor-fill"`, `FLOORPLAN_PREFIX`) and by install order; plans end up
  under `indoor-fill` if the effects run in another order (M).
- Vertices, midpoints and untagged member ways aren't drawn (`features.ts`: no feature without
  interesting tags), so nothing can be hit to drag or split (M).
- Selection is one id (`selectedId`, `{#key editor.selected.id}`, `setSelected(id)`); there is no
  hover state (M).
- `PlanDragging` uses mouse events on the map: no pointer capture, no threshold (a click
  commits a placement), no Escape, no frame coalescing; node dragging can't reuse it (M).
- MapLibre's double-click zoom, box zoom (Shift+drag) and right-drag rotation clash with
  finishing a line, lasso selection and an operations menu (S).
- `snap()` and the shown `level` live in `EditorView`; drawing needs both, and snapping to a
  segment, not only a node (S).

**Data model and state**

- `Editor` (362 lines) is becoming a god object: history and typing, loading, map features,
  presets and upgrades, recent presets, five web services, validation, upload, selection,
  relation commands. Geometry editing would add modes, hover, multi-selection, the clipboard,
  autosave and conflicts (M).
- One entity everywhere: `setTags(id, tags)` replaces the whole tag set, fields send whole
  tags, `#typing` is one id. Multi-selection needs `setTags(ids, patch)` and a "mixed" state in
  every field type (only `text.ts` knows it) (M).
- History can't be saved: `Graph` and `History` keep their data in private fields with no
  export; steps don't record the selection (iD does, for undo to reselect) (M).
- Undo labels, issue messages, fix labels and floor plan errors are English strings built in
  pure modules (`validate.ts`, `georef.ts`, `editor.svelte.ts`): translation and autosave both
  want `{key, params}` instead (S now, M later).
- Geometry helpers are duplicated and disagree: three "closed way" tests (`area.ts`,
  `address.ts` need more than 3 nodes, `delete.ts` more than 2), point-in-polygon twice,
  extents in `relations.ts` and `address.ts`, `joinRings` private to `map/features.ts`,
  distances in `georef.ts` and `address.ts` (S–M).
- Validation sees only created and modified entities: a door left behind by a deleted wall is
  never reported; `editIssues` is a getter re-run on every read; spatial rules need an area
  index (M).
- Every new graph copies all local edits and rebuilds its local parent index: fine at hundreds
  of edits, to be measured at 10,000 before dragging goes through history (benchmark first).

**Floor plans: what blocks vector and light raster plans**

- `PlanImage` mixes the plan's size with raster data (`width/height` used in about 9 places,
  `levels` in 3, `blob` in 4); nothing else can describe a plan (M).
- Plan coordinates are rendered pixels, so they depend on the import DPI and the 8,192 px cap;
  vector paths come in PDF points. Plan units should be PDF points (SVG user units), fixed
  before anything is stored in a new format (S).
- The IndexedDB store has no real migrations (`upgrade` ignores `oldVersion`), reads every
  image blob at load, and keeps a PNG rendering instead of the original file (M).
- Every reload decodes every plan in full and rebuilds its pyramid before showing any
  (1.6 s + 1.6 s per 8,192 px plan, about 250 MB each) (M).
- The map layer adds every tile of a pyramid level as an image source, on screen or not, and
  only reacts to zoom (M).
- The plan's transform maps to absolute Web Mercator metres (about 10⁷): fine as a 3 × 3
  matrix, but it must be multiplied with the camera on the CPU in float64 before reaching a
  shader, or lines jitter by centimetres (S).
- Import, export and the PDF page loop live in `FloorPlansPanel.svelte` (854 lines), on the
  main thread, untested (`import.ts` has no unit tests) (M).
- The plan file format requires an embedded raster (`imageOf` throws without one) and never
  checks its version (M).

**UI, tests and CI**

- Three combobox implementations: `ComboField` (384 lines, four mode flags, callers fake a
  preset `Field` to use it), `SearchCombo` (same popover, debounce and highlight code) and
  shadcn `Command` lists. "Multiple values" and keyboard work would be done twice (M).
- Services are wired by hand about eight times
  (`editor.taginfo ? (q) => editor.taginfo?.x(...) ?? Promise.resolve([]) : undefined`), and
  `editor` is passed into five components (S).
- No read-only mode outside the fields, for the hover preview (S).
- About 300 user-facing English strings (230 in components, 70 in modules), hand-made plurals,
  `"en"` hard-coded in `time-ago.ts` and `localized.ts`, "Ctrl+Z" tooltips (no ⌘ on Mac) (M).
- CI only runs on pushes to `master` and on pull requests, so this branch has never run in
  CI; no Bun or Playwright cache; `retries: 1` hides flaky tests (S).
- E2E: no `fullyParallel`, 4.3 minutes for 115 tests on one worker here; the
  click-until-the-inspector-opens loop is copied three times; two unexplained one-off failures
  in P5.2's full runs; no component tests, so all UI logic waits for the e2e run (S–M).
- Leftovers: `editor_name` in `config.json` is never read, `loadConfig` doesn't validate,
  two shadcn components (`card`, `native-select`) are unused (S).

**Keep as they are:** immutable entities and graphs with `Graph.update`; `changedSince` by
identity and the incremental `FeatureStore`; osmChange ordering and `if-unused`; levels as
ranges, never rewritten; `georef.ts` (one 3 × 3 matrix for similarity, affine and projective,
ready for a shader); `tiling.ts` with hysteresis; plan edit sessions (preview, then commit on
release, the pattern node dragging needs); field inputs taking `tags` and emitting patches;
ARIA combobox and listbox patterns; the network-blocking e2e fixture and pixel checks; lazy
pdf.js and presets (the bundle is fine: 421 KB gzipped plus MapLibre's worker).

## Research and audit (October 2026, after P4.2)

A look at the OSM wiki's indoor pages and at the other indoor editors and viewers, then a
second audit of the code (lint, check, 838 unit and 123 e2e tests run; one e2e test flaky, see
R3.8). The full write-up, with sources, is the "Indoor editors research and the IndoorID path"
doc. Conclusion: **no rewrite or broad refactor**. The core (immutable graph, history,
incremental feature store, range-aware `@lv` filters, atomic upload) matches or beats every
tool studied; what the goals still need is added on top (W, L, V, 3D below) plus the fixes in
R3. The one refactor is small: the level switcher and the map style must serve more than one
presentation (edit, view, 3D).

**Other tools, and what to take from each**

| Tool                                                                                                             | How it works                                                                                                                                                                                                                                                                                                                                                                                                        | Take                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [iD](https://github.com/openstreetmap/iD) (ISC)                                                                  | Same core as ours; SVG renderer                                                                                                                                                                                                                                                                                                                                                                                     | `operations/*` (`available`, `disabled` reason, `tooltip`, `keys`, annotation) for P5.3.5; composable `behavior/*` (hover, select, drag, draw, lasso, paste); `core/tree.ts` (entity and segment rbush updated from each difference) for snapping and "which building"; validator with base and head caches (only issues the user caused), run in `requestIdleCallback` chunks; `crossing_ways`, `unsquare_way`, `close_nodes`, `almost_junction`, `disconnected_way`, `missing_tag`; `history.toJSON` + `utilSessionMutex` and `actions/merge_remote_changes` for P5.4; `renderer/features` filters and auto-hide for P6. Its `crossing_ways` compares `level` as strings: use `isOnLevel` when porting. Keep the ISC notice.                          |
| [OpenIndoorMaps](https://github.com/openindoormaps/openindoormaps) (Apache-2.0, pre-alpha viewer)                | IMDF-like GeoJSON; rooms `fill-extrusion` 2.5 m (`#f3f3f3` / dark `#1f2937`), corridors 0.2 m (`#d6d5d1` / `#030712`), outlines `#a6a5a2` 2 px, one level, pitch 40°, OpenFreeMap basemap; search panel (MiniSearch), Dijkstra routing over corridor lines                                                                                                                                                          | The 3D look (3D.1), light and dark colour sets, the discovery panel for V. Not its `setData` per level switch or its O(n²) Dijkstra.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [OpenIndoor](https://github.com/open-indoor/openindoor6) (AGPL, dormant since 2022)                              | Building → stacked floors (base 5 m × level, 4.5 m tall, coloured by `level mod 4`) → one level with walls: room outlines and `indoor=wall` buffered 0.1 m each side, extruded 2 m, door gaps cut by `width` / 2 (default 0.9 m); Overpass per building; depended on its own tile server                                                                                                                            | The three-step view and walls with door gaps (3D.2), ideas only (licence, dead backend).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [indoor=](https://github.com/indoorequal) (AGPL tiles, BSD plugin, active)                                       | Planet import → PostGIS → MVT; `expand_levels(level, repeat_on)` in SQL; 2D, heatmap at low zoom                                                                                                                                                                                                                                                                                                                    | Heatmap or count bubbles to find indoor data when zoomed out (V). Not the server stack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [MapGL Indoor](https://github.com/mapbox-gl-indoor/mapbox-gl-indoor) (MIT)                                       | GeoJSON per building, level filter                                                                                                                                                                                                                                                                                                                                                                                  | Show the level switcher only when a building with indoor data is in view (L).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OpenLevelUp, JOSM indoorhelper, MapComplete indoors                                                              | Overpass + Leaflet; JOSM AutoFilter level bar; POI questions                                                                                                                                                                                                                                                                                                                                                        | Room list by level (V); "missing level" validator and wall kinds (W).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [osm-simple3d-editor](https://github.com/FelisPimeja/osm-simple3d-editor) (ISC, started 2026-10-06, very active) | Simple 3D Buildings editor; one three.js custom layer in MapLibre (one merged mesh per z14 tile, own raycast picking); indoor plans in 3D: walls with door openings, escalators, lift shafts, atriums, a cut above the shown level; since 2026-10-26 also floor plan editing (split, merge, clear, a point tool, repeat on levels) and floor plan underlays in 3D; z14 tiles from the OSM API `/map` (Overpass off) | Level heights from `indoor=level` and which levels get a floor (3D.3); atrium inference (3D.3); indoor checks (W); `level:ref` survey (L); its floor plan editing model and upload pitfalls (P5.3); stairs and `repeat_on` research; dropping stale Overpass answers after an upload (V); rebase on upload and per-tab autosave (P5.4); JOSM Remote Control `/export` as a read-only source (P6); a "view in 3D" link to it (V). Not its 13,000-line `main.ts`, its edit overlay without a graph, notches written into wall polygons, or per-frame HTML icons. Keep the ISC notice. It now cites our floor plan code as its reference and waits on our licence (see Open questions). Write-up: "osm-simple3d-editor" research doc (revised 2026-10-28). |

**Wiki rules not followed yet** (the rest, ranges, lists, decimals, `repeat_on`, never
rewriting `level`, already is): `level:ref` and `name` of `indoor=level` outlines are not shown
in the switcher; `non_existent_levels` is ignored; one-based numbering (KR, KZ, MN) gets no
hint; the elevator upgrade writes `elevator=yes`, SIT says `highway=elevator` + `indoor=room`;
`indoor=highway` and `indoor=stairs` (mistakes for `indoor=yes`) have no upgrade; doors on an
`indoor=wall` area (SIT: ways only) are not flagged; indoor features without `level` are not
flagged; walls and rooms not sharing nodes are not checked (P5.3.9).

**Bugs found** (fixes in R3; verified by a script or a probe test unless marked plausible)

- Upload (`state/data-sync.svelte.ts:81-86`): tiles that arrive during an upload are merged,
  then dropped by `history.reset(result.graph)`, and `MapLoader` never downloads them again;
  edits made meanwhile (Mod+Z works with focus on a dialog button) are dropped too. A tile
  requested before the upload and arriving after it brings deleted features back
  (`History.merge` treats them as new), and editing one makes the next upload send a modify
  for a deleted way (409/410, plausible).
- The 10,000-change changeset limit is not checked: no warning, raw HTTP text on failure.
- Save dialog (`ui/SaveDialog.svelte`, `state/session.svelte.ts:231-245`): closing the OSM login
  popup leaves `session.login()` pending forever (osm-auth has no closed-popup check); the
  dialog stays in `uploading` with Cancel disabled, so a reload, losing all edits, is the only
  way out. Abandoned login listeners later reject with "Invalid state".
- Keys (`ui/EditorView.svelte:462-471`): `onKeydown` ignores `defaultPrevented`, so the Escape
  that closes a popover or dialog also clears the selection or leaves plan mode (P5.3: cancels
  a drawing); Mod+Z undoes behind the open Save dialog.
- Floor plan import, untrusted files: `plan-file.ts:124` `unzipSync` inflates every entry with
  no limit (a 409 KB zip took 400 MB); `vector-svg.ts` limits `<use>` depth but not fan-out
  (1.7 KB SVG → 1,000,000 segments, 7 s on the main thread; depth 8 allowed); `pyramid.ts:31`
  decodes a raster at full size before the 8,192 px cap (plausible: 40,000² PNG ≈ 6.4 GB);
  `codec.ts` keeps a dead worker after `onerror` (plausible).
- IndexedDB (`persist/plan-store.ts:157-180`): no `blocked`/`blocking`/`terminated` handlers;
  an old tab holding v3 makes v4's `load()` hang (plans never restore, no error), and P5.4's v5
  would hang the same way; `#db ??=` caches a rejected open.
- Pointer input (`edit/mode-manager.ts:40-46`): mouse events only; on touch and pen, presses
  never reach the mode (a finger drag on a plan pans the map). Blocks P5.3's drags.
- Map display: a bare `type=multipolygon` relation (tags on the outer way) is drawn again as a
  grey `area` on every level (`map/features.ts:166-179`, `type` counts as interesting); doors
  without `level` show on every level even when their wall has one (nodes don't inherit their
  ways' levels); `building:levels=25` on any nearby building fills the switcher with 0…24
  (`feature-levels.ts:29-31`, `knownLevels`); POIs without an icon or a name are not drawn and
  can't be selected (`style/layers.ts:206-236`); the hash rounds the level to 2 decimals
  (`hash.ts:69`); if the basemap style fails, `load` never fires and indoor layers never
  install (`map/ready.ts:14-16`, plausible).
- Validation: `vertical-repeat-on` fires on door nodes (`door=sliding elevator=yes
  repeat_on=1;2`) and its fix folds `repeat_on` into `level`, which SIT allows for stair and
  elevator doors.
- Smaller: the drag release drops the last frame's move (`floorplan.ts:219` ignores `at`);
  logout doesn't revoke the token (`/oauth2/revoke`); `if-unused` deletions the server kept
  (`notDeleted`) are never shown; a zoom-16 tile over 50,000 nodes fails on every move with no
  backoff; `amend` is a no-op after a tile merge (the Wikipedia tag after a Wikidata pick is
  lost); `changePreset` drops `min_level`/`max_level`; `package.json` engines say Node 24 while
  cloud sessions run 22 (works).
- Still open from the review above: conflicts can't be resolved, history can't be saved, a
  lost upload response makes a retry duplicate data (all P5.4); no `beforeunload` guard (R3.1).


## Roadmap phases R0 to P5.3

Order: fix what's broken and make tests fast (R0), lay the foundations that editing and plans
share (R1), move floor plans to a content model (R2), then the features: vector and light
raster plans (P4.2), geometry editing (P5.3), autosave and conflicts (P5.4), parity (P6).
Vector plans come before editing so that drawing can snap to plan walls from the start. Each
slice still agrees its test seams first.

After the October research and audit: the audit's fixes (R3) first, then the licence file
(done: ISC, see Open questions; osm-simple3d-editor was waiting on it), then wiki conformance (W)
and level names (L), which are small and can run beside geometry editing (P5.3); then the
viewer (V) and 3D floors (3D), after P5.3 (decided ✔); then autosave and conflicts (P5.4) and
parity (P6).

### R0: Fixes and fast feedback — S — done

1. The six bugs above that are small: duplicate issue ids, readiness race (`whenStyleReady`
   plus an `AbortSignal` per layer owner), `newIds(type, n)`, no empty undo steps, relation
   delete cleanup, the store keeping image-less plans (behind R2's schema).
2. CI (still on `master` and pull requests only ✔): Bun and Playwright caches, `concurrency:
   cancel-in-progress`, a sharded e2e job, and flaky tests reported instead of hidden.
3. E2E: `fullyParallel`; a map readiness signal (`data-idle` once the source has data) so a
   test clicks once instead of looping; `clickMap()`, `lngLatAt()` and an `inspector(page)`
   page object in `fixtures.ts`; `locale: "en-US"` pinned.
4. Leftovers: `editor_name`, unused shadcn components, config validation with defaults.

Done ✅: R0.1 (`map/ready.ts` `styleReady`, issue ids with a key, `newId` reserving, no empty
steps, relation delete cleanup; the store keeping image-less plans moves to R2's schema),
R0.2 (`data-drawn` and `mapDrawn()`, `clickMap()`, `lngLatAt()`, `inspector(page)`,
`fullyParallel`, `en-US`; locally still about 4.8 minutes on two workers, CPU-bound by
software WebGL, and four workers time out PDF imports), R0.3 (CI caches, cancel in progress,
two e2e shards; flaky tests show in the GitHub reporter's summary; not run yet, since CI only
runs on `master` and pull requests), R0.4 (`config-schema.ts` `parseConfig` with defaults and
clear errors, `editor_name` and two unused shadcn components removed).

### R1: Foundations for editing — M–L

1. **Layer slots** (`map/layer-slots.ts`): invisible anchor layers (imagery, plans, indoor,
   edit overlay, tools) installed once; every owner inserts before a slot.
2. **Modes** (`edit/modes/*`, `edit/mode-manager.ts`): one owner of the map's pointer and
   key events hands them to the current mode (`enter`, `exit`, pointer, click, key, cursor,
   which MapLibre handlers stay on). Today's floor plan mode and alignment tools become the
   first two modes; browse and select follow. `EditorView` keeps only the current mode.
3. **Keys** (`edit/keys.ts`): a pure keymap per mode (`{keys, label, when, run}`), active only
   while the map or page has focus; the P6 shortcuts help lists it. ⌘ on Mac.
4. **Drag behaviour** (`edit/drag.ts`): pointer events with capture, a 3 px threshold, one
   update per frame, Escape cancels, the click after a drag swallowed. `PlanDragging` moves
   onto it.
5. **Selection** (`state/selection.svelte.ts`): `ids` and `hover`, feature-state for both;
   `{#key}` on the selection, not one id.
6. **Split `Editor`**: history (graph, perform, typing, later autosave), selection, data sync
   (loader, merge, upload, later conflicts), catalog (presets, upgrades, services as one
   object provided by context), validator (affected set: changed entities plus parents,
   children and nodes left by deleted ways; issues cached per entity). Commands become plain
   functions.
7. **Messages as keys**: undo labels, issues, fixes and floor plan errors become
   `{key, params}`, rendered in English for now (P6 translates them).
8. **`osm/geometry.ts`**: one closed-way test, rings, point in polygon, extents, Web Mercator
   projection, midpoints, distance to a segment; `graph.childNodes(way)`. Callers move to it.
9. **One combobox** (`ui/Combobox.svelte`, headless: input, listbox, highlight, debounce,
   `suggest(query)`, a mixed state); `ComboField`, `SearchCombo`, the tag table and roles
   become thin wrappers.
10. **Many features in the Inspector's data model**: `setTags(ids, patch, {live})` in one undo
    step; fields send patches only; `values(key)` per field with a mixed state in every field
    type; a `readonly` prop through the Inspector for the hover preview.
11. **Component tests**: Vitest browser mode (Playwright's Chromium) for the combobox, the tag
    table and mixed values, so the Inspector work doesn't wait on the e2e run.
12. **Measure history at scale**: a bench of 10,000 local edits; structural sharing in `Graph`
    only if an edit there costs more than a frame.

Done ✅: R1.1 (`map/layer-slots.ts`: imagery, indoor-fill, plans, indoor-lines below the
basemap's labels; indoor-top, edit, tools above; background, indoor and plan layers insert
before their slot). R1.2–R1.4: `edit/mode-manager.ts` owns the map's mouse events and hands
them to one `Mode` (`edit/mode.ts`: hover → cursor, click, press → `Drag`, leave, key, which
MapLibre gestures stay on); the drag lives there instead of a separate `edit/drag.ts` (3 px,
one move per frame, release off the map through `window`, the click after it swallowed, Escape
cancels); modes `browse`, `floorplan` (move and corner handles, on `edit/plan-drag.ts`) and
`floorplan-tool`; `edit/keys.ts` (`matches`, `formatCombo` with ⌘ on Mac, `isTyping`);
`IndoorMap.hitTest` replaces its click handler. Also fixed: the hover cursor is dropped when
the pointer leaves the map, and bits-ui popovers that reopen while closing no longer open under
the side panel (`[data-bits-floating-content-wrapper]` gets `z-50` in `app.css`; the
relations test flaked on it).
R1.5: `state/selection.svelte.ts` (`Selection`: `ids`, `single`, `hover`, `select`, `toggle`,
`remap` after an upload) in the Editor, whose `selected` is the one feature when a single one is
selected; `IndoorMap.setSelected(ids)` and `setHover(id)` set feature-state, the hovered
feature outlined at 45% of the selection colour; browse mode hovers from its hit test and
clears it on leaving the map; the Inspector is keyed on the selection.
R1.6: the `Editor` is now the composition root of `EditHistory` (graph, steps, typing
coalescing, amend, merge, reset), `Selection`, `DataSync` (load status, view and relation
downloads, upload), `Catalog` (presets, upgrades, discarded keys, recent presets, the web
services) and `validation/validator.ts` (`Validator`: issues cached per entity, checked again
for the entities an edit affected: the changed ones, ways' nodes before and after, parents and
members). Components get it with `getEditor()` (Svelte `createContext`) instead of an `editor`
prop; edits from the UI are plain functions in `state/commands.ts`. `MapLoader` keeps its
defaults for options passed as undefined.
R1.7: `i18n/messages.ts` (`Message` = `{key, params}`, `msg()` with each key's `{param}`
names checked by TypeScript, `t()` rendering English, `MessageError`); the English text is in
`messages/en.json` (inlang's format, for Paraglide in P6), compiled on install by
`scripts/build-messages.ts` into the gitignored `i18n/generated/en.ts`. Issues and their fixes,
undo labels (`History<A>` takes its annotation type), floor plan tool hints, storage errors and
import or plan file errors carry messages; the UI renders them with `t()`.
R1.8: `osm/geometry.ts` holds the geometry: `isClosed` (first node = last) and `isClosedRing`
(and 4+ nodes, a polygon), `wayLocs`, `pointInRing`/`pointInPolygon`, `Extent`, `extentOf`,
`extentsIntersect`, `EARTH_RADIUS`, `toMercator`/`fromMercator`, `midpoint` (in Web
Mercator, as drawn), `distanceToSegment`/`distanceToLine` (metres); `graph.childNodes(way)`
gives the nodes downloaded. The copies in `map/geometry.ts` (removed), `area.ts`, `delete.ts`,
`address.ts`, `relations.ts`, `imagery.ts`, `georef.ts` and `floorplan-layers.ts` use it, with
no change in behaviour. Slippy-tile maths stays in `map/tiles.ts`.
R1.9: `ui/combobox.svelte.ts` (`Combobox`: open, highlight, `move`, `escape`, its search at
once for nothing typed and after 300 ms while typing, older answers dropped) and
`ui/ComboList.svelte` (the one popover listbox) under `ComboField` and `SearchCombo`, which the
tag table, roles, chips, address and wiki fields use; `ComboField` takes `mixed` ("Multiple
values", nothing changed until something is typed or chosen) for R1.10. Its look is checked by
R1.11's component tests.
R1.11 (before R1.10, so mixed values are tested component by component): Vitest runs two
projects, `unit` (Node) and `component` (`*.component.test.ts`, rendered with
`vitest-browser-svelte` in Playwright's Chromium, `@vitest/browser-playwright`); first tests for
`ComboField` (keys, filtering, mixed), `SearchCombo` and `TagEditor`; CI's check job installs
Chromium for them (triggers unchanged).
R1.10: `presets/multi.ts` (`combineTags`: shared values and each feature's value of mixed
keys; `chipsOver`, `withoutChip`, `tagDiff`), `history.patchTags(ids, patch | (tags, id) =>
patch, {live})` (one undo step over every feature, typing folded as `setTags`, which stays for
the tag text view); `FieldsSection` takes `entities` and changes them all, and every field type
has a mixed state ("Multiple values"; a check shows – and a click sets yes; list chips only some
features have are dashed, and are added and removed per feature's own list, lists that differ
can't be reordered); `readonly` through `Inspector` and `FieldsSection` (a disabled fieldset,
no action buttons) for P5.3's hover preview. Component tests: `FieldInput` per field type,
`FieldsSection` (one step over two features, read-only), with `ui/testing/render.ts`
(`renderWithEditor`).
R1.12: `bun run bench` now edits every room of the 10,000, each its own undo step. Before:
26 s for the 10,000 edits, 3.7 GB held (every step copied all local edits) and 143 ms for one
more edit (garbage collection). `Graph`'s local edits are now a persistent map (Immutable.js
`Map`, chosen ✔): steps share all but what they set. Each graph made by an edit knows its parent
and the ids it set, so `changedSince` between nearby steps (64) reads only those, either way
(undo); `changeCount()` counts from the parent's count (the edit count); local parent indexes
are shared down the chain (links only added, lookups check them). After: 0.33 s, 41 MB,
6.8 ms for one more edit (< 16 ms); deleting 1,000 rooms one by one went from 600 to 23 ms.

**R1 done** ✅ (R1.11 ran before R1.10).

### R2: Floor plan content model — M

1. `PlanContent = { size in plan units, raster?, vector?, thumbnail }`; plan units are PDF
   points (SVG user units, image pixels for photos and scans); bitmaps leave the reactive
   `FloorPlan` for a content cache.
2. IndexedDB schema 3 with migrations from 1 and 2: plan metadata, pre-cut tiles
   (`[plan, level, x, y]` → WebP), vector geometry, the original file, thumbnails. Restore loads
   metadata only; content loads when shown.
3. `floorplans/plan-io.ts`: import and export out of the panel, tested; heavy work (tile
   cutting, WebP encoding, path flattening) in one module worker; pdf.js keeps parsing in its
   own worker.
4. Plan file format 2 (raster, vector or original file; size required; version checked); the
   v1 and 1.x readers stay.
5. The panel split into a plan list and the alignment tools; 128 px thumbnails.

Decided ✔: plans saved before R2 keep their pixels as plan units (migrated as rasters, placed
where they were); content (tiles in memory, GPU textures) is loaded for the shown level only,
plus the plan in Edit and the list's thumbnails; plan file format 2 carries the original
file; R2.2's store is tested on fake-indexeddb, R2.3's worker in browser mode.

Done ✅: R2.1 (`floorplans/content.ts`: `PlanSize`, `PlanContent { size, raster? }`,
`RasterContent { unit, image }`, `rasterContent`, `closeContent`; `FloorPlan.size` in plan units
replaces `image`, content in `FloorPlans.contents` (a `SvelteMap`, values not proxied), given to
`FloorPlanLayers.setContents`; tiles placed at `unit` plan units per pixel (`tileCorners`);
importers return content: photos in their own pixels (even when drawn smaller), SVG in user
units, PDF pages in points; restore uses the stored `size`, else the image's pixels).
R2.2: `persist/plan-store.ts` schema 3 (`plans`, `rasters`, `tiles` keyed `[plan, level, x,
y]`, `originals`, `thumbnails`, `settings`; `images` of schemas 1–2 kept until converted):
`load()` gives settings only, `loadContent`/`saveContent`/`loadThumbnails`; tested on
fake-indexeddb, a version 2 database upgraded in the test. `FloorPlans` takes a `codec`
(`floorplans/codec.ts`: encode and decode tiles, thumbnails, old images), saves new content
encoded with its thumbnail and file, keeps content only for `showLevel(level)` and the plan in
Edit (others' bitmaps closed), converts a plan saved as one image the first time it loads (at
restore when it has no size), and exports read the stored original (`originalOf`). Tile
format chosen ✔: JPEG XL where the browser decodes it (encoded by a WASM encoder: canvases
don't write JXL), else lossless WebP, else PNG; R2.2 encodes lossless WebP or PNG on the main
thread, R2.3 adds JXL and the worker. The e2e `untilSaved` also waits for each plan's content.
R2.3: one module worker (`floorplans/plan-worker.ts`, client `workerCodec()` in `codec.ts`)
decodes photos (downscaled past 8192 px), cuts the pyramid (`pyramid.ts`) and answers twice:
the cut tiles at once (the plan shows), then the tiles encoded and the thumbnail
(`PlanImage.encoded`), which `FloorPlans` saves; stored tiles decode there too. Formats
(`tile-format.ts`, `tile-codec.ts`): lossless JPEG XL through jSquash's WASM libjxl (`jxl.ts`,
effort 2: about 0.6 s a 2048 px tile; loaded on demand) where the browser decodes a JPEG XL
sample, else lossless WebP, else PNG; a stored JPEG XL tile the browser no longer reads is
decoded through WASM. SVG and PDF still render on the page (they need `<img>` and canvas) and
send a bitmap. `floorplans/plan-io.ts`: `openPlanFile` (a plan, a PDF to pick pages from, or a
plan file's plans), `readPlanFile`, `writePlanFile` (a plan without its file is left out, from
under the outlines too), `pageName`; `FloorPlans.insertPlans` places the outlines. Tested in
Node with fake decoders, the worker and codecs in Chromium (`*.browser.test.ts`).
R2.4 (decided ✔: a PDF is stored once for its pages; the file is a ZIP archive):
`PlanSource` (`raster`/`svg` file, or `pdf` file with page and DPI) on every plan; files are
stored by file id in `originals` (`saveFile`/`loadFile`), deleted with the last plan from them
(plans saved before have theirs under their own id); `PlanImage` no longer carries a PNG of
renderings. Plan file version 2 (`plan-file.ts`, fflate): `plans.json` (size and source
required, `fitKind` kept) and `files/n.ext` stored uncompressed; a version above 2 is refused
("made by a newer version"); version 1 JSON and 1.x files are still read. `plan-io.ts`:
`readPlans` (archive or JSON) draws each plan again from its file, a PDF opened once with its
pages rendered at their DPI, files given new ids; `writePlanFile` gives a `.zip` Blob; `pdfPage`
names and sources a picked page. E2E: exported archive read back, the PDF stored once.
R2.5 (decided ✔: a code split only, the tools stay in the side panel; thumbnails stored at
128 px, shown at 40 px): `FloorPlansPanel` is the shell of `PlanFiles` (import, export, the PDF
page dialog), `PlanList` (the layers, removal) and `PlanTools` (the plan in Edit: level,
opacity, alignment tools, Done/Cancel), each with component tests in Chromium.

**R2 done** ✅.

### R2.6: Precise placement — S ✅

Asked for after R2.5. In the plan in Edit's tools: the centre's latitude and longitude, the
rotation (bearing of the plan's top edge, 0–360° clockwise from north) and the real width in
metres, typed exactly; dragging, turning or resizing the plan updates them. Typing one moves,
turns or scales the plan around its centre, keeping its shape, and drops its control points (as
dragging does), whatever its fit.

Done ✅: `georef.ts` `positionOf` (centre, bearing of the top measured from the centre, width
across the middle in ground metres) and `moveTo` (moved first, then turned and scaled about the
centre, as a whole: a warped plan keeps its shape), tested against spherical geometry;
`FloorPlans.setPosition`; a Position group under Opacity in `PlanTools` (values rounded to
7 decimals, 0.1°, 1 cm; an impossible value puts the field back). E2E: a longitude typed moves
the plan 100 px, a drag back updates the field.

### P4.2: Vector and light raster plans — M–L

1. **Vector extraction**: stroked and filled paths from PDF pages (pdf.js operator list with
   the transform tracked through save and restore) and SVG files (parsed with `DOMParser`,
   never attached to the page), as Float32 positions, indices and per-path styles, stored
   with the plan. Measured on the user's A3 plans: up to 195,000 paths and 550,000 segments
   a page, 6 MB; extraction 63 ms after pdf.js's own parse (about 3 s, once).
2. **WebGL plan layer**: one MapLibre custom layer per plan, lines drawn as instanced quads;
   the plan's 3 × 3 transform combined with the camera on the CPU in float64 each frame
   (relative to the plan's centre), so moving and aligning only changes a uniform;
   projective plans divide in the shader. Ordered by the plans' stack as today.
3. **Text and CAD layers**: text from pdf.js's text content as labels (or a light image layer
   for text only); optional content groups as layer toggles in the panel.
4. **Light raster plans**: only on-screen tiles at the needed level, decoded on demand, an
   LRU that closes bitmaps, stored tiles, updates on pan as well as zoom. For scans, photos
   and image-heavy PDFs.
5. **Plan vertices for snapping**: an rbush of plan vertices in plan units, queried through
   the inverse transform; used by P5.3's snapping.

Decided ✔: parts in the order above (vector first); the PDF page dialog offers Auto / Vector /
Image (Auto: vector for pages mostly made of paths, image when images cover most of the page;
images in a vector page drawn as a light raster under the lines); the PDF's own colours, hairlines
(width 0, as in CAD exports) one device pixel wide, other widths scaled with zoom; text as
MapLibre labels at their places, turned with the plan, sized with zoom, hidden when too small.
The user's A3 CAD PDF: 155 CAD layers, all lines hairlines, 1,300–2,250 text items a page.

Done ✅: P4.2.1 (extraction and storage, not drawn yet): `floorplans/vector.ts`
(`VectorContent`: segments and triangles as Float32 in plan units with a style index each;
styles `{color RGBA, width, layer}` shared; the CAD layers used, in the file's order;
`VectorBuilder` flattens curves within 0.1 plan units by Wang's formula and fills with earcut,
rings nested by containment as holes), `vector-pdf.ts` (pdf.js operator lists: transform
through save/restore and form XObjects, RGB colours, CA/ca, widths scaled by the transform,
optional content per path; clips, transparent and pattern paint, shadings, images and text
left out), `svg-path.ts` (path data with arcs, transform lists, basic shapes, inherited
styles; pure) and `vector-svg.ts` (`DOMParser`, viewBox and preserveAspectRatio, `<use>`,
colours read by a canvas). On the user's heaviest page: 219,000 segments, 1,400 triangles,
58 layers, 4.4 MB, 350 ms after pdf.js's 2.4 s parse. Store schema 4: `vectors`
(`loadVector`, `saveVector`, deleted with the plan).
P4.2.2a: `PlanContent.vector` (`vectorContent`), saved with a thumbnail drawn in the plan
worker (`vectorThumbnail`), loaded per level; `map/plan-matrix.ts` (`planToClip`: plan units
to clip space through MapLibre's world-pixel `modelViewProjectionMatrix`, composed in
float64; `unitPixels`), `map/vector-plan-layer.ts` (a custom layer per plan: fills as
triangles, segments as instanced quads widened on screen, hairlines 1 device pixel,
premultiplied blending, opacity), drawn by `FloorPlanLayers` in the plan stack. SVGs import as
vectors unless they hold `<image>`s. Tested: the maths in Node, the layer's pixels in
Chromium, FloorPlans with the memory store, an SVG plan drawn and reloaded in e2e.
P4.2.2b: the PDF page dialog's "Draw as" Auto / Vector / Image (Resolution only for images);
`pdfPageKind` (pure): Auto draws a page from its paths unless it has none or images cover at
least half of it (`IMAGE_SHARE`); `PdfDocument.vector(page)` (with the PDF's CAD layers) and
`pageMode(page)`; `PlanSource.mode` (`PlanMode`, SVG and PDF; unset: image) set at import,
written to plan files and honoured when they're read (`readPlans` draws each page as saved).
P4.2.3a (text read, not drawn yet): `VectorContent.texts` (`VectorText`: the middle of a line,
font size and angle in plan units, its CAD layer). PDF text comes from the operator list's
`showText`, not pdf.js's text content (which can't say a text's optional content group): the
text matrix, font size, spacing and horizontal scale tracked; pieces of one line shown one
after another joined (within 0.6 em on, a space past 0.15 em); invisible text (render modes 3
and 7, a scan's recognised text) left out. SVG `<text>` and `<tspan>`s placed with x or y, with
`font-size` (em, %) and `text-anchor` inherited (`resolveStyle`), measured with a canvas. On
the user's PDF: 200–1,260 labels a page. Vectors stored before read with no text.
P4.2.3b: `map/plan-labels.ts` (pure): `planLabels` (each text a GeoJSON point through the
plan's transform, its size in pixels at zoom 0 and its rotation measured on the spot, hidden
CAD layers' text left out) and `planLabelLayer` (dark text, light halo, turned with the plan;
`text-size` doubling each zoom level, exact at whole levels, capped at 250 px, which MapLibre
can't exceed; opacity 0 under 6 px, fading in over the zoom level before; never hidden by
collisions, never hiding OSM labels). `FloorPlanLayers` adds the labels right above their plan
and moves them with it. MapLibre draws glyphs locally when the glyph server fails (e2e).
P4.2.3c: `FloorPlan.hiddenLayers` (CAD layer ids): a new plan starts with the layers its file
has off hidden (a plan file's own list wins); changed in a Layers section of the plan's tools
(a checkbox a layer, a search box, Show all and Hide all acting on the layers listed), saved at
once like the plan's eye (Cancel keeps it), stored (plans saved before have none hidden) and
written to plan files. `VectorPlanLayer.setHiddenLayers` rewrites only the colour buffers
(hidden paths clear); the labels of hidden layers are left out. P4.2.3 done.
P4.2.4: light raster plans. A plan's tiles are cut (`CutTile`, a bitmap: just imported) or
stored (`StoredTile`, a blob: loaded from storage, no longer all decoded on load).
`floorplans/tile-cache.ts` (`TileCache`, `FloorPlans.tiles`): stored tiles decoded once when
the map first shows them, kept within 512 MB (`TILE_BUDGET`), the least recently used dropped
and closed, never those on screen (`pin`); a plan's are closed with its content.
`visibleTiles` (`tiling.ts`, pure): the tiles meeting a part of the map. `FloorPlanLayers` draws
a raster plan's tiles at its pyramid level within the view (and a quarter view around it),
synced once a frame while the map moves; while some are decoding, the nearest coarser level
decoded there goes under them. The map shows how many tiles it draws as `data-plan-tiles` (e2e).
P4.2.5: `floorplans/plan-vertices.ts` (`PlanVertices`, pure): a vector plan's segment ends and
filled triangles' corners in a uniform grid of typed arrays over the plan (an rbush of objects
took 740 ms to load on the user's heaviest page; the grid 94 ms), queried through the inverse
transform, shared vertices given once, hidden CAD layers left out. `FloorPlans.verticesNear`
(the visible vector plans on a level, an index built when first snapped to and dropped with
the content). Alignment clicks on the plan in Edit (a control point's spot, measured spots,
the pivot) snap to its own corners within 8 px; a control point's map click to an OSM node,
else to another plan's corners. P4.2 done.

### R3: Fixes from the October audit — S–M — done

Before P5.3: these lose edits, hang, or block drags. One slice each, red test first.

1. **Upload safety**: edits, undo and downloads paused while uploading (the history and
   `MapLoader` take a lock); a `DataSync` generation, bumped by `reset`, so tile answers from
   before the upload are dropped and their tiles downloaded again; the Save dialog counts
   changes and refuses above 10,000 (split later); a `beforeunload` guard while there are
   unsaved edits (moved up from P5.4: one line, and it saves real work today).
2. **Login that can't hang**: `session.login()` rejects when the popup is closed (poll
   `popupWindow.closed`) or after a timeout; Cancel stays enabled during sign-in; one live
   listener at a time.
3. **Keys**: `onKeydown` returns on `event.defaultPrevented` and while a modal is open.
4. **Untrusted imports**: `unzipSync` with a filter (the manifest and the files it names,
   each under a size cap, a total cap); an SVG expansion budget (2,000,000 segments or
   elements) raising `plan_import_svg_unreadable`; raster dimensions read from the file
   header and checked before decoding; `codec.ts` drops a dead worker.
5. **IndexedDB**: `blocked` → `storageError` shown, `blocking` → close and reopen later,
   `terminated` → drop the handle; a rejected open is not cached.
6. **Pointer events**: the mode manager listens to pointer events (mouse, touch, pen), one
   active pointer, `setPointerCapture`, `preventDefault` when a mode takes the press; modes'
   `end(at)` applies the last move.
7. **Map display**: relations need tags other than `type` to be drawn; a vertex without
   `level` takes its parent ways' levels; `building:levels` gives its range to the outline only,
   not to the switcher; a circle layer for POIs without icon or label, selectable; the hash
   keeps the level exact; indoor layers install even when the basemap style fails.
8. **Flaky e2e** (`wiki-fields.spec.ts:77`, failed once in a full run, passed 4 of 4 alone):
   pressing Enter in a combobox before its search answers keeps the old value. Enter should
   pick the exact match of the typed text once the pending search settles.
9. **Small ones**: `vertical-repeat-on` skips doors and entrances; logout revokes the token;
   kept deletions (`notDeleted`) listed after an upload; tiles that fail with 400 (too many
   nodes) back off and split; `amend` survives a merge; `changePreset` keeps
   `min_level`/`max_level`; engines `>=22.17` or Node 24 in the session hook.

Done: uploads lock `EditHistory` and pause `MapLoader` (`reset` drops answers from before
and downloads those tiles again); more than 10,000 changes are refused; `beforeunload` guard.
`Session.login` rejects on a closed popup (two checks 500 ms apart, unless the callback
answered), on Cancel or after 5 minutes; only the latest login's answer counts. Map keys go
through `isForMap` (and Mod+Z is blocked behind a modal, the browser's own undo would edit a
field). Plan archives inflate only the files the manifest names (256 MB each, 512 MB in all);
SVG budget; raster sizes from `image-size.ts` (refused over 100 megapixels, scaled while
decoding). IndexedDB `blocked` fails at once with `plan_storage_blocked`. `ModeManager` on
pointer events with capture, holding `dragPan`/`touchZoomRotate` during a mode's press.
Map display as listed (a fallback style replaces a basemap that fails). R3.8 could not be
reproduced (30 of 30 runs passed): Enter in `SearchCombo` now waits for `Combobox.settle()`
and picks the result named as typed; `amend` surviving merges may have been the real cause.
R3.9 as listed; tiles also back off after failures (1 s doubling to 60 s).

### W: Wiki conformance — S — done

Pure modules, can run beside P5.3: `highway=elevator` in the elevator upgrades;
`indoor=highway` and `indoor=stairs` → `indoor=yes`; a `missing-level` rule (indoor features
and features inside an indoor outline) with a fix taking the shown level; `door-not-on-wall`
also for doors on an `indoor=wall` area; a hint, never a rewrite, for one-based numbering (no
level 0 and features above `building:levels`); a hint for `level` on `tunnel=building_passage`.

From osm-simple3d-editor's `validateIndoor` (`src/edit/validate.ts`), each a few lines:
`room=*` on something that isn't `indoor=room|area|corridor`; `building:part` on an indoor
space; `inside=*` (not an established key); `entrance=yes` on a door inside the building, more
than 0.5 m from its outline, with a fix to `indoor=door` + `door=yes`; `indoor=door` without
`door=*`, fix `door=yes`; `door=loadingdock` (→ `amenity=loading_dock`), `entrance=gate`
(→ `barrier=gate`), `addr:entrance=yes` (→ `entrance=*`); a door, entrance, window or
emergency point with several `level` values, fix "lowest in `level`, the rest in
`repeat_on`" (SIT's "Vertical connections", revised by Tordanik on 2025-12-15, says a stair or
elevator door is one node with `repeat_on`); a room on several levels that is really one room
per level, fix: one copy per level sharing nodes (needs P5.3's actions).

Added after the 2026-10-28 review of osm-simple3d-editor: a door on the building's outer wall
(within 0.3 m of the outline or of the `indoor=level` outline on its level) without
`entrance=*`, fix `entrance=yes`, with the entrance type from iD's `entrance` field; a clearer
message for `room=*` on `indoor=wall|column`; floor plans shown since the last upload go into
the changeset as `imagery_used=Custom` and `source=custom imagery`, never their file names
(they can carry private details). Doors on an `indoor=wall` area are flagged only:
osm-simple3d-editor cuts a notch into the wall polygon to fix them, which rewrites geometry and
stays out of W.

Done: upgrades for the elevator (`highway=elevator` added, `elevator=yes` kept),
`indoor=highway|stairs` → `indoor=yes`, `door=loadingdock` → `amenity=loading_dock` + `door=yes`,
`entrance=gate` → `barrier=gate`, `addr:entrance=yes` → `entrance=yes`. New rules in
`validate()`: `missing-level` (an `indoor=*` feature, or a point inside an indoor outline, with
no `level`, `repeat_on`, `min_level`/`max_level` or parent multipolygon level; a vertex is left
to its ways), fixed through `Issue.levelFix(level)` with the level the map shows;
`door-not-on-wall` with its own message for a closed `indoor=wall` + `area=yes`;
`outer-door-no-entrance` (0.3 m from a building outline, or from an `indoor=level` outline
whose levels overlap the door's); `entrance-inside` (`entrance=yes` inside a building and more
than 0.5 m from every building outline, fixed to `indoor=door` + `door=*`); `one-based-levels`
on a building (its indoor outlines have no level 0 and reach `building:levels`; no fix);
`building-passage-level` (no fix); `room-not-indoor` (fix `indoor=room` when there is no
`indoor=*`; the wall and column message has no fix); `building-part-indoor`; `unknown-inside`;
`door-without-type` (fix `door=yes`); `opening-on-several-levels` (fix: lowest in `level`, the
rest merged into `repeat_on`; ranges of non-whole levels such as `0-0.5` are left alone);
`room-on-several-levels` (added with P5.3's first slices: an `indoor=room|area|corridor` way
listing several levels in `level`, fix "one per level", `actions/split-levels.ts`: the way keeps
the lowest level, each other level gets a copy with the same tags and nodes; the message says
a room that spans levels is right as it is; stairs, elevators, atriums, `repeat_on`, ways in a
relation and non-whole ranges are left alone).
Where a feature is comes from `validation/outlines.ts` (`Outlines`: building and indoor outlines
in an rbush, updated from `changedSince`); the `Validator` keeps one and drops the cached issues
of entities near an outline that changed. The Save dialog adds `imagery_used=Custom` and
`source=custom imagery` once a floor plan was shown on the map (reset after each upload, as is
the imagery list). Not done: outlines drawn as multipolygon relations are not indexed yet.

### L: Level names — S–M — done

The switcher takes `{level, ref, name}` (from `indoor=level` outlines, else
`building:levels:ref` with `building:levels:ref:equivalent`) and shows `level:ref` with the
number as a tooltip; `non_existent_levels` skipped, features on them flagged; shown only when a
building with indoor data is in view (MapGL Indoor). The one refactor of the research:
`LevelControl` and the level state change shape; the hash keeps the number.

`level:ref` is free text in real data (osm-simple3d-editor's `docs/indoor-level-examples.md`):
numbers, codes (`E0`, `U1`), US numbering (first floor = 1) and full names
(`Untere Verkaufsebene`). Show it as is, shorten long values with the full text in the
tooltip, and fall back to `name`. Levels missing between known ones (0, 1, 3) still get a
button.

Done: `levels/level-names.ts` (pure): `outlineLevelName` (`level:ref` and `name` of an
`indoor=level` outline on one level), `buildingLevelRefs` (`building:levels:ref:equivalent`,
`1=level 0;2=level 1`, and `building:levels:ref` read from the lowest floor only when it names
every floor the building counts: the wiki says the list may be incomplete), `nonExistentLevels`,
`explicitLevels` (single levels and range ends), `levelList` (gaps filled up to 100 levels, a
skipped level kept only when a feature names it, so an elevator on `12-14` doesn't bring 13
back) and the labels (`shortLabel`: 6 characters, `fullLabel` for the tooltip). The feature
store keeps a second lazy rbush beside the node index (`DraftIndex`), and
`StoredFeatures.levelsIn(extent)` gives the switcher the levels of the features in view, named
from the outlines nearest the middle of the view first, then the buildings'. `LevelControl` takes
`LevelEntry[]`: buttons show the short label, the tooltip and accessible name the full one
(`Level 0: EG · Erdgeschoss · level 0`); the hash keeps the number. A new rule,
`non-existent-level`, flags a feature in a building that names one of its
`non_existent_levels` (no fix). Not as planned: with no indoor data in view the switcher
doesn't disappear but falls back to stepping by one without a list, since the editor needs it
to start mapping a building (V can hide it). `non_existent_levels` is read on building
outlines only, not on `building:part`.

### P5.3: Geometry editing — L — done

On R1's modes, drag, selection and geometry, and R3's pointer events. Follow iD's layering
(see "Research and audit"): behaviours (hover, select, drag, draw, lasso, paste) that modes
compose, operations over actions, actions that say why they can't run. Slices:

1. Edit overlay: vertices and midpoints of the selected and hovered ways (and shared
   vertices from zoom 18), untagged member ways as thin lines; the drag preview lives here.
2. Snapping (`map/snap.ts`): node, then segment, then plan vertex, on the shown level, 8 px;
   on an entity and segment index updated from each difference (iD's `core/tree.ts`).
3. Drag a node (moves every way using it), committed on release in one step.
4. Draw point, line and area, tagged with the shown level; add a vertex at a midpoint
   (in every way sharing the segment).
5. Operations: delete with cleanup, door on a wall, orthogonalize (iD's current action),
   copy and paste (ids remapped, pasted features selected), copy level, disconnect; each an
   operation as in iD (`available`, `disabled` with a reason, tooltip, keys, annotation), one
   list for the menu, shortcuts and tooltips.
6. Multi-selection (Shift+click, lasso) with the Inspector's shared fields and "Multiple
   values"; hover preview, read-only.
7. Simple multipolygons (outer and inner) and member editing on the map.
8. Map details from P3: door widths, incline and conveying arrows.
9. Spatial validation: level outside the building's levels, missing `indoor=level` outline,
   door not on a wall, walls and rooms not sharing nodes, empty keys or values; an area index
   for "which building"; ports of iD's `crossing_ways` (levels compared with `isOnLevel`),
   `unsquare_way` (rooms), `close_nodes`, `almost_junction`, `disconnected_way` (indoor
   footways); a base and a head cache so only issues the user caused are flagged, checked in
   idle time.
10. Floor plans: snap control points to building outlines, numeric offset, assign plans to a
    building.

Done ✅ (slices 1–3): `edit/overlay.ts` (pure: the vertices of the selected and hovered ways,
of a selected vertex's ways and of a relation's member ways; midpoints of the selected ways'
sides once 40 px long, one per side shared by several; junctions in view from zoom 18, marked
`@shared`; untagged member ways as lines) drawn by `map/edit-overlay.ts` (`EditOverlay`, its
own source in the `edit` slot, `grabAt` for presses: a vertex first, then a midpoint).
`map/snap.ts` (`snapAt`: node, then side, then plan vertex, 8 px on screen; `areaAround`);
the feature store gained a side index beside the node index (`segmentsNear(extent, level)`,
each side once whichever ways share it), and the floor plan tools' snapping goes through
`snapAt` too (no change in behaviour). `edit/node-drag.ts` (`nodeDrag`): a vertex or the
selected point moves with every way using it, a midpoint becomes a vertex of every way sharing
its side (`addVertex`, `insertNodeInSegment`); dropped on a node it joins it
(`actions/connect.ts`, iD's connect, refused for two nodes with different tags or a way that
would collapse), dropped on a side it becomes a vertex of that side's ways (not of its own
way); Alt turns snapping off. Moves are shown live through `EditHistory.preview` (the graph
changes without a step; `commit` makes the one undo step, `cancelPreview` drops it, an edit,
undo or upload meanwhile wins, downloads keep it) rather than a separate drag source: P5.2
made an edit reach the map in 3–5 ms. While a shared vertex is dragged a hint says how many
features on which levels move ("moves 2 features on levels 0;1"). Browse mode takes the
overlay: the cursor shows what can be dragged (the way stays hovered), a click on a vertex
selects it. Dragging a way or an area whole came with the leftovers (below).

Done ✅ (slice 4): a Draw group in the toolbar (Point, Line, Area; keys 1, 2, 3 as iD) turns on
`edit/modes/draw.ts`. `drawWayMode` on `edit/draw-way.ts` (`WayDrawing`): each click adds a
corner, onto the node it snaps to (shared), onto a side (a new node in every way with that
side) or a new node; the pointer drags the last side along; a click on the last corner (or an
area's first), or Enter, finishes; Backspace takes the last corner back; Escape finishes, or
stops when there are too few corners; switching tool or mode keeps nothing. The way carries
the shown level (and `area=yes` for an area, which `changePreset` drops for the type picked),
and the whole drawing is one undo step, previewed as drags are. `drawPointMode` on
`edit/place-point.ts`, the role-by-snap point tool: on a side of an indoor way a door
(`indoor=door` + `door=yes`, in every way with that side, no `level`: vertices take their
ways'), on a building's outline an entrance (`entrance=yes` + `door=yes` + the shown level, in
the building's ways and the indoor ways along it), on an untagged corner of those ways that
corner becomes it, on a tagged node that node is selected, elsewhere a point on the shown
level. A drawing ends selecting the new feature; the Inspector opens on the type list for a new
feature with only `level` and `area` (iD's new feature). A hint at the bottom says what clicks
and keys do. Midpoints (slice 4's "vertex at a midpoint") came with slice 3's drag.

Done ✅ (slice 5, first part): `edit/operations.ts`, iD's operations as one list: each says
whether it applies to the selection (`available`: the toolbar's "Edit selection" group shows
it), why it can't run (`disabled`, a `Message` the tooltip and a note at the bottom show; the
button stays focusable with `aria-disabled`), its keys and annotation, and gives an edit to make
as one step with what to select after (`performEdit` in `state/commands.ts`), or a clipboard.
Copy (Mod+C) and Paste (Mod+V) on `actions/copy.ts`: a snapshot of the points and ways
selected with their nodes (vertices and relations left out), pasted with new ids centred on
the pointer (or the map's centre), the pasted features selected; a copy all on one level
pasted while another is shown goes on that level. Disconnect (D, `actions/disconnect.ts`): a
shared vertex gets a copy per way but the first; a way gets its own copy of every node it
shares. Square the corners (Q, `actions/orthogonalize.ts`, iD's current action: corners within
13° of square, straight runs put back on their line; refused for a shape that isn't squarish
or is square already). Merge rooms (C, `actions/merge-areas.ts`, osm-simple3d-editor's: closed
ways with the same `indoor`, `room`, `level` and `repeat_on` sharing sides; the largest keeps
its id and gets the others' missing tags). Delete (Delete, Mod+Backspace) on `deleteEntities`.
Shift+click adds a feature to the selection or takes it out (slice 6's multi-selection;
MapLibre's Shift+drag zoom is off while browsing). Not yet: split across rooms, repeat on
levels and clear (the rest of slice 5), a right-click menu, lasso.

Done ✅ (slice 5, the rest): Split across rooms (the Split tool, X; `actions/split-areas.ts`,
`edit/modes/split.ts`): a line drawn click by click (Enter or a click on its last point
finishes, Backspace takes a point back) cuts every room, area and corridor it crosses by more
than 0.5 m; crossings within 5 cm of a corner use it, new nodes go into indoor neighbours
only (building outlines untouched); the largest piece keeps the id and history, the others
copy its tags and its relation memberships. Repeat on levels (R, `actions/repeat-levels.ts`,
`ui/RepeatDialog.svelte`): a checkbox per level, those already holding an identical copy
checked (unchecking deletes it), and the three methods (copies sharing nodes at the same
position, `repeat_on`, `level=a;b`), one undo step. Clear is Delete: `deleteEntities` takes
a room's unused nodes and the upload deletes them `if-unused`, which is what osm-simple3d-
editor's Clear does. Not done: a right-click menu (the toolbar group and the shortcuts cover
the operations).

Done ✅ (slice 6): Shift+click and a Shift+drag lasso (`edit/lasso.ts`: the points and ways
whose nodes are all inside, on the shown level; a still Shift+press is a Shift+click) select
several features; `ui/MultiInspector.svelte` lists them (select one, deselect one, hover
highlights it on the map), shows the fields of their shared preset (`sharedPreset`; "Multiple
types" when they differ) and the shared tags, a key whose values differ shown empty with
"Multiple values" (`editorTags`, `editorPatch`: left alone unless typed in). Not done: the
read-only hover preview, which opened and closed the side panel as the pointer crossed
features.

Done ✅ (slice 7): Make a multipolygon (Shift+C, `actions/multipolygon.ts`): closed ways
become members of a new `type=multipolygon` relation, or are added to a selected one; a ring
inside an odd number of others is `inner`; the outer ways' tags move to a new relation when
they all have the same ones; a hole drawn with only `level`/`area` loses them. Refused with a
reason for open ways, two relations, or a way already in another multipolygon. Member editing
on the map is the Members section (P3) and the overlay's member lines (slice 1).

Done ✅ (slice 8): door widths (`doorWidth`: `width` in m, cm, mm or feet, 0.3 to 20 m) size
the door circle with the zoom; `arrowOf` gives one-way arrows along lines for `incline`
(up, down, a slope) and `conveying` (which wins: escalators and moving walkways), drawn by the
`indoor-arrows` symbol layer (`map/style/arrows.ts` images, turned for backward).

Done ✅ (slice 9): `validation/spatial.ts`: empty keys or values (an error, fixed by removing
them), a feature on levels its building's `building:levels`/`min_level`/`max_level` doesn't
have, a room on a level without an `indoor=level` outline when the building has them for
other levels, corners within 20 cm of another indoor way's or a building's side without
joining it (iD's `almost_junction`, fixed by joining), rooms and corridors crossing on the
same level (`crossing_ways` with levels as ranges), rooms a few degrees off square
(`unsquare_way`, fixed by squaring), nodes 5 cm apart (`close_nodes`, fixed by merging), and
indoor footways joined to nothing (`disconnected_way`). Multipolygons left open are an error
that the save dialog waits on (`BLOCKING_RULES`). The save dialog lists the issues of the
edits leaving out the warnings the downloaded data already had (iD's base and head caches:
a second `Validator` on `graph.base()`, the same graph for the same data), and checks the
multipolygons of edited ways. "Door not on a wall" and "walls and rooms not sharing nodes"
were already P3's `door-not-on-wall` and are now also `almost-joined`; the area index is
`Outlines` (P3). Not done: checking in idle time, as the per-entity cache keeps checks to what
an edit touched.

Done ✅ (slice 10): control points snap to the sides of what is drawn (a building's walls)
as well as to nodes; "Move by" moves the plan in Edit a number of metres east and north
(`offsetBy`); a plan can be assigned to a building under it (`floorplans/buildings.ts`, the
one around its centre first), saved, exported (`building` in plan files) and named in the
plan list.

Done ✅ (leftovers): a press on a selected feature drags the selection whole
(`edit/feature-drag.ts`, one undo step; a still press stays a click). The upload cases below
are tested in `osm/osmchange.test.ts` (and the existing ordering tests): pieces of a room drawn
and split in the session are only created, a deleted member leaves its relation in a
modification sent before the deletion, a node merged away is deleted `if-unused`, and an open
multipolygon is refused before upload.

Lessons from osm-simple3d-editor's floor plan tools (built 2026-10-26 to 10-28; details in the
research doc):

- **Unmapped floor is empty, and selectable.** A click on floor outside any room selects the
  level outline minus its rooms, corridors and areas; tagging it creates an `indoor=area` on
  the shown level, sharing nodes with its neighbours. Needs an `indoor=level` or building
  outline for the level, so it goes after slice 4.
- **Split across rooms** (an operation in slice 5): one polyline cuts every room and empty
  piece it enters by more than 0.5 m; the larger piece keeps the history, the rest copy the
  tags, cut nodes are shared and inserted into indoor neighbours; building ways untouched.
  **Merge** rooms with the same `indoor`, `room`, `level`, `repeat_on` and a shared side.
  **Clear** (make empty) instead of Delete for rooms: nodes go to `if-unused`.
- **One point tool whose role comes from the snap** (slice 4): on a room side, a door inserted
  into every indoor way with that side; on the outer wall, an entrance (`entrance=yes`) also
  inserted into the building way; inside, a POI. Same 8 px as our snapping.
- **Repeat on levels** replaces "copy level" in slice 5: a checkbox per level, levels that
  already hold an identical copy start checked (unchecking deletes it), and three methods:
  separate copies sharing nodes with the target level (default), `repeat_on`, or one feature
  with `level=a;b`. One undo step.
- **Shared outline nodes** (slice 3): rooms on the facade share the building outline's nodes,
  so a drag moves rooms on every level using them. Show how many features on which levels
  will move; "disconnect" (slice 5) is the way out.
- **Upload cases to test** before P5.3 ships, each a bug osm-simple3d-editor hit: new
  relations that reference new relations come after them in the osmChange (400
  "Placeholder"); split new ways are never looked up on the server; members deleted in the
  session leave their relations; a moved node that ends up unused is deleted with
  `if-unused`; a multipolygon with an open ring is refused before upload.
