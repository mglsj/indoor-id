# IndoorID rewrite plan

A client-only indoor editor for OpenStreetMap ([Simple Indoor Tagging](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging)),
rewritten from OsmInEdit 1.0.16 (React 16, Leaflet, 2019). Legacy code: commit `cd1e955`
(`git show cd1e955:<path>`), to be tagged `legacy-v1.0.16`.

## Goals

1. **Fast map.** Smooth panning and zooming with thousands of indoor features; switching level
   in under 50 ms.
2. **Easy floor plan alignment.** Import PNG/JPG/WebP, PDF and SVG plans and place them with
   control points or a known distance instead of dragging corners.
3. **Up-to-date tagging.** Presets and validation that follow the current OSM wiki, with
   one-click upgrades of deprecated tags.
4. **Safe uploads.** What gets uploaded is exactly what the user edited, sent in one atomic
   changeset.

## Status

| Phase | Scope                                      | Status      |
| ----- | ------------------------------------------ | ----------- |
| P0    | Scaffold, tooling, map, URL hash           | Done        |
| P1    | Core data model (no UI)                    | Done        |
| P2    | Fast read-only viewer                      | Done        |
| P3    | Presets, validation, upload                | Done        |
| P4    | Floor plans                                | Done        |
| P4.1  | Floor plan layers, edit sessions, align UX | Done        |
| P5.0–2 | Quick fixes, feature editor, fast core    | Done        |
| R0    | Fixes and fast feedback (review)           | Done        |
| R1    | Foundations for editing (review)           | Done        |
| R2    | Floor plan content model (review)          | Done        |
| P4.2  | Vector and light raster floor plans        | Done        |
| P5.3  | Geometry editing                           | Not started |
| P5.4  | Autosave and conflicts                     | Not started |
| P6    | Parity and polish                          | Not started |

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

## Stack

| Area        | Choice                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------- |
| Tooling     | Bun 1.4 (package manager, scripts), Node 24+, Biome 2.5 (format + lint), GitHub Actions          |
| App         | SvelteKit 3 + `adapter-static`, every route `ssr = false` / `prerender = true`; Svelte 5 runes; TypeScript 6 strict |
| Map         | MapLibre GL JS 6 (WebGL), imported only via `#lib/map/maplibre.ts`                              |
| UI          | Tailwind CSS 4, shadcn-svelte components (vega style, on bits-ui 2), `@lucide/svelte`           |
| Editing     | Custom engine modelled on iD's modes and behaviours, `rbush` spatial index, `@turf/*` v7        |
| OSM         | `osm-auth` 3 (OAuth 2 PKCE, no secret, no backend); small `fetch` client for the API v0.6      |
| Presets     | `@openstreetmap/id-tagging-schema` filtered at build time, plus a local indoor overlay; `fuse.js` |
| Storage     | IndexedDB via `idb` (floor plans, autosaved edits, settings)                                    |
| Floor plans | `pdfjs-dist` (lazy loaded); MapLibre `image` source with `setWarp("perspective")`               |
| i18n        | Paraglide (key/value JSON, compatible with Transifex)                                           |
| Tests       | Vitest (unit), Playwright 1.56.1 (e2e, matches the preinstalled Chromium)                       |

Decisions already discussed:

- **SvelteKit, not a bare Vite SPA:** static output either way; Kit adds routes (OAuth callback,
  help), `$app/*` helpers and conventions.
- **osm-auth, not Better Auth:** users must sign in to openstreetmap.org and their edits are
  attributed to their OSM account. Better Auth needs our own server and database and would hold
  every user's OSM write token. Revisit only if a backend is added (e.g. shared floor plan
  libraries); `lib/api/auth.ts` stays behind a small interface.
- **Custom editing engine, not terra-draw:** OSM topology needs shared nodes (walls between
  rooms, doors on walls), which terra-draw doesn't model. Every gesture becomes a graph action,
  so the upload is exactly what the user did.

## Architecture

```
src/lib/
  osm/         entity, graph, history, difference, osmchange, diffresult, parse-json, geometry, tags
  actions/     add-node, move-node, add-way, add-vertex, delete, change-tags, orthogonalize,
               copy-level, copy-paste, join-node-to-way
  levels/      parse, format, feature-levels, building-levels
  api/         http, auth, map-loader (tile-grid cache), changeset, conflicts, nominatim
  presets/     load, match, search, fields, recent, overlay/indoor.json
  validation/  rules/*, upgrades (deprecated tag → one-click fix)
  map/         maplibre (entry point), hash, sources (graph → GeoJSON), style/*, imagery/*
  edit/        mode-manager, modes/{browse,select,draw-*,drag-node,floorplan,floorplan-tool},
               drag, keys (R1)
  floorplans/  import, plan-io (R2), georef, tiling, plan-file, vector extraction (P4.2)
  persist/     plan-store, autosave (P5.4)
  state/       history, selection, data sync, catalog, validator (R1 split of editor.svelte.ts),
               session.svelte.ts, floorplans.svelte.ts
  map/         layer-slots (R1), snap (P5.3), plan WebGL layer (P4.2)
  ui/          components, one headless Combobox (R1)
```

- **Pure modules** (`osm`, `levels`, `actions`, `presets`, `validation`, `floorplans/georef`)
  have no DOM or Svelte dependency and carry most of the unit tests. Enforce with Biome
  `noRestrictedImports` overrides once these modules exist.
- **Data model (iD-like):** immutable nodes, ways and relations keyed by id (`n12`, `w-3`); a
  graph holds base (server) entities plus local changes, with parent-way and parent-relation
  indexes; history is a stack of graphs, so undo/redo is replacing a reference. Stored in
  `$state.raw`.
- **Upload:** the osmChange is the difference between base and head graphs. Order: create nodes,
  ways, relations; modify; delete relations, ways, nodes with `if-unused`. One request to
  `/changeset/{id}/upload`; ids and versions remapped from the diffResult (integer compare).
  Warn above 10k changes.
- **Re-download merge:** same version → skip; newer on server and untouched locally → replace;
  newer on server and edited locally → conflict.
- **Map sources:** one GeoJSON source with `promoteId: "id"`; each feature carries `_lv`
  (`";-1;0;0.5;"`), and layers filter on it, so a level switch is a `setFilter`, not a data
  rebuild. Edits push `updateData()` with only the changed features; dragging updates a small
  overlay source and commits on pointer up.

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

### P5: Feature editor, fast core, geometry editing — P5.0 to P5.2 done

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

## Roadmap from here (agreed with the user ✔)

Order: fix what's broken and make tests fast (R0), lay the foundations that editing and plans
share (R1), move floor plans to a content model (R2), then the features: vector and light
raster plans (P4.2), geometry editing (P5.3), autosave and conflicts (P5.4), parity (P6).
Vector plans come before editing so that drawing can snap to plan walls from the start. Each
slice still agrees its test seams first.

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

### P5.3: Geometry editing — L

On R1's modes, drag, selection and geometry. Slices:

1. Edit overlay: vertices and midpoints of the selected and hovered ways (and shared
   vertices from zoom 18), untagged member ways as thin lines; the drag preview lives here.
2. Snapping (`map/snap.ts`): node, then segment, then plan vertex, on the shown level, 8 px.
3. Drag a node (moves every way using it), committed on release in one step.
4. Draw point, line and area, tagged with the shown level; add a vertex at a midpoint
   (in every way sharing the segment).
5. Operations: delete with cleanup, door on a wall, orthogonalize (iD's current action),
   copy and paste (ids remapped, pasted features selected), copy level, disconnect.
6. Multi-selection (Shift+click, lasso) with the Inspector's shared fields and "Multiple
   values"; hover preview, read-only.
7. Simple multipolygons (outer and inner) and member editing on the map.
8. Map details from P3: door widths, incline and conveying arrows.
9. Spatial validation: level outside the building's levels, missing `indoor=level` outline,
   door not on a wall, empty keys or values; an area index for "which building".
10. Floor plans: snap control points to building outlines, numeric offset, assign plans to a
    building.

### P5.4: Autosave and conflicts — M–L

1. Autosave: history saved to IndexedDB as per-step differences with their selection and
   labels, the base versions of edited entities and `nextId`; a restore prompt on start; a
   `beforeunload` guard; the open changeset id remembered so a retry after a lost response
   checks it first.
2. Conflicts: the server's newer versions kept next to the base; `OsmApi.loadEntities(ids)`;
   `MapLoader.invalidate(area)`; 409, 410 and 412 bodies parsed into entity ids; versions
   taken from the base when uploading; a conflict dialog (keep mine, take theirs, per entity).
3. After upload, uploaded entities take the uploader and the time.

### P6: Parity and polish — M

- Translations with Paraglide (one module per locale), migrating 1.x's (en, fr, de, it, hu,
  cs, es); preset and field names from the schema; plurals and dates from `Intl`.
- Shortcuts help (from the keymap), help pages, indoor= preview (origin-checked
  `postMessage`), README and usage docs.
- Release: an e2e checklist of 1.x features, `LICENSE` (ISC notice for ported code), the
  `legacy-v1.0.16` tag.

### Decisions taken with the user ✔

- The order above: R0, R1 and R2 now; vector plans (P4.2) before geometry editing (P5.3).
- A custom WebGL layer rather than deck.gl (`@deck.gl/maplibre` supports MapLibre 6, but its
  model matrix is affine only, and it adds a large dependency).
- Vector plan text as map labels from pdf.js's text content.
- Component tests in Vitest browser mode.
- CI stays on `master` and pull requests (no runs on branch pushes).

## Testing strategy

- Unit (Vitest, node environment): at least 90% coverage on `osm`, `levels`, `georef`.
- E2E (Playwright, Chromium with SwiftShader WebGL, `vite preview`): all external requests
  blocked or mocked through `tests/e2e/fixtures.ts`; the OSM API mocked per test with
  `page.route` (including 409/412 errors); rendering checked with `pixelAt()` rather than screenshots.
- TDD per the `tdd` skill: agree on seams before writing tests.

## Risks

| Risk                                                 | Mitigation                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| Size of the custom editing engine                    | Follow iD's design; mouse first, basic touch                |
| WebGL needs CORS on imagery tiles (Leaflet didn't)   | Detect failing sources and mark them unavailable            |
| GPU texture limits (4096 px on many mobiles)         | Downscale or tile floor plans                               |
| Upstream preset gaps and version churn               | Pin the schema version; local overlay                       |
| OAuth redirect URIs per domain                       | Separate client ids per deployment in `config.json`         |
| Biome's Svelte support is still experimental         | Keep `svelte-check` in CI; fall back to Prettier for `.svelte` if formatting breaks markup |
| Losing 1.x features                                  | Legacy code kept at `cd1e955`; P6 parity checklist          |
| GPU float32 precision for plans in Web Mercator      | Combine transform and camera in float64 on the CPU, relative to the plan's centre |
| Refactors (R0–R2) breaking working features          | One refactor per slice, e2e suite green before and after, no behaviour change mixed in |

## Open questions

- **License.** `package.json` says MIT, while 1.x is ISC (© Adrien Pavie, Daimler AG). The ISC
  notice must be kept with any ported code (level logic, style, presets), and the repo needs a
  `LICENSE` file.
- **Legacy tag.** `legacy-v1.0.16` has to be pushed from a machine with tag permissions.
