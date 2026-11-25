# IndoorID: finished phases

What was built, measured and decided in each finished phase, moved out of [plan.md](../plan.md)
on 2026-10-29 so the plan only holds what comes next. OsmInEdit's code: commit `cd1e955`.

## Why a new editor (findings from OsmInEdit's code)

- **Upload logic is the main source of bugs.** OsmInEdit edits GeoJSON (via osmtogeojson), then a
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

- OsmInEdit's code removed (kept at `cd1e955`); SvelteKit 3, Svelte 5, Tailwind 4, bits-ui,
  MapLibre 6; Bun, Biome, Vitest, Playwright, CI; `CLAUDE.md` and project skills.
- Map with keyless OpenFreeMap basemap from `static/config.json` (no secrets).
- URL hash `#zoom/lat/lon/level`, compatible with OsmInEdit links, keeping fractional zooms and
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
  `deleteEntities` with iD-style cleanup. The OsmInEdit `_analyzeDiff` scenarios that still apply are
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
  above), validated with MapLibre's validator; OsmInEdit icons bundled and rasterised on demand at
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
  to the OsmInEdit icons; rooms, walls, doors and other structure get none. Icon files are loaded on
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
  URLs), and OsmInEdit `osminedit_floor_imagery.json`. OsmInEdit corners become an exact
  perspective transform (as OsmInEdit drew them with CSS `matrix3d`) instead of the affine first
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
- Floor plan mode (as in OsmInEdit): the map shows only building outlines (any area with a
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
   v1 and OsmInEdit readers stay.
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
("made by a newer version"); version 1 JSON and OsmInEdit files are still read. `plan-io.ts`:
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

### R4: Fixes after P5.3 — S — done

1. **Undo, redo and Save during a drawing or drag.** The draw mode's `key()` takes only Enter,
   Escape, Backspace and Delete, so Mod+Z reaches `SHORTCUTS` in `EditorView.svelte` and undoes
   the step before while the drawing goes on; the Undo, Redo and Save buttons stay enabled.
   A probe test showed it: a line snapped to a node, Mod+Z undoing that node, the line finished:
   the osmChange sends `<nd ref="-1"/>` with no node -1 (412, and every later upload fails until
   the way is deleted). Save while drawing uploads the preview graph (a half-drawn area as an
   open way with `area=yes`; read in the code, not run); the edit count counts the preview. A
   node or feature drag can hit the same. Fix: while `history.previewing`, Mod+Z goes to the
   mode (in draw mode it takes the last corner back, as iD) or is refused; Undo, Redo and Save
   end the mode first. Unit test on `EditHistory`, e2e: draw, Mod+Z, finish, assert the
   osmChange.
   Done ✅: `EditHistory` refuses undo and redo while a preview is shown (`canUndo` and
   `canRedo` are false, so the buttons are disabled); in a line or area drawing Mod+Z takes the
   last corner back and stops the drawing once none is left, redo keys do nothing; Save is
   disabled while a preview is shown, and `lock()` drops a preview before an upload. Also
   fixed on the way: a tag edit during a preview (`setTags`, `patchTags`, `amend`) left the
   preview set, so the next download put the dropped drag back.
2. **Level change mid-drawing.** `drawWayMode` and `drawPointMode` keep the level they started
   with, but `modeKind` doesn't depend on `level`: switching level (switcher or hash) tags the
   way with the old level while `snapNode` snaps to the new level's nodes, joining levels by
   accident. Fix: a level change ends the drawing as Escape does. E2E test.
   Done ✅: `Mode.finish()` (through `ModeManager.finish()`), called when the shown level
   changes: a line or area with enough corners is kept on the level it was drawn on, else
   dropped; the point tool stops.
3. ✅ **Tests in cloud sessions.** Playwright 1.56.1 wanted `chromium_headless_shell-1194`;
   cloud containers now ship build 1243, so component and e2e tests didn't start there.
   Done 2026-10-29 with the dependency update: Playwright 1.63.0 matches it, and all 149 e2e
   tests pass in a cloud session (the PDF label checks now wait up to 15 s for glyphs).
4. **Bench before autosave.** Every tile merge rebases every undo step (`History.merge`), and
   `Editor.editIssues` is a getter calling `graph.changes()`: add a `bun run bench` case with
   500 steps and a tile merge before P5.4a fixes the saved format.
   Done ✅ (Bun, 10,000-room area): merging a 250-room tile takes 20 ms under 500 steps and
   790 ms under 10,000 (each step's graph is rebased); `changes()` after 10,000 edits takes
   10 ms. A long session hitches on every download: P5.4a should keep steps as differences
   over the base (which its saved format needs anyway) so a merge touches the base once, and
   rebase lazily if graphs per step stay.

### R5: Map shell split — M — done

`EditorView.svelte` is 1,184 lines (twice what R1 meant to leave): services, plan mode,
drawing, operations, mode wiring, snapping, hash, keys, panel and toolbar. Move the map, its
`IndoorMap`, the level and `levelsInView`, the hash, background and imagery, search and the
status line into a shared `MapShell` that takes the `Editor` from context and leaves room for a
toolbar and a side panel; `EditorView` adds modes, operations, drawing, floor plans and the
Save dialog on top. `snap`, `snapNode` and `projectLoc` move to `map/snap.ts` with the map
passed in. A pure move: no behaviour change, e2e green before and after. `Editor` needs no
split for V: `DataSync` takes any `SyncApi`, so an Overpass client with `loadMap` and a history
kept locked is enough.

Done ✅: `ui/MapShell.svelte` owns `MapView`, the `IndoorMap` (features, level, selection,
hover, `data-drawn`), the level and its switcher with `levelsInView`, the URL hash both ways,
background imagery (`onbackground` tells the editor for `imagery_used`), place search and the
download status; it binds out `level`, `map`, `camera` and `indoor`, takes `left` (the side
panel's width) and has `controls`, `tools` and `children` snippets. `map/view.ts` holds
`visibleExtent`, `projectLoc` and `unprojectPoint`. `snap` and `snapNode` stay in `EditorView`:
they read the editor's features and the floor plans, which V doesn't have. `EditorView` went
from 1,183 to 1,047 lines; no behaviour change, the same unit and e2e tests pass.

### P5.4a: Autosave and restore — M — done

Before V and 3D (decided ✔). From P5.4's first step:

- History saved to IndexedDB as per-step differences with their selection and labels, the base
  versions of edited entities and `nextId`; a restore prompt on start; the `beforeunload`
  guard stays.
- Steps as differences over the base, so a downloaded tile is merged into the base once
  instead of rebasing every step's graph (R4.4: 790 ms per tile under 10,000 steps).
- Steps record the selection, so undo and redo select again as iD does (today undo leaves the
  selection on deleted entities).
- The open changeset id remembered, so a retry after a lost upload response checks it first
  instead of duplicating data.
- iD's format (`history.toJSON`) and a session lock so two tabs don't restore the same edits:
  osm-simple3d-editor's lighter lock, one record per tab id (kept in `sessionStorage`, so a
  reload finds it) plus a `localStorage` heartbeat every 5 s; a record silent for 20 s belongs
  to a closed tab and a new tab may restore it.
  Autosave done ✅ (the first PR; the unmapped floor follows as its own):
  `osm/history-json.ts` saves the downloaded versions of the entities edited, then each step as
  what it changed (`Step.changed`, kept when the step is made, so a save costs the edits, not
  the data), its label and its selection; `restoreHistory` replays them and the data downloaded
  since is merged on top (a newer version of an edited entity is a conflict). The next id isn't
  saved: replaying gives one below every new entity. Downloads merge into the server data once
  and each step is rebased when next shown: a tile under 10,000 steps went from 939 ms to 1.3 ms
  (the conflict check asks the last step, which holds every entity edited in any).
  `persist/autosave.ts`: one IndexedDB record per tab (`indoorid-edits`), the tab id in
  `sessionStorage`, a `localStorage` heartbeat every 5 s, records silent for 20 s claimable in
  one transaction. `state/autosave.svelte.ts` saves a second after each change and when the tab
  is hidden, and nothing before the edits found on start are restored or discarded
  (`ui/RestoreDialog.svelte`). Steps record the selection while current; undo and redo select it
  again, without what the step doesn't have. A failed upload's changeset is kept
  (`DataSync.failedChangeset`, autosaved too) and the next upload downloads it first
  (`OsmApi.upload`'s `retryOf`): when it holds changes the upload went through, nothing is sent,
  and the Save dialog offers Start over (`DataSync.discard`).

- Then, as an editing feature: **unmapped floor** (from osm-simple3d-editor's lessons, not
  built in P5.3): a click on floor outside any room selects the level outline minus its rooms,
  corridors and areas; tagging it creates an `indoor=area` on the shown level, sharing nodes
  with its neighbours.
  Done ✅ (the second PR): `edit/unmapped-floor.ts`. `unmappedFloorAt` takes the map's
  features: the smallest `indoor=level` outline on the shown level holding the click, else the
  smallest building drawn there, minus the rooms, corridors, areas, walls and columns on that
  level (`polyclip-ts`, MIT, a robust polygon difference; original corners come back exactly),
  as connected pieces; the piece under the click is the floor, unless under 0.5 m² (a gap
  between rooms). A click on a level outline's or building's fill, or on the empty map, selects
  it (`BrowseOptions.floor`; a click on the outline itself still selects the outline): it is
  drawn in the edit overlay and `ui/FloorPanel.svelte` shows its level and area, "Map as indoor
  area" and the feature types. `Editor.floor` holds it, outside the selection and the history,
  so nothing is drawn until a type is picked; it follows edits (found again where it was
  clicked) and goes with a level change or a selection. `mapFloor` (one step, the new feature
  selected) goes through the neighbours' nodes: a corner on a node's spot (1 cm) is that node,
  nodes along a side (a corner two rooms share on a straight wall) are put in, and where a
  room's side crosses another's a new node goes into both indoor ways (never a building
  outline, as Split). Tags: the type's, `indoor=area` unless it sets `indoor`, the level, no
  `area=yes`. A floor with holes is a multipolygon; a hole that is exactly one room's ring is
  that room's way, not a copy.

### V: Viewer mode — M–L — done

After P5.4a (decided ✔), on R5's map shell, in three slices. Before V.1, one check from the
forum (osm-simple3d-editor t/148767 #115, where "move with neighbours" moved other levels'
features unnoticed): a test that dragging a node shared with a feature on another level either
leaves that feature alone or says so; if it moves it silently, fix that first (Disconnect
already exists).

1. **V.1 Read-only route.** Data from Overpass through a `SyncApi` (only `loadMap` differs), so
   no account and no OSM API quota. The style gains a presentation switch (edit, view, 3D:
   `indoorLayers({ presentation, theme })`) with light and dark colour sets, done once here for
   3D too. The selected building's full extent loaded once, so rooms cut at tile edges are
   complete. Overpass lags behind the API: after an upload, keep the uploaded versions and drop
   older entities from Overpass answers (osm-simple3d-editor dropped Overpass for this reason).
   Floor numbering setting (osm-simple3d-editor `40063a9`): levels without `level:ref` or
   `name` are labelled "Ground floor, 1, 2…" (counting from 0: UK, Europe, OSM `level`) or
   "1, 2, 3…" (counting from 1: US, Canada, Russia), defaulting from the browser locale, kept in
   the browser. Only labels change, never tags.
   Done ✅ (2026-11-11). The pre-V.1 check: dragging a vertex already said what it moves
   ("Moving this point moves 2 features on levels 0;1", unit and e2e tested); moving a
   selected feature whole stretched features on other levels silently, so `featureDrag` now
   shows `othersHint` ("Also moves features not selected (1, on levels 1)") through
   `featuresUsing` in `node-drag.ts`. V.1: `/view` (`ui/ViewerView.svelte` on `MapShell`, the
   header from `ui/AppPage.svelte` links both pages at the same hash) reads `api/overpass.ts`
   (indoor, `level`, `repeat_on`, building, part, door and entrance features, then `(._;>;)`,
   so ways and multipolygons come whole and the selected building's extent needs no extra
   query); tiles at zoom 15, two at a time, from zoom 16, never split. A click shows
   `ui/FeatureCard.svelte` (preset, name, levels, tags, link to osm.org). `indoorLayers(level,
   { presentation, theme })` with `edit`/`view` (fill opacity 0.8 or 0.95) and
   `INDOOR_COLORS`/`DARK_INDOOR_COLORS`, following mode-watcher in both pages; an optional
   `basemap_style_dark` is chosen when the map is created. `api/recent-uploads.ts`: each
   upload's written and deleted entities (`DataSync`'s `onupload`) kept in localStorage for an
   hour and laid over Overpass answers. `levels/floor-numbering.ts`: `from-0` (G, 1, 2) or
   `from-1` (1, 2, 3; regions US, CA, RU, BY, KZ, CN, JP, KR, TW by the locale's likely
   region), a toggle in the viewer kept in localStorage; `LevelControl` takes `numbering`.
   Left for later: a dark basemap swap while the page is open (the style is chosen once, since
   `setStyle` drops the custom layers). Done in T.

2. **V.2 Discovery.** Count bubbles or a heatmap of indoor features below zoom 16 (indoor=,
   OpenLevelUp).
   Done ✅ (2026-11-11): from zoom 12 to the data zoom, `Overpass.indoorCentres` (rooms, areas
   and corridors as `out ids center`) in zoom-12 tiles through `state/discovery.svelte.ts`
   (`MapLoader` is now generic over what it downloads), drawn by `map/discovery-layer.ts` as
   MapLibre cluster bubbles with counts; `edit/modes/view.ts` opens a bubble on click (zooms to
   where it splits) before browsing.
3. **V.3 Side panel.** Search over names and refs, a room list by level and place details
   (OpenIndoorMaps, OpenLevelUp); rooms coloured by use, counting POIs inside them (a shop node
   in an untagged room). The rule, from osm-simple3d-editor: a room or `indoor=area` with no
   purpose tags takes its colour from the first POI inside it, leaving out doors and
   entrances, and for areas small things (ATMs, vending machines, benches, kiosks);
   corridors never do. Only points on the levels where the room has its floor count, and
   `room=platform` is circulation, so a shop on a platform doesn't tint it (`9cc38ac`,
   `21136c6`). Icons for `emergency=fire_extinguisher|fire_hose|fire_alarm_box|first_aid_kit|
   fire_hydrant` (Maki and Temaki lack the first two) and `amenity=dryer|washing_machine`
   (forum #169). Stations: `indoor=area` + `railway=platform` drawn as a platform, tracks
   inside the building as two rails by `gauge`.
   Done ✅ (2026-11-11): `ui/ViewerPanel.svelte` (open from the start on screens 768 px wide or
   more, a "Places" toggle) with the selected feature's card, a search over names and refs
   (accents and case ignored, numbers sorted as numbers) and the named places on the shown
   level in view, from `view/places.ts`; a click switches level, centres and selects.
   `view/room-use.ts` gives rooms and areas a use (food, shop, toilets, health, education,
   office, worship, service, platform) from their tags or, following the rule above, the
   first point inside on their floor; `IndoorMap.setUses` sets it as feature state and the view
   presentation fills by it (`USE_COLORS`, light and dark). Icons: OsmInEdit's set already had
   `emergency_fire_extinguisher`, `_fire_hose` and `_fire_hydrant`; new SVGs for
   `emergency_fire_alarm_box`, `emergency_first_aid_kit`, `amenity_dryer` and
   `amenity_washing_machine`. Stations: platforms take the platform colour; railway tracks
   (fetched by the viewer's query) carry `@rail-r17` (half the gauge, standard when unknown)
   and the viewer draws their two rails (`indoor-rails-left|right`) instead of a centre line.
   Tracks are drawn wherever they were loaded, not only inside buildings.

### T: One theme, simpler backgrounds — S — done

Asked by the user after V, before 3D.1. The page followed the system, MapLibre's controls stayed
light and the basemap was chosen once.
Done ✅ (2026-11-11): a theme button at the right of the header (`toggleMode`; the system's
until toggled, then remembered by mode-watcher). The OpenFreeMap basemap is hard-coded
(`BASEMAP_STYLES` in `map/backgrounds.ts`, Positron or Dark) and swapped with the theme by
`map/basemap.ts`, which replaces only the basemap's layers and sources around the slots
(`setStyle` would drop the app's layers); MapLibre's controls take the theme's colours in
`app.css`. The Editor Layer Index download is gone: the backgrounds are the map, Esri World
Imagery, Esri World Imagery (Clarity) Beta and a custom tile URL, with an offset in metres as
iD's (nudges of 0.5 m, 5 m with Shift, or typed "east, north"), drawn through the
`offset-tile` protocol in `map/background.ts` (each moved tile drawn from the source tiles it
overlaps). They sit in `ui/BackgroundPane.svelte`, a pane on the right of the map as in iD, and
`state/background.svelte.ts` keeps the choice, the custom URL and each imagery's offset in
localStorage. `basemap_style`, `basemap_style_dark` and `imagery_index_url` left the config.

Dropped: the temporary "view in 3D" link to osm-simple3d-editor (3D is now later). Routing
(a graph from `highway=footway`/`corridor`, doors, stairs and elevators with their levels;
Dijkstra on a heap) is later too, as its own step after the 2D roadmap.

### C: CAD-style precision — L (C.0–C.6) — done

Asked by the user on 2026-11-11: drawing and editing feel like iD (free clicks, Square after
the fact), but indoor mapping needs precision: angles that snap, guides, a grid of a chosen size
and rotation, exact lengths. Research, with what AutoCAD, SketchUp, JOSM, iD,
osm-simple3d-editor and floor-plan apps do: `research/cad-precision.md` in the project files.
Agreed with the user the same day ✔: C comes before 3D, angle snapping is on by default, the
frame follows each building, values are typed without clicking into a field, a units setting,
all of C.0 to C.6.

The idea in one line: a **drawing frame** (origin and rotation, by default the building's main
direction) that the grid, axis locks and angles are measured in; a **snap pipeline** whose
result says what it snapped to, so the map can draw the guide and a label; and **typed values**
for lengths and angles. Drawing aids are never tags and never uploaded.

Each slice agrees its test seams first (`tdd`). Pure parts (frames, constraints, units, the
snap pipeline) go in `edit/precision/` with unit tests from worked examples; e2e tests draw with
typed values and check the osmChange's coordinates within 1 cm (OSM keeps 7 decimals).

0. **C.0 Foundations, no behaviour change — S–M.**
   - `edit/precision/frame.ts`: a `Frame` (origin `Loc`, angle in degrees from east) and
     conversions between positions and metres in the frame (east/north metres around the
     origin, the `local()` that `osm/geometry.ts` keeps private today, made public there).
     Lengths in metres everywhere; Mercator stays for drawing (it is conformal, so angles agree).
   - `buildingFrame(graph, building)`: the main direction of a building outline or a level
     outline, side directions averaged modulo 90° weighted by length (osm-simple3d-editor's
     `local-axes.ts`, ISC, credited), origin at the outline's south-west corner in the frame.
   - `edit/precision/snap.ts` replaces `map/snap.ts`'s single function by a pipeline: providers
     return candidates `{ kind, loc, score, guide? }` (kinds: node, midpoint, segment, plan
     vertex, intersection, angle, axis, extension, perpendicular, parallel, tracking, grid,
     guide), scored by screen distance plus a priority penalty as osm-simple3d-editor does
     (`SNAP_PRIORITY`). Point snaps beat direction constraints; a direction constraint can be
     combined with a line snap (a 90° ray crossing a wall gives the crossing). Today's three
     kinds keep today's order and 8 px, so existing tests pass unchanged.
   - `units/length.ts`: parse `3.2`, `3,2`, `3.2 m`, `320 cm`, `12'6"`, `12 ft 6 in` into
     metres, whatever the setting; format in the setting's units. A units setting (decided ✔):
     metric (metres, to the centimetre) or imperial (feet and inches, to the quarter inch),
     defaulting from the browser locale's likely region (US, Liberia, Myanmar imperial) as
     `floor-numbering.ts` does, kept in localStorage. A bare typed number is in the setting's
     main unit. Only the display and typed input change: C writes no length tags.
   - `map/guide-layer.ts` in the "edit" slot: guide lines (dashed), angle arcs, a snap marker
     whose glyph says the kind, and text labels.
   - `state/precision.svelte.ts`: which snaps are on, angle step, grid settings, kept in
     localStorage; frames and guides per building in IndexedDB (a new store in
     `persist/plan-store.ts`, schema 5).

1. **C.1 Readout and angle snapping — M.** The biggest change in feel for the least code.
   - While drawing a line or area and while dragging a vertex: the length of the side being
     drawn and its angle, next to the pointer ("3.42 m · 90°"), and the lengths of the sides
     next to a dragged vertex. Angles are shown relative to the previous side when there is
     one, else to the frame.
   - Angle snapping: the new side snaps to multiples of the angle step (default 15°; 90° turns
     the snapping into CAD's Ortho) relative to the frame's axes and to the previous side, and
     to 90° from the drawing's first corner (closing a rectangle). Caught within a few degrees
     and a few pixels of the ray, drawn as a dashed ray with the angle.
   - Point snaps (node, side, plan vertex, midpoint: new) still win over angles; where the
     angle ray crosses a side or another ray, that crossing is a snap.
   - Shift held while drawing locks the current direction (SketchUp, osm-simple3d-editor):
     a click on any point then only sets the distance along it. Alt turns all snapping off for
     the moment, as now.
   - A snapping control on the map (a magnet button with a menu of check boxes, remembered):
     angles on or off and the step, and each snap kind. `S` toggles all snapping (free; the
     user had no preference). Angle snapping is on by default (decided ✔).
   - A measurement readout for the selection in the side panel (iD's measurement panel): side
     lengths, area, perimeter.

2. **C.2 Typed lengths and angles — M.**
   - While drawing, after the first corner: digits (and `.` `,` `'` `"` and unit letters) open a
     small input at the pointer, prefilled with nothing. Enter places the next corner at that
     length in the current direction (snapped angle, locked direction, or the pointer's). Tab
     moves to an angle field; `@dx,dy` or `dx;dy` in the frame also works (CAD's relative
     coordinates). Escape clears the input first, then ends the drawing. Backspace edits the
     input while it has text, else takes the last corner back as now.
   - The draw modes' keys take digits before the tool shortcuts (1, 2, 3) do; outside drawing
     the shortcuts stay.
   - A rectangle tool, `4` (after point, line and area on 1, 2, 3; R is Repeat on levels): two corners
     in the frame, or a side and a width (three clicks for a rotated one); typed `4;3` for width
     and depth. It draws an area as the area tool does, so the preset list opens after.

3. **C.3 Grid and frame — M.**
   - A grid drawn in the frame on the shown level: spacing set by the user (default 0.5 m minor
     and 5 m major lines; lines fade out when closer than 8 px on screen, so zooming out never
     draws a carpet), origin and rotation from the frame. Snaps to grid crossings, and to grid
     lines when combined with an angle.
   - The frame: automatic per building (`buildingFrame` of the building under the view's centre
     or of the selection), or set by the user: "Align to this side" on a selected side, a typed
     angle, or two clicks; the origin moved with a click. Kept per building in IndexedDB, never
     in OSM. A floor plan's own rotation is offered as a frame too, so the grid matches the
     plan's module.
   - "Turn the map to the frame" (sets the bearing so the frame's axes are the screen's) and
     back to north.
   - The grid is off by default (`G` shows it); the frame is always on, since angles are
     measured in it. Per building, automatic with an override (decided ✔).

4. **C.4 Inference guides — M–L.** What CAD calls object snap tracking and SketchUp
   inference; most of what users would draw guides for.
   - Extension: a side's line past its ends, after hovering the side (osm-simple3d-editor: 1 s
     to arm, 30 m long, 6 px to catch, gone 4 s after last use).
   - Perpendicular: the foot of the perpendicular from the last corner to a nearby side.
   - Parallel: the new side parallel to a hovered side (SketchUp's magenta).
   - Tracking: hovering a corner for a moment arms it; lines along the frame's axes and its
     sides' directions run through it, and where one crosses the angle ray or another tracking
     line is a snap ("in line with that corner"). A typed number then places a point at that
     distance along the tracked line.
   - Intersections of two sides (corners not yet drawn), and midpoints.
   - All of them drawn with what they mean (dashed line, kind glyph, a short label), and each
     kind on or off in the snapping menu.

5. **C.5 Construction guides and measuring — M.**
   - A measure tool (tape, `M`): two snapped clicks give the distance and angle, shown until the
     next measure.
   - Guides placed by the user: a line through two points, a line parallel to a side at a typed
     offset (SketchUp's tape measure from a side: "the corridor wall is 2.4 m from this one"),
     a line at a typed angle through a point. Snapped to like sides, crossings included. Drawn
     faintly on their level; a list in the snapping menu to hide or clear them.
   - Kept per building and level in IndexedDB, exported with the floor plan file (`plan-io.ts`)
     so a layout can be shared with the plan; never in OSM.

6. **C.6 Precise edits of existing geometry — M–L.** Operations in `edit/operations.ts`, one
   undo step each.
   - Arrow keys nudge the selection while something is selected (0.1 m, Shift 1 m, along the
     screen's directions, as Figma; MapLibre's keyboard panning is off while there is a
     selection, and Escape first). Check the level switcher's arrow keys don't clash.
   - Move, rotate and scale by typed values: drag with the same snapping and readout, or type
     a distance, an angle, or a factor after the first click (osm-simple3d-editor's move, rotate
     and scale tools).
   - Set the length of a selected side (in the measurement readout, or by typing while
     dragging a vertex), keeping its direction and moving the end chosen.
   - Extrude a side (JOSM's extrude): drag a side of an area out perpendicular to itself, or
     move it parallel keeping its neighbours' directions; with a typed distance.
   - Offset a way (parallel copy at a typed distance; an inner-ring mode, already planned in
     P6 for atrium holes, moves here).
   - Square with a chosen frame: square the selection to the frame's axes, not only to itself.

Landed with C.0 and C.1 (2026-11-11): `edit/precision/` (`frame.ts`, `snap.ts` moved from
`map/snap.ts`, `angles.ts`, `feedback.ts`, `measure.ts`), `units/length.ts`,
`map/guide-layer.ts`, `state/precision.svelte.ts` (localStorage), `ui/SnapMenu.svelte`,
`ui/MeasureLabels.svelte` (HTML labels, not map text: the test basemap has no glyphs) and
`ui/MeasurementSection.svelte`. The frame is `outlineFrame` of the level outline or building
under the first corner (`containerAt` from `edit/unmapped-floor.ts`), north elsewhere. The
IndexedDB store for frames and guides waits for C.3, the first slice that saves one. Snap kinds
with a mark: node, midpoint, intersection (a direction line crossing a side or another line),
segment, plan vertex, angle, lock; priority steps of 10 px, so point snaps always win.

Landed with C.2: `edit/precision/typed.ts` (`typeKey`, `parseTyped`, `typedCorner`; the typed
corner is previewed before Enter), `edit/rectangle.ts` and `edit/modes/rectangle.ts` (`4`; Tab
switches two corners / side and width before the second click). A mode that handles a key now
has its default prevented (Tab, quotes, Enter on a focused toolbar button). The side variant's
second corner doesn't join nodes yet.

Landed with C.3: `edit/precision/grid.ts` (`gridLines` in the frame, thinned by
`drawnSpacing` below 8 px; `nearestCrossing`, `nearestGridLines`), grid snaps in `snapAt`
(crossings, and an angle line crossing a grid line, both at the plan-vertex priority),
`map/grid-layer.ts`, `state/frames.svelte.ts` (`Frames`: automatic `outlineFrame`, or set, by
the outline's id) on a `frames` store in plan-store schema 5, and `edit/modes/frame-pick.ts`
("Align to a side" and "Move the origin" click on the map). The frame section sits in the
snapping menu: typed angle, align, origin, each visible plan's angle on the shown level, reset,
turn the map to the frame and north up. The frame in view is the selection's building, else the
map centre's. The grid is drawn only while shown (`G`, kept in the precision settings). Not
done: setting the frame by two clicks (aligning to a side covers it).

Landed with C.4: `edit/precision/inference.ts` (`Inferences`: a side armed after 1 s on it, a
corner after 0.5 s, at most four of each, forgotten 4 s after last use; `hoveredOf`,
`sideDirections`), inferred lines in `snapAt` as `DirectionLine`s with a `kind` (rays with a
`reach` for extensions), and point snaps for the foot of the perpendicular from the last corner
onto a side and for two sides crossing without a node (crossing priority). Guides carry their
kind; the pointer's label names it ("Extension", "Parallel", "Square", "In line with a
corner", "Midpoint", "Intersection"); armed corners get a small ring. Four snapping options:
extensions, parallel and square, in line with corners, where sides cross. Works from the first
corner (extensions and tracking) in the line and area tools; a typed length on a tracking line
is measured from the tracked corner. The rectangle tool and vertex drags don't infer yet. The
bench's pointer move with every snap kind on takes 0.1 ms (target 2 ms). Guides are all drawn
with one dash style; the label by the pointer says the kind.

Landed with C.5: `edit/modes/measure.ts` (`M`, a Ruler button; Tab switches "measure" and
"guide"), `edit/precision/construction.ts` (`parallelAt`, `offsetFrom`, `guideEnds`),
`state/guides.svelte.ts` (`Guides`, saved in plan-store schema 6, `guides` store by id, and in
plan files as an optional `guides` list in `plans.json`; imported guides get new ids),
`map/construction-layer.ts` (faint dashed lines, 2 km each way). Guides snap like sides (a
point on one, where one crosses a side, another guide or a direction line); the snapping
menu shows the level's count and opens the guides pane. A measure is kept until the
next first click, as a side label; the measured line is drawn through `Feedback.lines`. Plan
files are exported only when there is a plan. Then, as users missed that the tool places
guides at all: the tool is "Measure and guide", with a Measure / Guide switch under the
toolbar while it is on (Tab still switches), and `ui/GuidesPane.svelte`, a pane on the right
beside the background's (`MapShell`'s `panes`, one open at a time), lists the level's guides
to recolour (`color`), hide one (`hidden`), delete or find on the map (pointing at one draws it
bold), hides them all or clears the level's, and lists the other levels that have guides. The
first guide placed on a page points at the pane.

Landed with C.6: `actions/transform.ts` (`translateNodes`, `rotateNodes`, `scaleNodes`,
`setSideLength`, `moveSide`: neighbours keep their directions, `offsetWay`: positive inside a
closed way, `squareToFrame`), `edit/modes/transform.ts` (move, rotate, scale, move a side,
parallel copy: clicks or a typed distance, angle or factor, one undo step), six operations
(`Shift+M`, `Shift+R`, `Shift+S`, `E`, `O`, and `Shift+Q` square to the frame; `R` was taken by
Repeat on levels), arrow nudges in browse mode (0.1 m, Shift 1 m, as the screen points;
MapLibre's keyboard handler is off while something is selected; the level switcher's arrows
only act when it has focus), and side lengths typed in the measurements panel. Not done:
JOSM's extrude that adds a new face (moving a side covers the indoor case), a side length
typed while dragging a vertex, offset's inner-ring (atrium hole) mode, and dragging (rather than
clicking) in the move, rotate and scale tools. Nudges are one undo step each.

Added after C (2026-11-12, asked by the user for a building drawn freehand that is all 90° and
45° in reality): `actions/straighten.ts`, two operations on one closed way. **Straighten to
45°** (`A`) turns every side to the nearest 45° step from the building's frame; neighbouring
sides in one direction become one straight run through their middles (weighted by length), and
the corners are where runs cross. **Make symmetric** (`Y`) finds the mirror line along the
frame's axes or diagonals that pairs every corner with a twin (within 1.5 m, or 8% of the
outline's size) and moves each pair halfway to mirror each other. Both move existing nodes only,
so rooms sharing them stay joined, and each is one undo step. Not done: a side picked as the
mirror line, a 90° only variant in the toolbar (the action takes a step of 90), and equal
lengths for sides that should match.

Order inside C: C.0 and C.1 together first (one PR each), then C.2, then C.3; C.4 to C.6 can
be reordered after users have tried C.1–C.3.

Risks: snapping that fights the user is worse than none. Every constraint has a visible guide,
a way to turn it off, and Alt to suspend all; e2e tests draw with real pointer moves so priority
changes show up. The pipeline runs on every pointer move: candidates come from the existing
rbush indexes in 8–12 px around the pointer, and a bench case keeps a pointer move under 2 ms
with 10,000 rooms.

Decided with the user (2026-11-11) ✔: C before 3D; angle snapping on by default with a 15°
step; the frame and grid per building, automatic with an override; typed values without a
field; a units setting (metric or imperial); all of C.0 to C.6; keys chosen here (`S` snapping,
`4` rectangle, `G` grid, `M` measure).

### B: Building mode — M–L (B.0–B.5) — done

Asked by the user on 2026-11-12: building and indoor editing share one editor, so a click near a
facade sometimes selects the building, sometimes a room, a shared vertex or the empty floor, and
every CAD tool sits on the toolbar even when fixing an outline. Research (what the code does,
what osm-simple3d-editor, SketchUp/Figma/AutoCAD, JOSM's indoorhelper and iD do, and the forum's
indoor conventions): `research/building-indoor-mode.md` in the project files. Agreed the same
day ✔: B before P5.4b, W2 and P6, with the defaults below.

Why the editor is ambiguous today: a building outline has no `level`, so its feature has
`@lv = "*"` and is drawn and picked on every level, in the same selectable layers as rooms;
`browseMode.click` takes the first hit within the click tolerance, and `selectFloorAt` turns a
click inside a building into the unmapped floor. Rooms on the facade share the outline's nodes.
Hit priority tweaks can't tell "I'm fixing the outline" from "I'm drawing rooms"; a scope can.

The idea in one line: **two scopes on one engine.** Modes, operations, snapping, frames and the
data model stay as they are; what changes is what is drawn, what a click can pick, and which
tools are offered.

- **Map mode (default), iD-like.** Selectable: buildings, building parts and entrances (IndoorID
  is not a general outdoor editor; other loaded features are drawn for context). Indoor features are drawn faded and are not picked; a click on
  one (or on a building with indoor data) offers "Edit indoor", and a double-click enters the
  building. No level switcher. Tools: point, line, area, Square, delete, copy and paste,
  operations that make sense outside (no split, merge, repeat on levels), node and side
  snapping, angle snapping and the length and angle readout. No grid, frame menu, guides, typed
  lengths, rectangle or measure.
- **Building mode (indoor).** Entered by a double-click on a building, "Edit indoor" in its
  panel, or the URL (`#…&building=w123`, kept both ways like the level). The camera fits the
  building, its whole extent is loaded once, and everything outside it is faded and not picked
  (neighbours stay snap targets, as osm-simple3d-editor's "surroundings", `dc73a08`: a click on
  one shows its tags read-only, a double-click opens it). The outline is a **locked reference**:
  drawn, snapped to, not selected by a plain click; "Edit outline" unlocks it. Selectable: the
  building's indoor features on the shown level, the unmapped floor, doors, entrances and
  points. Tools: all of C (rectangle, typed values, grid, frame, guides, measure, inference,
  transforms), split, merge, repeat on levels, multipolygon. The frame is this building's frame;
  floor plans move here (the Floor plans button leaves map mode). The side panel, with nothing
  selected, shows the building (name, levels, "Done", the surroundings toggle) instead of
  closing. Escape with nothing selected, or Done, leaves and selects the building again.

What a "building" is for B: a `building=*` way or multipolygon with the parts inside it (no
`type=building` relation needed: the forum, #39 and #52, groups an outline with the parts it
contains), a `type=building` relation, or an `indoor=level` outline for indoor data with no
building around it (stations, some malls; osm-simple3d-editor opens such complexes from a map
badge, `e21f61e`). Elsewhere, "Edit indoor here" on the empty map opens a scope around the
indoor features under the pointer. Buildings that touch (a station complex, forum #87) can be
entered together later; B.0 keeps the scope a list of outlines so that stays possible.

Conventions from the forum thread (t/148767, posts 1–169) that B must keep:
- Indoor features belong to a building by **geometry and `level` only**, never by relation
  membership (the abandoned IndoorOSM did that). Scope membership is by position, from
  `validation/outlines.ts`.
- `indoor=level` limits the floor (#113, #114): with one, the floor is only inside it; without,
  the whole building section is floor. `unmappedFloorAt` already does this.
- Indoor edits should not move the shell by accident (#112, #115; osm-simple3d-editor makes
  indoor editing never move outline or part nodes, `769e57c`). With the outline locked, a drag
  of a room vertex shared with the outline is refused with a hint ("Shared with the building
  outline: Edit outline to move it, or Disconnect"). Placing a door on the facade still inserts
  an entrance node into the outline (adding a node doesn't move the shell), and an entrance
  and its floor-plan door stay one node (`c9cbc79`).
- Moving a node shared with another level says so (V.1's pre-check, already done) and
  cross-level connections stay a hint, never an error (t/148649).
- Imagery stays available inside, with the area fill switch (#21, #66).
- Floor plans need the owner's permission to be traced (#140–#146): the import dialog, now in
  building mode, says so (taken from P6).

Slices, each agreeing its test seams first:

0. **B.0 Scope, no UI change — S.** `state/scope.svelte.ts`: `null` or `{ outlines: EntityId[] }`
   with `contains(feature)` by position (`validation/outlines.ts`), `building=` in the URL hash
   both ways (`map/hash.ts`). Unit tests: a room inside, a room across two buildings (in both;
   W already warns), a point on the facade, an `indoor=level` scope, parts without a relation.
   Done ✅ (2026-11-12): the pure part is `edit/scope.ts`: `scopeOf(graph, id)` (a building
   way or multipolygon by its closed outers, a `type=building` relation by its `outline`, else
   its parts, or an `indoor=level` outline; rings and extent), `inScope(graph, scope, id)` (a
   point inside or within 5 cm of a wall; a way with a node strictly inside, or every node
   inside or on a wall, so a neighbour's room against a shared wall stays out and a space
   across two buildings is in both; another building only when wholly inside; a relation by
   its members) and `scopeAt(graph, loc)` (the smallest building holding a position, else the
   smallest level outline, for "Edit indoor here"; it scans the graph, so it is for clicks).
   `state/scope.svelte.ts` (`BuildingScope`, `editor.scope`) keeps the id while its data
   loads and refuses a loaded feature that can't be entered. The hash is
   `#zoom/lat/lon/level&building=w123` (way or relation ids on the server only), read on load
   and on hash edits, written back with the view. Not done: outer rings made of several open
   ways (B.1 can reuse the map features' assembled polygons); `inScope` is per feature with
   no index yet, which B.1 needs before it fades thousands of features.
1. **B.1 Drawing and picking by scope — M.** `IndoorMap.setScope`: in map mode indoor layers
   faded and left out of `selectableLayers`; in building mode features outside faded and left
   out, the outline drawn in a reference layer that is not selectable but still a snap source.
   `selectFloorAt` only in building mode. E2E: the same facade click selects the building in
   map mode and the room in building mode; a click inside a building in map mode never selects
   the unmapped floor.
   Done ✅ (2026-11-12, with the core of B.2): `indoorLayers(level, { scope })` multiplies each
   indoor layer's opacity by `scopeFade` (`FADED_OPACITY` 0.3): on the map everything but
   buildings, parts and entrances (`isMapFeature`) is faded, in a building everything whose
   feature state `inside` isn't set. `IndoorMap.setInside` sets it on the features and their
   bands from `editor.inside`: the building's members (`BuildingScope.members`), or on the map
   the indoor features no building or level outline holds (`BuildingScope.unscoped`, by the
   middle of their extent), which stay unfaded since there is nothing to enter.
   `IndoorMap.hitTest(point, pickable)`: on the map buildings and entrances first, else any
   feature, and a click on an indoor feature enters its building (`scopeFor`) and selects it;
   in a building only its members, never its outline ways (`Scope.ways`, locked; still a snap
   target). The unmapped floor is building mode's only. With the core of B.2: "Edit indoor" on
   a selected building or level outline, a chip "Inside {name}" with Done, and Escape with
   nothing selected leaves (`browseMode`'s `leave`), selecting the building left; entering or
   leaving ends a drawing (`ModeManager.finish`). With areas filled whole (the e2e tests'
   default), a click inside a building on the map picks the building; with iD's partial fill,
   a click on a room's band enters. E2E: `building-mode.spec.ts`; `unmapped-floor.spec.ts`
   opens inside its level outline (`&building=w300`).
   Left for B.2: double-click to enter, fitting the camera and loading the whole building,
   "Edit indoor here" on the empty map, the building panel.
2. **B.2 Enter and leave — S–M.** Double-click and "Edit indoor", "Edit indoor here", fit the
   camera, load the extent (`DataSync` by bbox, as V's viewer does), Done and Escape; leaving
   ends a drawing or tool as a level change does (`Mode.finish`). The building panel.
   Done ✅ (2026-11-15): modes get `doubleClick` (`ModeManager` hands MapLibre's `dblclick`
   over, and a mode that takes it keeps the map from zooming); `browseMode`'s `enter` takes
   the building drawn under a double-click, else the smallest one holding that position
   (`scopeAt`), or a neighbour from inside a building; elsewhere the map zooms as before. "Edit
   indoor here": a click on the empty map inside a building (with iD's partial fill or the
   wireframe) offers it in the chip where "Edit indoor" sits. Entering by a double-click, "Edit
   indoor" or "Edit indoor here" fits the building right of the side panel (a frame later:
   MapLibre stops a camera move started while it handles a double-click); entering by a click
   on a room doesn't move the camera, nor does a link. `DataSync.loadArea` downloads the
   building's extent whatever the zoom, once per entry (tiles already there aren't fetched
   again). With nothing selected, the side panel is `ui/BuildingPanel.svelte`: the name and
   kind, its levels (`levelsIn` the building's extent; a click shows one), "Show surroundings"
   (`BuildingScope.surroundings`: off, the scope look `alone` hides what is outside, and a
   double-click no longer enters a neighbour) and a close button that leaves, as Done does.
   E2E: `building-mode.spec.ts`. Not done: "Edit indoor here" on indoor data that no building
   or level outline holds, or on empty data (a scope with no outline: B.3 needs it before tools
   leave map mode); a click on a neighbour inside a
   building doesn't yet show its tags read-only.
3. **B.3 Two toolbars — M.** `EditorView.svelte` (1,657 lines) splits its controls into
   `MapToolbar` and `BuildingToolbar`; `SnapMenu` shows only what the scope offers; keys of
   tools not offered do nothing (the help lists them per mode). Floor plans move to building
   mode. No change to the modes themselves.
   Done ✅ (2026-11-15): `edit/scope-tools.ts` (`toolsFor("map" | "building")`) says what each
   scope offers; `EditorView` reads it rather than splitting into two components (the toolbar
   is one snippet; a split is left to P6). On the map: point, line and area, operations but
   merge, repeat on levels, move side, offset and square to frame, and node, midpoint and
   angle snapping (`SnapMenu`'s `offered`); typed values are off (`DrawPrecision.typed`), and
   the grid, frames, guides (drawn, snapped to, their pane), floor plans and the level
   switcher (B.5) are hidden. Keys of tools not offered do nothing. "Edit indoor here" is
   offered whenever nothing is selected on the map: the building clicked in, else the
   **loose scope**, the indoor data no building or level outline holds
   (`BuildingScope.loose`, `&building=here` in the hash; entrances are in it too), which
   empty data opens to draw in. E2E tests on empty data open with `INDOOR` from
   `fixtures.ts`, as `selectRoom` does.
4. **B.4 Outline lock — S.** Refused drags of shared outline nodes with the hint; "Edit outline"
   toggles the lock for this visit; entrances inserted into the outline as today.
   Done ✅ (2026-11-15): `BuildingScope.outlineLocked` (locked again on each entry),
   `isLocked` (not picked) and `movesOutline(nodes)`: a press on a vertex of the outline, a
   side between two of its nodes, or a selection with one of its nodes is refused with a note
   (`outline_locked`), and the map pans instead. "Edit outline" is a checkbox in the building
   panel. Operations that move the outline's nodes (Square, move, rotate, scale, move side,
   square to frame, straighten, symmetric, deleting one of its nodes) are refused the same way
   (`OperationContext.locksNodes`, 2026-11-15 audit). With the surroundings hidden, what is
   outside is no longer snapped to either.
5. **B.5 Scoped checks and polish — S.** The issue list and the Save dialog's warnings scoped to
   the building inside (all edits are still uploaded together); the level switcher only in
   building mode; the viewer may reuse "enter a building" later (not in B).
   Done ✅ (2026-11-15): `scopedIssues` (`edit/scope.ts`): inside a building the Save dialog
   lists the building's warnings and every error, and counts the warnings elsewhere; the
   upload still sends every edit. The Inspector's issues were already per feature. The level
   switcher shows in building mode and floor plan mode only (`MapShell`'s `levelSwitcher`).

Existing e2e tests that draw indoor features get an `enterBuilding()` helper in
`tests/e2e/fixtures.ts`; tests on empty data use "Edit indoor here".

Risks: hiding indoor data in map mode could hide what a user came for; the faded features and
"Edit indoor" keep it one click away, and a link with `building=` opens straight inside. A
scope must never filter the upload: what was edited outside the building in this session
(or in an earlier visit) is still sent.

Decided with the user (2026-11-12) ✔: B before P5.4b, W2 and P6; indoor features faded in map
mode, a click offering to enter; `indoor=level` outlines as scopes plus "Edit indoor here";
angle snapping, the readout and Square kept in map mode, the rest of C only inside; the outline
locked inside until "Edit outline"; map mode edits buildings, parts and entrances, not a general
outdoor editor; a URL naming a building opens inside it.

### P5.4b: Rebase before upload, conflicts — M–L — done

After B (decided ✔ 2026-11-12). Done ✅ 2026-11-24:

- **Rebase before every upload** (`actions/rebase.ts`, run by `DataSync.upload`): the current
  versions of what the upload touches are fetched first (`idsToCheck`: modified and deleted
  entities, and the downloaded nodes and members that uploaded ways and relations use) with
  `OsmApi.loadEntities` (the API's multi-fetch, `/nodes.json?nodes=…`, 150 ids a request, four
  at a time; deleted ones come back with `visible: false`). `rebase` merges three ways from the
  version downloaded: tags key by key, a node's position and a way's nodes from the side that
  changed them, relation members added and removed on both sides (a reorder clashes). The
  server's versions go under the edits (`History.rebase`) and the merge is one undo step,
  "Merge changes from OpenStreetMap". Nodes their version of a way uses that weren't
  downloaded are fetched with it (`missingChildren`). When their changes were all the user's
  too, nothing is sent ("up-to-date").
- **Conflicts** (iD's `actionMergeRemoteChanges` as the model): a tag or shape both changed
  differently, a feature they deleted and the user edited (or the reverse), or a node they
  deleted that an edited way still uses. Nothing is uploaded while one is left: the Save dialog
  lists them with who made the server's version, and "Keep mine" or "Take theirs" each (or all).
  The side chosen wins only what clashes, the other's other changes are kept (iD's
  `force_local`/`force_remote`). Keeping a feature they deleted sends it at the deleted
  version, which restores it; taking their deletion removes it from the ways using it. The
  upload is then made again, and checks again.
- `Graph`: `revert(id)` drops a local edit; a local copy with another version than the server
  data is a change even with the same content (that's how a restore is sent);
  `withBaseEntities(entities, removed)`.
- 409, 410 and 412 answers name their entities (`namedEntities`, `OsmApiError.entities`) and
  the dialog says which; 410 is its own kind (`gone`). Every API read is `cache: "no-store"`
  (osm-simple3d-editor issue #47).
- After an upload, what it wrote is last edited by the uploader, now (`applyDiffResult`'s
  `Uploader`), so the viewer's card and the Inspector say so before the next download.
- Not done: never deleting a way still in a relation outside the edit needs nothing more, since
  deletions are `if-unused` (the server keeps it and says so); a warning after a restore of
  edits based on older versions, and `MapLoader.invalidate`, left for later (see the plan).

### W2: Wiki conformance from the November research — S–M — done

From the osm-simple3d-editor research addenda (2026-11-05 and B, 2026-11-11). Done ✅ 2026-11-24:

- New rules in `validation/conformance.ts`, run by `validate()`:
  - **Escalators** (`highway=steps` + `conveying=*`, lines; osm-simple3d-editor's
    `validateEscalators`): both end levels in `level` (`escalator-levels`); `incline=up|down`
    (`flight-incline`, also for stairs whose `level` lists two levels or more, not for steps
    on one level or outdoors); two points only (`escalator-shape`); each end, by the incline,
    inside a room, area, corridor or level outline of its level (`escalator-end`, skipped where
    no indoor space is mapped at all). No fixes: which way is up isn't known.
  - **Flights over three or more levels** (`flight-over-levels`, `602503d`): `highway=steps`
    or an escalator, not a stairwell (`stairs=yes`, `room=stairs`), which spans every floor.
    An area is fixed by `actions/split-levels.ts` `onePerLevelPair` (copies sharing its
    nodes, `0;1`, `1;2`…); a line gets no fix, as each flight has to be drawn.
  - `room=reception` without `amenity=reception_desk`, `room=dressing` without
    `amenity=dressing_room` (`room-amenity`, fix adds it). `room=service|technical` left
    alone: on 2026-11-24 Key:room neither lists them nor marks them deprecated, and doesn't
    say to use `room=utility` instead.
  - **Slivers** (`sliver`): a room, area, corridor, level outline, column or wall area whose
    mean width (2 · area / perimeter) is under 5 cm and under a tenth of its half perimeter
    (`bc06c32`): a 6 × 6 cm post or a 50 m × 15 cm wall isn't one. No fix.
  - **Small level outlines** (`small-level-outline`, forum #114): an `indoor=level` way under
    half the area of the smallest building around its centre, or, when the building has
    parts, of the parts whose `building:levels` (from `building:min_level`) reach its levels.
    `Outlines` now indexes building parts (`Outline.part`; `almost-joined` leaves them out,
    as before).
  - `railway=platform` inside a building without a level (`platform-no-level`, fix `level=0`;
    an `indoor=*` platform is left to `missing-level`).
  - **Duplicate nodes** (`duplicate-node`, forum #139): a corner of an indoor outline, building
    or part within 1 cm of a corner of another on an overlapping level (a building or part
    counts as level 0), not joined; reported once per pair, fix "Merge them". Copies of a room
    on other levels keep their own nodes.
- Upgrades: `indoor=room|area` + `room=column` → `indoor=column` (`831fc28`).
- `entrance-inside` now covers any `entrance=*` other than `no`, and an entrance on the
  `indoor=level` outline of its own level (a skybridge's) or on a building's own ring (also a
  courtyard's inner ring, tags on the relation or on the outer way) is on an outer wall.
- `issue_door_on_wall_area` says what the approved
  [Proposal:Allow area=yes for indoor=wall](https://wiki.openstreetmap.org/wiki/Proposal:Allow_area%3Dyes_for_indoor%3Dwall)
  asks: a door in a wall area must also be on a room's outline. Still flagged, never cut. Tests
  that a closed `indoor=wall` without `area=yes` stays a line (no door issue) and that a door
  also on a room's outline passes.
- `building:part` + `indoor=*` (other than `no`) is drawn as indoor on its level, not as a
  building part (`classify.ts`); `building-part-indoor` still warns.
- `listLevels` moved to `levels/levels.ts`.

### W3: Checks from the 2026-11-24 recheck — S–M — done

From research addendum C (forum t/148767 posts 170–215, osm-simple3d-editor `02c2bfd` →
`a547bee`). Done ✅ 2026-11-24:

- Indoor rules in `validation/recheck.ts`:
  - **Wall drawn twice** (`wall-twice`, `ea67cb1`): an `indoor=wall` line (no `area=yes`) whose
    points and side midpoints all lie within 5 cm of a wall area's outline (`area=yes` way or
    `indoor=wall` multipolygon) on overlapping levels. The area is found through a shared
    node, as drawing along a wall snaps to it; a copy drawn with no shared node isn't found.
    The fix removes the line's wall keys (`indoor`, `level`, `repeat_on`, `wall`, `height`,
    `min_height`, `material`, `colour`), deleting it when nothing else is left.
  - **Jitter** (`jitter`, osm-simple3d-editor's `jitterVertices`): corners of a room, area,
    corridor, level, column or wall area standing off a straight side by under 3 cm, next to a
    side under 12 cm; greedy, smallest deviation first, three corners kept. Corners that are
    tagged, shared or in a relation are never candidates, so the fix ("Remove them") only
    deletes nodes nothing else uses.
  - **Door on a side** (`door-on-side`, `fe416c4`): a door, `indoor=door` or entrance within
    20 cm of a side of a room, corridor, area or level outline on its level, or of a building's
    outline (as level 0), without being in it; the fix is `almost-joined`'s (`joinFix`, now
    exported from `spatial.ts`). Only entrances and doors on no way are checked against a
    building's outline: an indoor door on a room drawn just inside the outer wall isn't meant
    to be in it.
- Building rules for map mode in `validation/buildings.ts` (`findOverlaps`, forum #192–194),
  on building ways (not roofs, buildings under construction, underground or raised ones, nor
  pairs on different `layer`s); intersections by `polyclip-ts` in local metres:
  - `building-overlap`: an intersection of at least 2 m² and 0.6 m mean thickness, on both.
  - `building-inside`: 90% of the smaller building inside the larger, on the smaller only;
    fix `building=*` → `building:part=*`.
  - `unglued-wall`: when they don't overlap that much, corners within 15 cm of the other's
    wall that aren't on one of its corners; one issue per neighbour, fix joins them all.
- The `Validator` now also forgets the ways joined to a changed way, since `wall-twice` and
  `jitter` depend on them.
- **Pre-upload check** (`osm/upload-check.ts`, `89b17a3`), run by `DataSync` after the rebase and
  before `OsmApi.upload` opens a changeset: an element twice, a way or relation using an
  element deleted in the upload or a new one never created, a way under two nodes, a node
  twice in a row, a new untagged way no relation holds (`43c1025`), and a deleted element an
  unedited way or relation still uses. Refused with `upload_check_failed` naming the first
  three. Tests: a deleted way's nodes shared with a neighbour edited only in its tags stay and
  aren't in the osmChange (osm-simple3d-editor #86, #87).
- Not copied, with a test for the first: the `indoor-door` check asking outdoor entrances for
  `indoor=door` + `level=0` (forum #204); `wall=counter`; guessing level counts.
- Not done: the background run of the upload check every 10 edits (`9ed266f`): the check is
  cheap at upload time, and the validator already shows what it can fix.

### P6.1: Recheck items from the 2026-11-24 research — S — done

The four P6 items research addendum C added (osm-simple3d-editor `02c2bfd` → `a547bee`, forum
t/148767 #176, #198). Done ✅ 2026-11-24:

- **Repeat on levels** (`27d4a4d`): `currentRepeat` offers "One feature on several levels"
  (`level=0;1;2`) first for walls and columns (`indoor=wall|column`, `man_made=pillar`,
  `building:part=column`) that have no copies yet; rooms and the rest still default to a copy
  on each level, and a wall already copied keeps showing its copies.
- **Indoor fences** (`094fc0a`, #198): `barrier=fence` with `level`, `repeat_on` or `indoor=*`
  is the kind `railing`, drawn in the wall colour, thinner than a wall (0.4 px at z17 to 2 px
  at z22). A closed one is a line, never an area (`isArea`). A gate or turnstile
  (`barrier=gate|turnstile|full-height_turnstile|swing_gate|lift_gate|sliding_gate|wicket_gate|entrance`)
  is drawn as a door when it is indoors by its tags, or a vertex of an indoor fence (it then
  takes the fence's levels, as a door takes its wall's); outdoors it stays a point of
  interest. The point tool on an indoor fence adds `barrier=gate`, which the user can retype
  as a turnstile ("Add a gate").
- **Entrance labels in the viewer** (`a58c319`): `entranceLabel` gives an entrance its name,
  else its `ref` over its `addr:flats` (`1-36;40` shown as `1–36, 40`), as the feature
  property `@entrance`; the viewer's labels prefer it, the editor keeps `name`/`ref`. Not
  done: predicting flats from neighbouring entrances (`9ddc842`).
- **Which building indoor data belongs to** (`1d64ad6`): `inScope` keeps a way with every
  node inside or on a wall, or with at least as many nodes strictly inside as outside (nodes
  on a wall count for neither): a platform with one corner in a station is no longer the
  station's, a space split evenly across two buildings is still in both. `scopeFor` (entering
  from a click in map mode) picks, of the scopes holding the feature, the one with most of its
  corners strictly inside, then the smallest; buildings before level outlines. It scans the
  loaded ways once instead of once per corner.

### P6.2: Editing left over from P5.3 — S–M — done

Done ✅ 2026-11-24:

- **Right-click menu**: `Mode.contextMenu`, handed MapLibre's `contextmenu` by `ModeManager`
  (not at the end of a right-drag); browse mode selects the feature under the pointer unless
  it is already selected (a vertex first) and opens the operations of the toolbar in a
  `DropdownMenu` anchored at the click (`EditorView`, `openMenu`). On the empty map, no menu.
- **Validation in idle time**: `state/idle-issues.svelte.ts` (`IdleIssues`) runs
  `Editor.editIssues` in `requestIdleCallback` (1 s timeout; a 200 ms timer where there is
  none) after each change of the graph, a newer change replacing a check still waiting; the
  last issues stay shown until the next check. A button beside Save shows their count
  ("1 issue in your edits") and opens the save dialog that lists them.
- **A multipolygon left with one outer way** (osm-simple3d-editor does it before upload): done
  at the edit instead, so the upload stays exactly what was edited. `unwrapLoneOuter` after
  `deleteEntities` and `removeMembers`: a multipolygon left with one closed outer way and no
  hole gives that way its tags (but `type`) and is deleted, unless the way has tags of its own,
  belongs to another relation, or the relation is a member of one.
- **Removing a way's last vertices deletes the way**: already so since P5.3 (`deleteEntities`:
  a line left with one node, an area with fewer than three corners, goes with its untagged
  nodes; a drawing stops once its last corner is taken back).
- **Tracing along outlines** (osm-simple3d-editor's deferred "tracing along existing edges", as
  QGIS): `T` while drawing a line or area (`PrecisionSettings.tracing`, saved, off by
  default: a dividing wall from corner to corner of a room would otherwise run round it). A
  click on a node after a corner on a node puts in the nodes between them along the ways on
  the shown level or with no level (`edit/trace.ts`, `tracePath`: Dijkstra in metres, nodes
  visited as reached, at most 5,000); closing an area on its first corner traces too.
  Backspace takes the traced nodes back with the click.

### P6.3: Cut out of the level outline — S — done

Done ✅ 2026-11-24 (osm-simple3d-editor `6e898c1`): the operation "Cut out of the level outline"
(`Shift+H`, building mode only) on one closed way drawn inside the `indoor=level` outline of the
shown level (a way, or a multipolygon's outer ring; the smallest when several hold it). The
outline becomes a multipolygon with the way as its hole, or gets one more hole, through
`makeMultipolygon` (the hole loses the `level` and `area=yes` the drawing gave it); the
outline's multipolygon is selected after. `actions/cut-out.ts` (`levelOutlineAround`,
`cutOutOfLevel`). It is the quick way to draw the atriums and voids 3D.3 reads.

### P6.4: Shortcuts help, help page, indoor= preview — S–M — done

Done ✅ 2026-11-24:

- **Keymap** (`edit/keymap.ts`): the map's keys (`MAP_KEYS`, run by `EditorView` through
  `MAP_ACTIONS`), a drawing's (`DRAWING_KEYS`) and the selection's (from `OPERATIONS`) in one
  place; a test checks every operation and map key is listed and no map key takes an
  operation's combo. `ui/ShortcutsDialog.svelte` lists them, opened by `?` or the keyboard
  button in the toolbar.
- **Help page** (`/help`, `ui/HelpPage.svelte`, "Help" in the header): getting started, the
  viewer, building mode, drawing, precision, floor plans, tagging, checking and uploading.
  English only; the UI strings around it go through `msg()`.
- **Preview in indoor=** (`view/indoor-equal.ts`): the building panel's button opens
  indoorequal.org and, once that tab says `{ event: "ready" }`, sends the building's features
  (their tags and `id`, edits included, from `draftOf`) as `{ command: "preview", file }`, then
  the level and the building's extent, per indoor='s README ("Remote Command API"). Unlike the
  README's example, only messages from that tab at `https://indoorequal.org` are taken, and
  messages are sent to that origin only. A blocked pop-up shows a note. The GeoJSON format
  indoor= expects isn't documented: OSM tags as properties is what its own files carry.
- **README**: a "Using IndoorID" section pointing to the editor, the viewer and `/help`.

### P6.5: Reach — userscript, read-only JOSM source — S–M — done

Done ✅ 2026-11-24:

- **Userscript** (`static/indoorid.user.js`, served at `/indoorid.user.js` and linked from the
  help page's "From other tools"): adds "Open in IndoorID" to openstreetmap.org's Edit menu (a
  floating button if the menu isn't found), and a button to OSMCha's changeset pages (the
  changeset's bounding box from the OSM API, asked before the click so the new tab isn't taken
  for a pop-up) and to indoor= (its `map=` and `level=` hash). IndoorID isn't hosted at a fixed
  address yet, so the script asks for it once from the manager's menu (`GM_setValue`;
  `localStorage` without a manager) and defaults to `http://localhost:5173/`; the help page
  shows the running copy's address. Zooms under 17 open at 17, where data downloads. Its link
  helpers are tested by evaluating the script in Vitest (`reach/userscript.test.ts`); e2e
  checks the Edit menu entry on a stand-in page.
- **`?source=josm`** (`api/josm.ts`, `osm/osm-xml.ts`): JOSM's active layer, unsaved edits
  included, from Remote Control's `GET http://127.0.0.1:8111/export` (JOSM r19425, July 2025;
  answers `.osm` XML with `Access-Control-Allow-Origin: *`; off until "Export data from JOSM"
  is allowed). `JosmSource` is a `SyncApi`: the layer is read once and handed whole to the
  first tile asked for (the loader uses one zoom-0 tile, from any zoom); `upload` throws
  `josm_read_only`, and Save is disabled. Deleted features (`action="delete"`,
  `visible="false"`) are left out; JOSM's new features keep their negative ids, and
  `graph.newId` already counts below them. A banner says the data is JOSM's, or why it can't
  be read (not running, permission off: 403, too old: 400, no data layer: empty answer), with
  "Load again" (a page reload: data read again would clash with what is already in the graph).
  With no place in the link the camera fits the layer. Autosave is off in this mode.
  Not done: JOSM's unsaved changes aren't highlighted as edits (they load as server data).

### P6.6: Translations — M — done (machinery)

Done ✅ 2026-11-24:

- **Paraglide 3** (`@inlang/paraglide-js` 3.2.2), as planned and confirmed on a decision card
  after the trade-offs were raised: Paraglide bundles every locale's messages into the build
  (per-locale builds are experimental and don't work with SvelteKit yet), and compiling
  downloads its message-format plugin from jsDelivr (`project.inlang/settings.json`, pinned at
  4.6.1). `bun run messages` (also on install) runs `paraglide-js compile` into the gitignored
  `src/lib/i18n/paraglide/` (locale modules; strategy `localStorage`, `preferredLanguage`,
  `baseLocale`). The `msg()`/`t()` seam stays: `msg` is typed from Paraglide's message
  functions (`scripts/build-messages.ts` is gone), `t` calls `m[key](params)`; every message
  is used, so looking them up by key costs nothing. A message missing from a translation is
  Paraglide's English. `i18n/locale.ts`: `<html lang>` set from `+layout.ts`, the language
  menu's names (`Intl.DisplayNames`), `setLocale` reloading the page (edits are autosaved).
  `i18n/locales.ts` checks every translation's keys and params against English (unit test).
- **Plurals** as message variants (`Intl.PluralRules` through Paraglide): `issue_count`,
  `save_features_changed`, `load_failed`, `restore_description`. The restore dialog now says
  "1 feature changed".
- **Strings moved to messages**: about 260 hard-coded English strings in components (the
  toolbar, the inspectors, fields, floor plan panels, dialogs, the map's load status); 672
  messages in all. The help page stays English. e2e tests find controls by the same English
  names.
- **Feature types and fields** from iD's tagging schema translations: `build-presets.ts` writes
  `generated/translations/{locale}.json` for each locale in the inlang settings (what was kept:
  preset names, aliases and terms; field labels, placeholders, options, access rows, address
  parts; category names), loaded with the presets in that language (`presets/localize.ts`); a
  preset is still found by its English name.
- **Dates**: relative times and the restore dialog's date in the language.
- **Seeded translations**: OsmInEdit's locale files share only four strings with IndoorID's
  (Help, Background, Done, Building): those are in. `measure_area` matched "Area" but OsmInEdit
  meant the feature type (fr "Zone"), not the measure, so it was left out. The rest is for
  translators.

### P6.7: Release checklist and announcement — S — done

Done ✅ 2026-11-24:

- **Checklist** ([release-0.1.md](release-0.1.md)): the features 0.1 alpha ships with, each
  next to the e2e test that shows it, and the manual checks tests can't reach (a real OSM
  login and upload, a real JOSM, a userscript manager, indoor=, Firefox and Safari).
  `src/lib/release-checklist.test.ts` fails when a named test no longer exists.
- **Announcement draft** ([announcement-0.1.md](announcement-0.1.md)) for the community forum,
  as a new editor (OsmInEdit named as its origin and in the credits). Not posted: the hosted
  address and screenshots are still to fill in, and posting is the maintainer's call.

## I: iD's area fill, colours and safeguards (November 2026)

Asked by the user after C: large areas filled whole hid the imagery, and work inside an area kept
selecting it. Done ✅: areas are filled as iD's default **partial fill** (`css/70_fills.css`): a
band inside the outline (`indoor-fill-band`), 10 px inside indoor features and 30 px inside
buildings from z19, half that at z17. It was first an inset line (`line-offset`), which
overlapped itself in corners (darker wedges and blobs) and spiked out of sharp ones; iD clips a
wide stroke to the area instead, which MapLibre can't. The band is now built as a shape
(`map/area-bands.ts`): the area minus the area shrunk by the band's width with round corners
(Clipper2's offset, `clipper2-ts`; `clipper2-js` 1.2.4 offset squares wrongly), per half zoom
step, for the areas in and around the view only, cached per area (`BandStore`), and drawn as
one fill from its own source (`osm-bands`). 1000 L-shaped rooms take about 80 ms. Wireframe (outlines only, 1 px) and full fill are chosen in the background
pane (`BackgroundSettings.areaFill`, saved as `indoorid.area-fill`); W toggles the wireframe.
Unless areas are filled whole, a click picks an area by its band or outline only
(`selectableLayers`, and area labels don't count), as iD's `pointer-events: visibleStroke`.
The viewer still fills areas whole. Editor colours come from iD's stylesheet
(`style/colors.ts`, `EditColors`): grey outlines with white bands on dark maps, its building
red, the platform tan for open spaces, the steps green for stairs and elevators, iD's footway,
corridor and steps line colours; the light map darkens the greys and strengthens the bands.
iD's `too_large` guard (`edit/visibility.ts`): moving, rotating, scaling, squaring,
disconnecting, nudging or deleting is refused while less than 80% of the selection's extent is
in view, and a press on a large selected area pans instead. Small iD shortcuts with it: Z zooms
to the selection, Mod+B swaps back to the previous background. E2E tests fill areas whole
(`fixtures.ts`) except `area-fill.spec.ts`.

Then, picked by the user from iD's other features: **Highlight changes** (a checkbox under the
area fill, saved as `indoorid.highlight-edits`): `map/edited.ts` tells added, retagged and
reshaped features apart (a way whose untagged nodes moved is reshaped), drawn as iD's 16 px
halo in its green, yellow and orange through the feature state `edited`
(`IndoorMap.setEdited`). **Labels hide near the pointer** (30 px, any mode, during drags too):
`ModeManager`'s `onpointer` feeds `IndoorMap.hideLabelsNear`, which sets the feature state
`nearPointer` read by the labels' `text-opacity`; icons stay. **Imagery display**:
brightness, contrast and saturation sliders (25–200%, for the page only, as iD), through
`displayPaint` (MapLibre's `raster-brightness-*`, `raster-contrast`, `raster-saturation`).
**Drag to move the imagery** (iD's offset pad): the imagery follows a quarter of the pointer's
moves, applied every 120 ms; `setBackground` now keeps the imagery shown under the new one
until the new tiles are in (numbered layers), so moving the offset no longer flashes the map.

## A: Accessibility and layout, from the 2026-11-24 audit (November 2026)

Agreed with the user on 2026-11-24 and 2026-11-25 ✔ ([audit-2026-11-24.md](audit-2026-11-24.md),
its "Decisions (25 November)"). Scope: good practice with WCAG 2.2 AA's 3:1 (graphics, states)
and 4.5:1 (text) as the yardstick, no new features, the editor desktop only, the viewer also on
a phone. Done ✅ 2026-11-25 in seven stacked PRs:

- **A.1 Theme tokens** (#60): `--ring` 0.45/0.70 drawn at full strength (an unlayered
  `:focus-visible` rule), `--input` 0.70/35% white, `--muted-foreground` 0.50, a `--pressed`
  token on `[aria-pressed=true]` and toggles that are on (was 1.09:1 light, 1.31:1 dark against
  their neighbours), a blue `--mode` for building mode, `--warning` for the issues button's
  yellow triangle beside the red octagon of errors. `tests/e2e/a11y.spec.ts` measures pressed
  tools, the selected level and the focus ring at 3:1 or more, as the browser resolves the
  colours (canvas, so oklch and alpha count), in both themes.
- **A.2 Layout** (#61): the header holds place search, Save, Issues and "?" (`HeaderSlots`,
  `ui/header.svelte.ts`); the right column is Background, Floor plans (moved from the side
  panel into a 320 px pane, so plans and the inspector can be open together), Guides, Map data
  and the level switcher; building-only tools show disabled outside a building with their
  reason; Measure/Guide is a split button. Building mode: a blue bar at the bottom middle
  ("Leave building", Esc), a 3 px frame, a breadcrumb and a hint the first 3 times. One bottom
  stack for the mode bar, load status and hints (`StatusPill`). A bits-ui radio item didn't
  close its menu when its choice re-rendered the toolbar: the measure menu closes itself.
- **A.3 Selection bar** (#62): six labelled actions, More and Transform menus, Zoom to
  selection; the right-click menu grouped the same way, opening upward near the bottom. The
  grouping is data (`groupOperations`); split joined `OPERATIONS`.
- **A.4 Map data** (#63): area fill and Highlight changes moved out of Background into a Map
  data pane with the selection, grid and new-guide colours (`state/appearance.svelte.ts`,
  `indoorid.appearance`). New defaults on the light map: the selection blue `#1d4ed8` over a
  white casing (was amber, 1.8:1), the grid slate at 70%/100% (was the guides' magenta,
  1.2–1.7:1), changes in their own colour and line style (added solid green, retagged dashed
  purple, reshaped dotted orange; iD's halo was 1.05–2.1:1 and alike under deuteranopia), iD's
  halo kept as an option. Background hides the imagery settings without imagery.
- **A.5 Inspector and levels** (#65): Level first for every feature that may have one
  (`fieldList`; values of fields without options no longer in monospace), the switcher shows
  the level once and, in a building, all its levels whatever is in view; Measurements starts
  open (sections already remembered their state); presets without an icon get a placeholder.
- **A.6 Keyboard and semantics** (#66): toolbars with roving focus (`ui/roving.ts`), skip links
  (a `skips` header slot), the map after the side panel and tools in the DOM, page titles
  ("Edit · {building} · IndoorID"), the help page's `h1`, reduced motion (MapLibre already
  skips camera animations without `essential`), Undo/Redo tooltips naming the step
  (`EditHistory.undoLabel`), PageUp/PageDown (`LEVEL_KEYS`), a search in the shortcuts dialog.
- **A.7 Viewer on phones**: below `sm` the header drops the version, puts the pages and
  Licenses in a menu and the search behind an icon that opens over the header; the places panel
  is a sheet on the bottom half; the floor numbering chips are labelled; the tools column
  leaves less room for the right column on a phone, so it no longer runs under Background.

Dropped on 2026-11-25 ✔: the command palette, the status bar, vertex and label size settings,
floor plan tint, basemap dimming, UI density, a high-contrast mode (A.1 covers it), recent tags,
the first-run tour, saved views per building, the undo history list, default units from the
map's country.
