# CLAUDE.md

IndoorID, an indoor OpenStreetMap editor: a rewrite of OsmInEdit (React + Leaflet, 2019) as a client-only
SvelteKit + MapLibre app. OSM is the only backend. The roadmap, decisions and phase status live in
[plan.md](plan.md): read it before starting a phase and update its status when a phase lands.

## Commands

Bun is the package manager and script runner; Node 22.17+ (24 in CI) runs Vite and the test tools.

```bash
bun install
bun run dev          # http://localhost:5173
bun run check        # svelte-check (types)
bun run lint         # Biome: format + lint (bun run format to fix)
bun run test:unit    # Vitest, *.test.ts next to the code
bun run test:e2e     # builds, then Playwright from tests/e2e
bun run bench        # times the core on 10,000 synthetic rooms (scripts/bench-core.ts)
```

Before pushing, run `lint`, `check`, `test:unit` and `test:e2e`. CI (`.github/workflows/ci.yml`)
runs the same commands.

## Stack and layout

- Svelte 5 (runes only), SvelteKit 3 with `adapter-static`; every route is `ssr = false`,
  `prerender = true` (empty shell, rendered in the browser).
- MapLibre GL JS 6, Tailwind CSS 4, shadcn-svelte components (on bits-ui), `@lucide/svelte` icons.
- `src/lib/` holds the code, imported as `#lib/...` with explicit extensions
  (`import { parseHash } from "#lib/map/hash.ts"`). `$lib` does not exist in SvelteKit 3.
- `src/lib/ui/` components, `src/lib/map/` map helpers, `src/routes/` pages, `static/` copied
  as-is (`config.json`, help images), `tests/e2e/` browser tests. Map icons load on demand
  (`style/icons.ts`): the 1.x set in `src/lib/map/style/icons/` (`key_value.svg|png`) and the
  presets' Maki/Temaki icons (`maki-toilet.svg`) copied into `presets/generated/icons/`.
- Data model (P1): `osm/` (entities, immutable `Graph`, `History`, osmChange), `actions/`
  (pure `graph => graph` functions), `levels/` (level values as ranges; `level-names.ts`: what the switcher lists, `level:ref`, `building:levels:ref`, `non_existent_levels`), `api/` (`OsmApi`).
  Get ids for new entities from `graph.newId(type)`; never mutate entities or graphs.
  Geometry (closed ways, point in polygon, extents, Web Mercator, midpoints, distances) lives
  in `osm/geometry.ts`, a way's nodes come from `graph.childNodes(way)`: don't write another copy.
  `History` runs each action on one copy (`Graph.update`, iD's unfrozen graph), so an action
  may call `replace`/`remove` thousands of times; outside it, wrap big changes the same way.
  A graph's local edits are a persistent map (Immutable.js) shared between steps; each graph
  knows the edit that made it, so `changedSince` between nearby steps and `changeCount()` cost
  what the edit set. Avoid full scans (`changes()`, iterating every entity) on each edit.
- Viewer (P2): `map/features.ts` (graph → GeoJSON with `@lv`, `@kind`, `@icon`, `@label`),
  `map/feature-store.ts` (P5.2: features rebuilt only for changed entities, sent to the map
  with `updateData`; an rbush index of drawn nodes, `nodesNear`, for snapping; `levelsIn(extent)`, the named levels in view for `LevelControl`),
  `map/classify.ts` (all tag → drawing rules), `map/style/layers.ts`, `map/indoor-map.ts` (source
  and layers on the map), `api/map-loader.ts`, `state/editor.svelte.ts` (`Editor`: `history`
  (`EditHistory`), `selection`, `sync` (`DataSync`), `catalog` (presets, upgrades, web
  services); components read it with `getEditor()`, never as a prop; UI edits are functions in
  `state/commands.ts`; issues come from `validation/validator.ts`, cached per entity), and
  `ui/EditorView.svelte` (the page's map UI). Change how a tag is drawn in `classify.ts`, not
  in the style.
- Tagging and upload (P3): `presets/` (`PresetIndex`: match, search, fields, `listFor`,
  `changePreset`; `RecentPresets`; `field-list.ts`: shown and addable fields, remove, revert; `combo.ts`, `choice.ts`, `text.ts`, `localized.ts`, `address.ts`, `access.ts`, `wiki.ts`: field values and references),
  `validation/` (`validate()` rules with one-click fixes, or `levelFix(level)` taking the
  shown level; tag upgrades; `outlines.ts`, building and indoor outlines by position for the
  rules that depend on where a feature is), `api/changeset.ts`,
  `api/taginfo.ts` (value suggestions; e2e tests serve it with `serveTaginfo()`),
  `api/wikidata.ts` (Wikidata, Wikipedia search), `api/osm-wikibase.ts` (ⓘ documentation; e2e
  `serveWiki()`),
  `state/session.svelte.ts` (osm-auth login), `ui/Inspector.svelte` (with `ui/PresetList.svelte`,
  `ui/FieldsSection.svelte`, `ui/FieldInput.svelte` choosing `ComboField`, `ChipsField`,
  `CheckField`, `RadioField`, `TextField`, `TextareaField`, `LocalizedField`, `AddressField`,
  `AccessField`, `WikidataField` or `WikipediaField`; `TagReference` + `InfoButton` for ⓘ;
  every combobox on `ui/combobox.svelte.ts` (`Combobox`) and `ui/ComboList.svelte`;
  fields edit several features at once: they get the shared `tags` and the `mixed` keys
  (`presets/multi.ts`) and send patches (`FieldChange`, per feature when a function), applied
  with `history.patchTags`;
  `TagEditor` for the Tags section, whose text view e2e tests read with `tagsBox()`;
  `RelationsSection` and `MembersSection` on `actions/members.ts` and `osm/relations.ts`),
  `ui/SaveDialog.svelte`.
  Presets come from `@openstreetmap/id-tagging-schema` plus `presets/overlay.json`, built by
  `scripts/build-presets.ts` on install into the gitignored `presets/generated/`; run
  `bun run presets` after changing the overlay or the schema version.
- Floor plans (P4, R2): `floorplans/` (`content.ts`: a plan's size in plan units (PDF points, SVG
  units, photo pixels) and its content, kept in `FloorPlans.contents`, out of the reactive plans;
  transforms map plan units; a plan's `source` names the file it came from, stored once by
  file id (a PDF shared by its pages); `georef.ts` transforms fitted in Web Mercator,
  `plan-file.ts` plan files (version 2: a ZIP of `plans.json` and the source files; version 1
  JSON and 1.x read), `tiling.ts`, `import.ts` raster/SVG/PDF; vector plans (P4.2):
  `vector.ts` (`VectorContent`: segments, triangles, texts, CAD layers; `VectorBuilder`),
  `vector-pdf.ts` (pdf.js operator lists, text from `showText`, pure: pass pdf.js's `OPS`; `pdfPageKind` for Auto; a plan's `source.mode` says how it is
  drawn), `svg-path.ts` (pure), `vector-svg.ts` (`DOMParser`), `plan-vertices.ts` (corners to
  snap to, `FloorPlans.verticesNear`)),
  `map/floorplan-layers.ts` (vector plans through `map/vector-plan-layer.ts`, a custom
  WebGL layer, and `map/plan-matrix.ts`; their text through `map/plan-labels.ts`),
  `state/floorplans.svelte.ts` (`FloorPlans`: plans, edit sessions, alignment tools; a
  plan's visibility and hidden CAD layers are saved at once, outside the edit session),
  `persist/plan-store.ts` (IndexedDB schema 4: settings, tiles, files, thumbnails, vectors; tested on
  fake-indexeddb; content loads for the shown level only, `FloorPlans.showLevel`; tests use
  `state/testing/plan-store.ts`), `ui/FloorPlansPanel.svelte` (`PlanFiles`, `PlanList`,
  `PlanTools`). Pixels go through a `PlanCodec`
  (`codec.ts`; `workerCodec()` runs `plan-worker.ts`: `pyramid.ts` cuts, then `tile-codec.ts`
  encodes lossless JPEG XL (`jxl.ts`, WASM, where the browser reads it), WebP or PNG
  (`tile-format.ts`)); a plan shows once cut, its `encoded` tiles are saved after; stored tiles
  load encoded and are decoded when on screen through `tile-cache.ts` (`FloorPlans.tiles`). Import and
  export of files go through `plan-io.ts` (decoders from `planDecoders(codec)` in `import.ts`).
  Import pdf.js only from its legacy build, lazily. E2E tests that reload after saving a plan
  wait for IndexedDB first (`untilSaved` in `floorplans.spec.ts`): a reload can cut a write
  short.
- Editing (R1): `edit/mode-manager.ts` is the only listener on the map's pointer events (mouse, touch, pen); it hands
  hover (cursor), click, press (a `Drag`) and keys to one `Mode` (`edit/mode.ts`,
  `edit/modes/*`). Add map interactions as a mode, not as `map.on(...)` in a component.
  Shortcuts use `edit/keys.ts` (`matches`, `formatCombo`, `isTyping`). Map layers insert
  before a slot from `map/layer-slots.ts` (`slotId("plans")`), never before another owner's
  layer.
- Geometry editing (P5.3): `edit/overlay.ts` (vertices, midpoints, junctions, untagged members;
  pure) drawn by `map/edit-overlay.ts` (`EditOverlay.grabAt`); `map/snap.ts` (`snapAt`: node,
  side, plan vertex within 8 px, from `nodesNear`/`segmentsNear`); `edit/node-drag.ts` (drag a
  vertex, point or midpoint; joins with `actions/connect.ts`). A drag shows its moves with
  `history.preview(action)` and ends with one `commit` (or `cancelPreview`): never `perform`
  on every move.
- Messages (R1.7): text shown to users is a `Message` made with `msg("key", {params})` from
  `i18n/messages.ts` and rendered with `t()` in components; errors shown to users are
  `MessageError`s. Add the English to `messages/en.json` (snake_case keys, `{param}`
  placeholders), then `bun run messages` (it also runs on install) to update the typed
  `i18n/generated/en.ts`.
- Planned modules (see plan.md): `persist/autosave`. Pure modules (`osm`, `levels`,
  `actions`, `presets`, `validation`, `floorplans/georef`, `floorplans/plan-file`,
  `floorplans/tiling`) must not touch the DOM or Svelte.

## Rules that are easy to get wrong

- **MapLibre**: import it only from `#lib/map/maplibre.ts`, never from `maplibre-gl`. That module
  calls `setWorkerUrl()`; without it MapLibre 6 under Vite loads no data source at all (a
  background-only style still renders, so the failure is easy to miss). v6 has no default
  export: use named imports. Load the `maplibre-v6-migration` skill before using APIs you know
  from v5.
- **SvelteKit 3**: config lives in `vite.config.ts` (`sveltekit({...})`); there is no
  `svelte.config.js`. `asset()` takes paths without a leading slash (`asset("config.json")`).
  Use `goto(resolve(hash), { replace: true, shallow: true })` instead of `history.replaceState`.
- **Svelte**: integrate imperative libraries with `{@attach}` (see `MapView.svelte`), keep large
  data (the OSM graph, GeoJSON) in `$state.raw` and replace it immutably, prefer `$derived` over
  effects, and only use `$effect` to sync to the outside world.
- **Config**: `static/config.json` is public. Never put secrets or API keys in it or in the code.
- **OSM data**: never rewrite a tag the user didn't edit (the legacy editor silently rewrote
  `level`). Level values are strings like `0;1`, `-1`, `0.5`, `1-3`; level `0` is a real level,
  never treat it as falsy. Uploads are one atomic osmChange, built from the graph difference.
- **UI**: build with the shadcn-svelte components in `src/lib/components/shadcn/` (added with
  `bunx shadcn-svelte@latest add <name>`, then `bun run format`; don't hand-edit them) and the
  theme's semantic colours (`bg-background`, `text-muted-foreground`…), never raw palette colours
  or `dark:` overrides. Dark mode follows the system via `mode-watcher` (`.dark` class). Controls
  floating over the map sit on a `bg-background` wrapper: shadcn's dark outline and input styles
  are translucent. A `Command`'s input is named by the Command's `label`, not `aria-label`.
- **Formatting**: Biome (tabs, double quotes) formats `.ts`, `.svelte`, `.css` and `.json`. Don't
  hand-format; run `bun run format`.

## Tests

- Follow the `tdd` skill: agree on the seams to test first, then red → green, one slice at a time.
  Expected values come from the spec or worked examples, never recomputed like the code does.
- Unit tests sit next to the module (`hash.ts` → `hash.test.ts`) and test public functions.
  Build entities with `node()`, `way()`, `relation()` from `#lib/osm/fixtures.ts`; test the API
  client with a fake `fetch` (see `api/osm-api.test.ts`), never the network.
- Component tests (`Foo.svelte` → `Foo.component.test.ts`) run in Chromium (Vitest browser
  mode, the `component` project; `bun run test:unit` runs both projects). Render with
  `render()` from `vitest-browser-svelte`, query with `page` and type with `userEvent` from
  `vitest/browser`; put the props under `props` when one is named `context` (a mount option).
  Render a component that calls `getEditor()` with `renderWithEditor()` (`ui/testing/render.ts`).
  Test a component's behaviour here rather than in e2e when the map isn't involved. Code that
  needs browser APIs (workers, canvases, `createImageBitmap`) is tested the same way in
  `*.browser.test.ts` files.
- E2E tests use the `test` fixture from `tests/e2e/fixtures.ts`: it blocks all external requests
  and serves a blank basemap style. Override a route in the test when you need specific data.
  `camera()` reads the map's camera, `pixelAt()`/`expectPixel()` check rendered colours (WebGL
  runs in SwiftShader). It serves an empty OSM area by default; `serveOsm()` in
  `indoor.spec.ts` shows how to serve real elements. Don't wait for network requests to
  bundled assets other than map icons: Vite inlines small files as `data:` URLs (icons are
  imported with `?no-inline`, so a test can wait for `maki-toilet.*.svg`). Floor plan fixtures
  live in `tests/e2e/files/` (excluded from Biome); `pixelAt()` takes page coordinates, so add
  the map's offset from `mapLocator(page).boundingBox()`.
- `@playwright/test` is pinned to 1.56.1 because that version matches the Chromium preinstalled in
  cloud sessions (`/opt/pw-browsers`). Upgrade both together.

## Skills in `.claude/skills`

Installed with a skills manager (`skills-lock.json`); don't edit them by hand.

| Task                                                   | Skill                                                    |
| ------------------------------------------------------ | -------------------------------------------------------- |
| Writing or reviewing any `.svelte` / `.svelte.ts` file | `svelte-core-bestpractices`, then `svelte-code-writer`   |
| Anything MapLibre 6 (APIs, events, worker, imports)    | `maplibre-v6-migration`                                  |
| Map styling: indoor layers, labels, icons, ordering    | `maplibre-cartography`, `maplibre-fonts-glyphs`          |
| Sources not rendering, `promoteId`, feature state      | `maplibre-source-wiring`, `maplibre-tile-sources`        |
| Hosting tiles statically (if ever needed)              | `maplibre-pmtiles-patterns`                              |
| UI components (add, compose, style)                    | `shadcn-svelte`, then `tailwind-design-system` for tokens |
| UI / accessibility review                              | `web-design-guidelines`                                  |
| Test-first work                                        | `tdd`                                                    |
| Typed graph / tag / preset models                      | `typescript-advanced-types`, `modern-javascript-patterns` |

Not relevant to this app: `maplibre-terrain-rendering`, `maplibre-running-evals`,
`maplibre-skill-authoring` (the last two are for authoring MapLibre's own skills).

## Tools and MCP

No MCP server is configured in the repo. The Svelte tooling from `svelte-code-writer` runs as a
CLI:

```bash
npx @sveltejs/mcp list-sections
npx @sveltejs/mcp get-documentation "$state,$derived"
npx @sveltejs/mcp svelte-autofixer ./src/lib/ui/MapView.svelte --svelte-version 5
```

Pass `--svelte-version 5` (a full version like `5.57.2` is rejected). In cloud sessions, Node's
`fetch` ignores the HTTPS proxy: prefix these commands with `NODE_USE_ENV_PROXY=1`. When the
MDN MCP server is available, use it for web platform APIs (WebGL limits, OffscreenCanvas,
IndexedDB, File System Access).

Cloud sessions run `.claude/hooks/session-start.sh` (`bun install`) at startup.

## Reference: the legacy editor

The 1.x code is on `master` history before the rewrite (commit `cd1e955`, tag `legacy-v1.0.16`
once pushed). Useful files to port behaviour from, via `git show cd1e955:<path>`:
`src/ctrl/VectorDataManager.js` (level logic, diff scenarios), its `.test.js`,
`public/style.mapcss` (visual language), `public/presets/indoor.xml`,
`src/ctrl/ImageryManager.js`, `src/config/locales/`.
