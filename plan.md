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
5. **A viewer too.** Browse indoor data level by level, in 2D or as 3D floors, without an
   account (after geometry editing; see "Research and audit" in [docs/history.md](docs/history.md)).

## Status

| Phase  | Scope                                      | Status      |
| ------ | ------------------------------------------ | ----------- |
| P0     | Scaffold, tooling, map, URL hash           | Done        |
| P1     | Core data model (no UI)                    | Done        |
| P2     | Fast read-only viewer                      | Done        |
| P3     | Presets, validation, upload                | Done        |
| P4     | Floor plans                                | Done        |
| P4.1   | Floor plan layers, edit sessions, align UX | Done        |
| P5.0–2 | Quick fixes, feature editor, fast core     | Done        |
| R0     | Fixes and fast feedback (review)           | Done        |
| R1     | Foundations for editing (review)           | Done        |
| R2     | Floor plan content model (review)          | Done        |
| P4.2   | Vector and light raster floor plans        | Done        |
| R3     | Fixes from the October audit               | Done        |
| W      | Wiki conformance                           | Done        |
| L      | Level names in the switcher                | Done        |
| P5.3   | Geometry editing                           | Done        |
| R4     | Fixes after P5.3 (review)                  | Done        |
| R5     | Map shell split (review)                   | Done        |
| P5.4a  | Autosave and restore                       | Not started |
| V      | Viewer mode (V.1–V.3)                      | Not started |
| 3D     | 3D floors (3D.1, 3D.3, 3D.2)               | Not started |
| P5.4b  | Rebase before upload, conflicts            | Not started |
| P6     | Parity and polish                          | Not started |

Finished phases (what was built, measured and decided) are in [docs/history.md](docs/history.md).

## Stack

| Area        | Choice                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Tooling     | Bun 1.4 (package manager, scripts), Node 24+, Biome 2.5 (format + lint), GitHub Actions                             |
| App         | SvelteKit 3 + `adapter-static`, every route `ssr = false` / `prerender = true`; Svelte 5 runes; TypeScript 6 strict |
| Map         | MapLibre GL JS 6 (WebGL), imported only via `#lib/map/maplibre.ts`                                                  |
| UI          | Tailwind CSS 4, shadcn-svelte components (vega style, on bits-ui 2), `@lucide/svelte`                               |
| Editing     | Custom engine modelled on iD's modes and behaviours, `rbush` spatial index, `@turf/*` v7                            |
| OSM         | `osm-auth` 3 (OAuth 2 PKCE, no secret, no backend); small `fetch` client for the API v0.6                           |
| Presets     | `@openstreetmap/id-tagging-schema` filtered at build time, plus a local indoor overlay; `fuse.js`                   |
| Storage     | IndexedDB via `idb` (floor plans, autosaved edits, settings)                                                        |
| Floor plans | `pdfjs-dist` (lazy loaded); MapLibre `image` source with `setWarp("perspective")`                                   |
| i18n        | Paraglide (key/value JSON, compatible with Transifex)                                                               |
| Tests       | Vitest (unit), Playwright 1.63.0 (e2e, matches cloud sessions' Chromium)                                            |

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
  persist/     plan-store, autosave (P5.4a)
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

## Roadmap from here (agreed with the user ✔)

Revised 2026-10-29 after a review of `master` once P5.3 landed (the "IndoorID: review after
P5.3" doc): two editing bugs and a test setup fix (R4), one refactor so the viewer reuses the
map (R5), then autosave before the viewer and 3D (decided ✔: since P5.3 a user can draw a whole
floor in one session, and a crash or reload loses it all), then V, 3D, the rest of P5.4 and P6.
Each slice still agrees its test seams first. New UI text in V and 3D uses `msg()` from the
start (about 130 English strings in components wait for P6).

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

### P5.4a: Autosave and restore — M

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
- Then, as an editing feature: **unmapped floor** (from osm-simple3d-editor's lessons, not
  built in P5.3): a click on floor outside any room selects the level outline minus its rooms,
  corridors and areas; tagging it creates an `indoor=area` on the shown level, sharing nodes
  with its neighbours.

### V: Viewer mode — M–L

After P5.4a (decided ✔), on R5's map shell, in three slices:

1. **V.1 Read-only route.** Data from Overpass through a `SyncApi` (only `loadMap` differs), so
   no account and no OSM API quota. The style gains a presentation switch (edit, view, 3D:
   `indoorLayers({ presentation, theme })`) with light and dark colour sets, done once here for
   3D too. The selected building's full extent loaded once, so rooms cut at tile edges are
   complete. Overpass lags behind the API: after an upload, keep the uploaded versions and drop
   older entities from Overpass answers (osm-simple3d-editor dropped Overpass for this reason).
2. **V.2 Discovery.** Count bubbles or a heatmap of indoor features below zoom 16 (indoor=,
   OpenLevelUp).
3. **V.3 Side panel.** Search over names and refs, a room list by level and place details
   (OpenIndoorMaps, OpenLevelUp); rooms coloured by use, counting POIs inside them (a shop node
   in an untagged room).

Dropped: the temporary "view in 3D" link to osm-simple3d-editor, since 3D.1 follows V. Routing
(a graph from `highway=footway`/`corridor`, doors, stairs and elevators with their levels;
Dijkstra on a heap) comes after 3D, as its own step.

### 3D: 3D floors — M (3D.1), M (3D.3), M–L (3D.2)

After V (decided ✔). Order: 3D.1, then 3D.3 (level heights, pure), then 3D.2, whose
stacked floors need 3D.3's heights; 3D.1 shows the current level only and needs none (agreed
2026-10-29 ✔).

1. **Extruded rooms** (OpenIndoorMaps): rooms 2.5 m, corridors and areas 0.2 m, the shown level
   only, camera pitched about 40°, hover by feature state; a 3D toggle in the editor (drawing
   stays top-down) and the default in the viewer.
2. **Walls and stacked floors** (OpenIndoor): a derived solids source built in a worker and
   updated per changed entity from the `FeatureStore`: walls from room outlines and
   `indoor=wall` buffered to about 0.2 m, door gaps cut by `width` (default 0.9 m), level slabs
   stacked by real heights (item 3); building → floors → level steps in the viewer.
   `fill-extrusion-opacity` is per layer, so the current level, the ghosted levels and the
   building shell each get a layer.
3. **Level heights and floors** (from osm-simple3d-editor, ISC: `focusLevels` in `main.ts`,
   `floorLevels` in `osm/model.ts`, `view/indoor-voids.ts`), a pure `levels/heights.ts`:
   - Heights per building part, not per building: a part with `building:levels` covers its
     levels from `building:min_level` up, step `(height − min_height) / (levels −
     min_level)`; basements from `building:levels:underground`; a raised part without
     `building:min_level` starts at `round(min_height / 3)`. When several objects give one
     level, a part beats the outline, an explicit `height` beats levels × 3 m, then more levels
     wins. Steps outside 2–10 m are dropped. Levels used only by indoor features take the step
     of the nearest known level. The switcher can say which object each level came from.
   - Floors: a feature on several levels (`level=0;1`, `1-3`, a double-height room) has a floor
     on its lowest level only; `repeat_on` on each listed level; stairwells and lifts
     (`stairs=yes`, `room=stairs|elevator`, `highway=elevator`) a landing on each level; an
     escalator area only at the bottom. 2D keeps `isOnLevel`; only 3D uses this.
   - Atriums: a level's outline minus everything mapped on it, thin leftovers removed by a
     morphological opening, large pieces with mapped space below them are voids; slabs get
     holes there.
   - Ranges stay ranges (`levels.ts`); don't port its parser, which expands ranges to integers.
   - Revised 2026-10-28 (its `src/osm/levels.ts` and real-data survey): `height` on
     `indoor=level` is that level's own height, not its floor elevation; a floor's elevation is
     the sum of the levels below it, from the ground or the part's `min_height`. Explicit
     heights win; the other levels share what is left of the part's height, at least 2 m each;
     if the explicit ones don't fit, warn ("overflow"). Ignore `height` on an `indoor=level`
     that is also `building:part` or `building` (that is the Simple 3D top of the part). Read
     `19.6 m` as metres; drop values outside 2–10 m. Basements go down from 0. Never write
     `min_height` on `indoor=level` (undocumented). A level's outline is the 2D section of the
     union of the building parts that exist at its height.

   Renderer: fill-extrusion can't cut door openings into walls, slope escalators or put holes
   in slabs. osm-simple3d-editor does all three in a three.js custom layer, at the cost of a
   5,000-line layer with its own picking. Stay on fill-extrusion; revisit a custom layer
   (we already have one for vector plans) only if users ask for those details.

### P5.4b: Rebase before upload, conflicts — M–L

After 3D. Autosave, P5.4's first step, moved to P5.4a; steps 2 to 4 stay here.

2. Rebase before upload, first (osm-simple3d-editor does only this, and conflicts become
   rare): fetch the current versions of edited entities, reapply tag edits where the server
   changed other keys, merge relation members; a real clash falls through to step 3.
3. Conflicts (iD's `actions/merge_remote_changes` as the model): the server's newer versions kept next to the base; `OsmApi.loadEntities(ids)`;
   `MapLoader.invalidate(area)`; 409, 410 and 412 bodies parsed into entity ids; versions
   taken from the base when uploading; a conflict dialog (keep mine, take theirs, per entity).
4. After upload, uploaded entities take the uploader and the time.

### P6: Parity and polish — M

- Translations with Paraglide (one module per locale), migrating 1.x's (en, fr, de, it, hu,
  cs, es); preset and field names from the schema; plurals and dates from `Intl`.
- Shortcuts help (from the keymap), help pages, indoor= preview (origin-checked
  `postMessage`), README and usage docs.
- Reach: userscripts adding "Open in IndoorID" to openstreetmap.org and OSMCha (as
  osm-simple3d-editor does); a read-only `?source=josm` that reads JOSM's active layer,
  unsaved edits included, from Remote Control `GET http://127.0.0.1:8111/export` (JOSM
  r19425+, "Export data" permission), upload disabled.
- Left over from P5.3: a right-click operations menu; the read-only hover preview in the
  Inspector (tried, dropped because the side panel opened and closed as the pointer crossed
  features); validation in idle time.
- Release: an e2e checklist of 1.x features, `LICENSE` (ISC notice for ported code), the
  `legacy-v1.0.16` tag.

### Decisions taken with the user ✔

- The order above: R0, R1 and R2 now; vector plans (P4.2) before geometry editing (P5.3).
- A custom WebGL layer rather than deck.gl (`@deck.gl/maplibre` supports MapLibre 6, but its
  model matrix is affine only, and it adds a large dependency).
- Vector plan text as map labels from pdf.js's text content.
- Component tests in Vitest browser mode.
- CI stays on `master` and pull requests (no runs on branch pushes).
- No rewrite after the October research; the viewer (V) and 3D floors come after geometry
  editing (P5.3).
- After the P5.3 review (2026-10-29): R4 and R5 first, autosave (P5.4a) before V and 3D, V in
  three slices, 3D level heights (3D.3) before walls and stacked floors (3D.2), the rest of
  P5.4 after 3D; finished phases moved to `docs/history.md`.

## Testing strategy

- Unit (Vitest, node environment): at least 90% coverage on `osm`, `levels`, `georef`.
- E2E (Playwright, Chromium with SwiftShader WebGL, `vite preview`): all external requests
  blocked or mocked through `tests/e2e/fixtures.ts`; the OSM API mocked per test with
  `page.route` (including 409/412 errors); rendering checked with `pixelAt()` rather than screenshots.
- TDD per the `tdd` skill: agree on seams before writing tests.

## Risks

| Risk                                               | Mitigation                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Size of the custom editing engine                  | Follow iD's design; mouse first, basic touch                                               |
| WebGL needs CORS on imagery tiles (Leaflet didn't) | Detect failing sources and mark them unavailable                                           |
| GPU texture limits (4096 px on many mobiles)       | Downscale or tile floor plans                                                              |
| Upstream preset gaps and version churn             | Pin the schema version; local overlay                                                      |
| OAuth redirect URIs per domain                     | Separate client ids per deployment in `config.json`                                        |
| Biome's Svelte support is still experimental       | Keep `svelte-check` in CI; fall back to Prettier for `.svelte` if formatting breaks markup |
| Losing 1.x features                                | Legacy code kept at `cd1e955`; P6 parity checklist                                         |
| GPU float32 precision for plans in Web Mercator    | Combine transform and camera in float64 on the CPU, relative to the plan's centre          |
| Refactors (R0–R2) breaking working features        | One refactor per slice, e2e suite green before and after, no behaviour change mixed in     |

## Open questions

- ~~**License.**~~ Settled 2026-10-28 with the owner: ISC. `LICENSE.md` restored (the 1.x
  notice plus ours) and `package.json` says `ISC`. Keep the ISC notice with ported code.
- **Legacy tag.** `legacy-v1.0.16` has to be pushed from a machine with tag permissions.
