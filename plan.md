# IndoorID plan

A new client-only indoor editor for OpenStreetMap ([Simple Indoor Tagging](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging)),
version 0.1 alpha (`0.1.0-alpha`). It started from OsmInEdit (React 16, Leaflet, 2019), which
is credited as a source; its code is at commit `cd1e955` (`git show cd1e955:<path>`).

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

| Phase  | Scope                                      | Status       |
| ------ | ------------------------------------------ | ------------ |
| P0     | Scaffold, tooling, map, URL hash           | Done         |
| P1     | Core data model (no UI)                    | Done         |
| P2     | Fast read-only viewer                      | Done         |
| P3     | Presets, validation, upload                | Done         |
| P4     | Floor plans                                | Done         |
| P4.1   | Floor plan layers, edit sessions, align UX | Done         |
| P5.0–2 | Quick fixes, feature editor, fast core     | Done         |
| R0     | Fixes and fast feedback (review)           | Done         |
| R1     | Foundations for editing (review)           | Done         |
| R2     | Floor plan content model (review)          | Done         |
| P4.2   | Vector and light raster floor plans        | Done         |
| R3     | Fixes from the October audit               | Done         |
| W      | Wiki conformance                           | Done         |
| L      | Level names in the switcher                | Done         |
| P5.3   | Geometry editing                           | Done         |
| R4     | Fixes after P5.3 (review)                  | Done         |
| R5     | Map shell split (review)                   | Done         |
| P5.4a  | Autosave and restore                       | Done         |
| LN     | License notices                            | Done         |
| V      | Viewer mode (V.1–V.3)                      | Done         |
| T      | One theme, background pane                 | Done         |
| C      | CAD-style precision (C.0–C.6)              | C.0–C.6 done |
| 3D     | 3D floors (3D.1, 3D.3, 3D.2)               | Not started  |
| P5.4b  | Rebase before upload, conflicts            | Not started  |
| W2     | Wiki conformance, November research        | Not started  |
| P6     | Parity and polish                          | Not started  |

Finished phases (what was built, measured and decided) are in [docs/history.md](docs/history.md).

## Stack

| Area        | Choice                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Tooling     | Bun 1.4 (package manager, scripts), Node 24+, Biome 2.5 (format + lint), GitHub Actions                             |
| App         | SvelteKit 3 + `adapter-static`, every route `ssr = false` / `prerender = true`; Svelte 5 runes; TypeScript 6 strict |
| Map         | MapLibre GL JS 6 (WebGL), imported only via `#lib/map/maplibre.ts`                                                  |
| UI          | Tailwind CSS 4, shadcn-svelte components (vega style, on bits-ui 2), `@lucide/svelte`                               |
| Editing     | Custom engine modelled on iD's modes and behaviours, `rbush` spatial index, `polyclip-ts` (unmapped floor)          |
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
               drag, keys (R1), unmapped-floor (P5.4a)
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

### V: Viewer mode — M–L

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

Dropped: the temporary "view in 3D" link to osm-simple3d-editor, since 3D.1 follows V. Routing
(a graph from `highway=footway`/`corridor`, doors, stairs and elevators with their levels;
Dijkstra on a heap) comes after 3D, as its own step.

### C: CAD-style precision — L (C.0–C.6)

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
menu shows the level's count, hides them, and clears the level's. A measure is kept until the
next first click, as a side label; the measured line is drawn through `Feedback.lines`. Not
done: a list to delete one guide (clear the level instead), and guides on other levels are
only reachable by switching level. Plan files are exported only when there is a plan.

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

### 3D: 3D floors — M (3D.1), M (3D.3), M–L (3D.2)

After V and C (decided ✔; C moved before 3D on 2026-11-11). Order: 3D.1, then 3D.3 (level heights, pure), then 3D.2, whose
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
   - Atriums (revised 2026-11-05 after the forum, see the research addendum): never infer
     voids from missing rooms, since mapping is often incomplete and light wells look the same.
     Every level has a floor and a ceiling by default. Voids are the inner rings of an
     `indoor=level` multipolygon, and the upper levels of a space with several levels
     (`level=0;1`). `ceiling=no` on a room open to the level above is being discussed in
     [t/149582](https://community.openstreetmap.org/t/indoor-tagging-lack-of-floor/149582):
     read it once agreed, don't write it before. As of 2026-11-11 the thread agrees only that
     stairwells, lift shafts and escalators are openings by default, so they cut the slab
     without a drawn hole: an escalator's opening covers its whole incline, at least 5 m, unless
     an inner ring of the floor already draws one (osm-simple3d-editor `9dea9eb`, `a4f6582`).
   - Ceilings (osm-simple3d-editor `0f49886`, `a664abe`, `277d931`): a one-level room under an
     opening of the level above keeps its own ceiling; rooms on several levels stay open; a room
     lower than its level (`height`) gets a lid at its own height.
   - Stairs and escalators (its `docs/indoor-stairs.md` and `src/edit/stairs-pair.ts`, ISC): a
     flight is a `highway=steps` line (axis and `incline`) plus an optional stairs polygon
     (perimeter), both with the same `level=lower;upper`. They pair without a relation: tags,
     equal `level`, the line crossing the polygon from side to side (0.4 m tolerance), no other
     flight of those levels inside. Width comes from the polygon, else `width`. Port as a pure
     function; W2 can use it for "line and polygon levels differ".
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

   - Never write a derived or estimated `height` (the forum asked osm-simple3d-editor to stop,
     and it did): show estimates in grey, write only what the user types. A length tag that
     already has a unit (`3 ft`) keeps it. Underground: a level whose floor is below zero is
     underground even when its ceiling is above ground; leave `building:part=steps` out of a
     basement's outline; `building:levels:underground` must be a whole number of 0 or more.
     Entrances with a `level` sit at that level's floor.

   Building shell for 3D.2: when `building:part`s cover the outline, the outline isn't drawn
   (Simple 3D Buildings; Zkir in t/148767 #155).

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

Also: never delete a way that is still a member of a relation outside the edit (a split left a
footway multipolygon unclosed in osm-simple3d-editor, `541cbc4`, `12ac4fd`); `delete.ts`
checks loaded parents, and the rebase should check the relations it fetches too.

Also: read the OSM API with `cache: "no-store"`, so the browser can't hand back an older
version of an entity (osm-simple3d-editor issue #47), and warn when restored edits are based on
versions older than the server's.

### W2: Wiki conformance from the November research — S–M

Proposed 2026-11-05, not yet scheduled (from the osm-simple3d-editor research addendum):

- Escalators: both end levels in `level`, `incline=up|down`, two-point lines only, slope 15–38°
  on the inclined part (stairs 20–45°), each end inside a room, corridor or level outline of
  its level; say when level heights are estimates.
- Stairs and escalators with `level` over three or more levels: warn, with a fix that splits
  them into pairs of adjacent levels.
- `room=reception` wants `amenity=reception_desk`, `room=dressing` wants
  `amenity=dressing_room`. Check the wiki before treating `room=service|technical` as
  outdated (osm-simple3d-editor maps them to `room=utility`; iD doesn't).
- Doors on an `indoor=wall` area: the approved
  [proposal](https://wiki.openstreetmap.org/wiki/Proposal:Allow_area%3Dyes_for_indoor%3Dwall)
  allows them when the door is also on a room's outline. Reword `issue_door_on_wall_area` to
  say so; still flag, don't cut the wall. Add a test that a closed `indoor=wall` without
  `area=yes` stays a line.
- Keep the `building:part` + `indoor` warning (the forum agrees), but draw such a feature on its
  level as indoor.
- Degenerate rings: also require the ring to be narrow for its size, so small posts aren't
  flagged.

Added 2026-11-11 (research addendum B, the forum and osm-simple3d-editor up to `02c2bfd`):

- An `indoor=level` outline much smaller than the building at that level: warn, since 3D shows
  the rest as a hole (forum #114).
- `indoor=room|area` + `room=column`: fix to `indoor=column`.
- `railway=platform` inside a building without `level`: warn, fix `level=0`.
- An `entrance=*` inside the building, not on its level's outer wall: warn.
- Duplicate nodes (same spot, not joined): warn with a merge fix, so no tool regresses the
  way osm-simple3d-editor's "Merge into building" did (forum #139).
- Features on different levels sharing a node: a hint at most, never an error (bridges and
  skybridges do it on purpose; iD wishlist thread t/148649).

### P6: Parity and polish — M

- Translations with Paraglide (one module per locale), starting from OsmInEdit's (en, fr, de,
  it, hu, cs, es); preset and field names from the schema; plurals and dates from `Intl`.
- Shortcuts help (from the keymap), help pages, indoor= preview (origin-checked
  `postMessage`), README and usage docs.
- Reach: userscripts adding "Open in IndoorID" to openstreetmap.org, OSMCha and indoor= (as
  osm-simple3d-editor does); a read-only `?source=josm` that reads JOSM's active layer,
  unsaved edits included, from Remote Control `GET http://127.0.0.1:8111/export` (JOSM
  r19425+, "Export data" permission), upload disabled.
- Left over from P5.3: a right-click operations menu; the read-only hover preview in the
  Inspector (tried, dropped because the side panel opened and closed as the pointer crossed
  features); validation in idle time.
- Left over from geometry editing (from osm-simple3d-editor): a multipolygon left with one
  outer way and no holes becomes a tagged way again on upload; tracing along existing
  outlines; removing a way's last vertices deletes the way.
- Floor plan import: say in the dialog that tracing a plan needs its owner's permission
  (OSM's copyright rules; Fotoshi, t/148767 #145, allows looking at plan photos but not tracing
  or overlaying them).
- "Cut out of the level outline" (osm-simple3d-editor `6e898c1`): a quick way to draw the
  atrium holes 3D.3 reads. Offset with its inner-ring mode (`76eadf2`) moved to C.6.
- Release 0.1 alpha: an e2e checklist of the features it ships with, and an announcement as a
  new editor. As of 2026-11-11 nobody on the OSM forum has discussed IndoorID; announcing it
  could come as early as V.

### Decisions taken with the user ✔

- The order above: R0, R1 and R2 now; vector plans (P4.2) before geometry editing (P5.3).
- A custom WebGL layer rather than deck.gl (`@deck.gl/maplibre` supports MapLibre 6, but its
  model matrix is affine only, and it adds a large dependency).
- Vector plan text as map labels from pdf.js's text content.
- Component tests in Vitest browser mode.
- CI stays on `master` and pull requests (no runs on branch pushes).
- No broad refactor after the October research; the viewer (V) and 3D floors come after geometry
  editing (P5.3).
- After the P5.3 review (2026-10-29): R4 and R5 first, autosave (P5.4a) before V and 3D, V in
  three slices, 3D level heights (3D.3) before walls and stacked floors (3D.2), the rest of
  P5.4 after 3D; finished phases moved to `docs/history.md`.
- 2026-11-05: IndoorID is presented as a new editor, not a rewrite. Version `0.1.0-alpha`
  (was shown as "2.0 preview"); OsmInEdit is credited as a source in the README and
  `LICENSE.md`, which keeps its ISC notice for the icons and help images that came from it.
- 2026-11-11: CAD-style precision (C, C.0 to C.6) comes before 3D, with the defaults in its
  section.
- 2026-11-11: before V, the plan takes in the forum recheck and osm-simple3d-editor's commits
  to `02c2bfd` (research addendum B), and the license notices are completed (LN below).

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
| Missing features OsmInEdit users expect            | Its code at `cd1e955` to look at; P6 release checklist                                     |
| GPU float32 precision for plans in Web Mercator    | Combine transform and camera in float64 on the CPU, relative to the plan's centre          |
| Refactors (R0–R2) breaking working features        | One refactor per slice, e2e suite green before and after, no behaviour change mixed in     |

## Open questions

- ~~**License.**~~ Settled 2026-10-28 with the owner: ISC, and `package.json` says `ISC`.
  Since 2026-11-05 `LICENSE.md` names IndoorID's contributors, with OsmInEdit's notice under
  "Third-party notices" for the assets that came from it.
- **LN, license notices (2026-11-11, done).** ISC, MIT, BSD and Apache all ask that their
  notices travel with copies, and a deployed site is a copy. `LICENSE.md` now carries the full
  ISC notices of iD (schema and code that follows it), osm-simple3d-editor (tools that follow
  it, and the 3D ports to come) and OsmInEdit (also the style, hash and plan format), plus the
  Inter font (OFL), the JPEG XL codec (libjxl BSD) and OSM's ODbL. `bun run build` writes
  `build/licenses.md`: `LICENSE.md`, then every bundled package's notice (Vite's
  `build.license`), then Inter's and `@jsquash/jxl`'s, which Vite doesn't see; the header links
  it. The indoor map source credits "© OpenStreetMap contributors" whatever the basemap. When
  porting more code from another project, add its notice to `LICENSE.md` in the same PR.
