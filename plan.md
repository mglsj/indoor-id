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
5. **A viewer too.** Browse indoor data level by level in 2D, without an account (see
   "Research and audit" in [docs/history.md](docs/history.md)). 3D floors are a later goal
   (see "Later: 3D").

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
| I      | iD's area fill, colours and safeguards     | Done         |
| B      | Building mode: map and building scopes     | Done         |
| P5.4b  | Rebase before upload, conflicts            | Done         |
| W2     | Wiki conformance, November research        | Done         |
| W3     | Checks from the 2026-11-24 recheck         | Done         |
| P6     | Parity and polish                          | Done         |
| A      | Accessibility and layout (Nov. audit)      | Done         |
| R6     | Fixes from the 2026-11-25 code audit       | R6.2 done    |
| 3D     | 3D floors (3D.1, 3D.3, 3D.2)               | Later        |

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
| i18n        | Paraglide 3 (inlang message files, compatible with Transifex)                                                       |
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

Revised 2026-11-12 with the user ✔: all 3D work moves to "Later: 3D" at the end of the roadmap.
The near-term roadmap is a good 2D editing and viewing experience: P5.4b (safe uploads), W2
(validation), P6 (parity and polish), then 0.1 alpha. 3D starts only after those, when the user
says so.

Revised 2026-11-12 with the user ✔: building mode (B) comes first, before P5.4b, W2 and P6, so
that P6 polishes the split layout rather than the single editor.

### R4: Fixes after P5.3 — S — done

Done ✅; see "R4" in [docs/history.md](docs/history.md).

### R5: Map shell split — M — done

Done ✅; see "R5" in [docs/history.md](docs/history.md).

### V: Viewer mode — M–L — done

Done ✅; see "V" in [docs/history.md](docs/history.md).

### T: One theme, simpler backgrounds — S — done

Done ✅; see "T" in [docs/history.md](docs/history.md).

### C: CAD-style precision — L (C.0–C.6) — done

Done ✅; see "C" in [docs/history.md](docs/history.md).

### B: Building mode — M–L (B.0–B.5) — done

Done ✅; see "B" in [docs/history.md](docs/history.md).

### P5.4b: Rebase before upload, conflicts — M–L — done

Done ✅ (2026-11-24); see "P5.4b" in [docs/history.md](docs/history.md). Left for later: a
warning right after a restore when the edits are based on versions older than the server's
(the upload now merges or lists them anyway), and re-downloading the area after a merge
(`MapLoader.invalidate`: the merge puts the server's versions in the history itself).

### W2: Wiki conformance from the November research — S–M — done

Done ✅ (2026-11-24); see "W2" in [docs/history.md](docs/history.md). Left for 3D.3: an
escalator's slope (15–38°, stairs 20–45°) and the note that level heights are estimates, both
needing level heights; pairing a stairs line with its polygon ("line and polygon levels
differ") with the port of `stairs-pair.ts`. Not done on purpose: a check for features on
different levels sharing a node (the plan allowed a hint at most; bridges and skybridges do it
on purpose, and nothing in IndoorID writes such joins).

### W3: Checks from the 2026-11-24 recheck — S–M — done

Done ✅ (2026-11-24); see "W3" in [docs/history.md](docs/history.md). Left for later: finding a
wall line drawn over a wall area without sharing a node with it, and running the pre-upload
check in the background every few edits (osm-simple3d-editor `9ed266f`).

### P6: Parity and polish — M

- ~~Translations~~: the machinery is done ✅ (P6.6, 2026-11-24); see "P6.6" in
  [docs/history.md](docs/history.md). Left: the UI strings in cs, de, es, fr, hu and it (a few
  from OsmInEdit so far), and the help page.
- ~~Shortcuts help, help pages, indoor= preview, README and usage docs~~: done ✅ (P6.4,
  2026-11-24); see "P6.4" in [docs/history.md](docs/history.md).
- ~~Reach: userscripts and a read-only `?source=josm`~~: done ✅ (P6.5, 2026-11-24); see
  "P6.5" in [docs/history.md](docs/history.md).
- ~~Left over from P5.3 and from geometry editing~~: done ✅ (P6.2, 2026-11-24); see "P6.2"
  in [docs/history.md](docs/history.md). Not done: the read-only hover preview in the
  Inspector (dropped in P5.3).
- ~~Floor plan import: the permission note~~ moved to B (the import dialog moves into building
  mode there).
- ~~From the 2026-11-24 recheck~~: done ✅ (P6.1, 2026-11-24); see "P6.1" in
  [docs/history.md](docs/history.md).
- ~~"Cut out of the level outline"~~: done ✅ (P6.3, 2026-11-24); see "P6.3" in
  [docs/history.md](docs/history.md).
- ~~Release 0.1 alpha: checklist and announcement~~: done ✅ (P6.7, 2026-11-24); see "P6.7" in
  [docs/history.md](docs/history.md): [docs/release-0.1.md](docs/release-0.1.md) and the draft
  [docs/announcement-0.1.md](docs/announcement-0.1.md), not posted. Tagging the release and
  posting are the maintainer's.

### A: Accessibility and layout, from the 2026-11-24 audit — M–L (A.1–A.7) — done

Done ✅ (2026-11-25, PRs #60–#63, #65, #66 and A.7's); see "A" in
[docs/history.md](docs/history.md). Left for later: popovers (the snapping menu) still render
outside a landmark (axe's moderate `region`), and the editor itself stays desktop only.

### R6: Fixes from the 2026-11-25 code audit — M–L (R6.1–R6.5) — R6.2 done

From the code audit of `master` at `ba63562`, in
[docs/code-audit-2026-11-25.md](docs/code-audit-2026-11-25.md) (item ids below are the
report's). One PR per slice, each with a test that fails before the fix.

- ~~**R6.1, upload and data safety**~~: done ✅ (2026-11-25). H1: `DataSync` remembers a
  failed upload's changeset only when the server may have applied it (`network`, `server`,
  `uploaded`); a refusal (409, 410, 412, 400…) clears it, so the next upload rebases again
  instead of resending the same edits forever. A retry after a lost answer still skips the
  rebase, checks the old changeset, and clears it if refused. H2: `wholeLevels` and
  `MAX_LEVEL_SPAN` (250) in `levels/levels.ts` cap every expansion of a range (`knownLevels`,
  `encodeLevels`, `listLevels`, `repeat-levels`); a wider `level` or `repeat_on` gets the
  `implausible-level-range` issue. M1: `persist/storage.ts` (`browserStorage`, `NO_STORAGE`)
  is the one way to read Web Storage; `openAutosave()` gives null where storage is blocked and
  the editor edits without autosave; a full storage no longer throws from the heartbeat.
- ~~**R6.2, rendering and tagging**~~: done ✅ (2026-11-25). M2: an area's label and icon are
  one point per feature (`labelPoint`, polylabel on the largest polygon) in their own source,
  `LABEL_SOURCE`, keyed by the same `@id`, so a room's name no longer repeats at tile edges.
  M3: `indoor=*` decides before `room=*` (`indoor=area` + `room=toilets` is a space). L2:
  `building=no` is no building, the sub-preset test needs a `/`, `matchScore` has iD's
  `addTags` bonus and `searchable` penalty, country-only presets are left out at build time
  (3), and door widths read `0,9`, `3'6"` and `36"`. `name:<locale>` labels stay for later.
- **R6.3, performance (M).** M4: hover and label hiding once a frame. M5: selection, hover and
  drawing from a small overlay source, not six layers over every feature. M6: frames and
  containers looked up in an rbush. M7: stale tile downloads dropped or aborted. Incremental
  level counts in `FeatureStore`, bands from the index. Measured with `bun run bench` and a
  10,000-room pointer-move trace, before and after.
- **R6.4, refactors with no behaviour change (M–L).** R1: `EditorView.svelte` split (building
  scope controller, mode factory, layer wiring, operations menu, draw toolbar), one PR per
  cut unless the user says otherwise. R4: one `isVertical`, one set of room spaces, a
  `pixelsAtZ17` helper. R5: the `polyclip-ts` call sites moved to Clipper2, one clipping
  library left.
- **R6.5, dependencies and tests (S).** Minor and patch updates (MapLibre 6.19, Kit 3.4, Svelte
  5.59, pdf.js 6.5, Vitest 5.1, Playwright 1.65); runtime libraries moved to `dependencies`;
  Renovate or Dependabot; CI actions v5. Majors (osm-auth 4, TypeScript 7, tailwind-variants
  4) each on their own once checked. L1: the JPEG XL codec tests follow `probeSupport()`. The
  e2e test `inspector.spec.ts:80` that fails after a reload is looked at: a test race or a bug.

Open questions in the report (section 5) are asked before R6.1 and R6.4 start.

## Later: 3D

Not scheduled (moved here 2026-11-12 ✔): the user wants a good 2D editor and viewer first. Start
only when the user asks; re-check the forum's `ceiling=no` discussion and osm-simple3d-editor's
newer commits first. Until then, 2D work shouldn't build for 3D ahead of time, but should keep
what it reads (levels as ranges, `height`, `building:levels`) unchanged so 3D.3 can use it.

### 3D: 3D floors — M (3D.1), M (3D.3), M–L (3D.2)

Planned before 2026-11-12, kept as written for when 3D starts (after V and C, decided ✔; then
moved after the 2D roadmap on 2026-11-12 ✔). Order: 3D.1, then 3D.3 (level heights, pure), then 3D.2, whose
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
     function, and add "line and polygon levels differ" to the validator with it (left by W2).
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
   - Confirmed 2026-11-24 (t/149818, t/149433): renderer authors agree on 3 m per level when
     nothing is tagged (OSM2World moves from 2.5 m), and the `height` of an indoor or rooftop
     object is measured from the floor it stands on, not from the ground. Read `height` on
     rooms, walls, doors and counters that way.

   Building shell for 3D.2: when `building:part`s cover the outline, the outline isn't drawn
   (Simple 3D Buildings; Zkir in t/148767 #155).

   Renderer: fill-extrusion can't cut door openings into walls, slope escalators or put holes
   in slabs. osm-simple3d-editor does all three in a three.js custom layer, at the cost of a
   5,000-line layer with its own picking. Stay on fill-extrusion; revisit a custom layer
   (we already have one for vector plans) only if users ask for those details.

## Decisions taken with the user ✔

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
- 2026-11-12: all 3D (3D.1, 3D.2, 3D.3) moves to "Later: 3D". The near-term roadmap is 2D
  editing and viewing: P5.4b, W2, P6 and the 0.1 alpha release.
- 2026-11-12: building mode (B) before P5.4b, W2 and P6, with the defaults in its section.
- 2026-11-24: W3 takes in the checks from research addendum C (asked by the user).
- 2026-11-24/25: phase A from the accessibility and ease-of-use audit, with the layout and
  scope in its section (editor desktop only, good practice rather than formal conformance, no
  new features).
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
