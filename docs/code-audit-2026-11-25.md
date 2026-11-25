# IndoorID code audit (25 November 2026)

Audited `master` at `ba63562` (after PR #70). PRs #60 to #73 are all merged, so nothing below repeats what they fixed, and nothing repeats the accessibility audit (`a11y-audit/report.md`) or the tagging gaps report (`tagging-gaps/report.md`).

**Baseline:** `lint` and `check` are clean (0 errors, 0 warnings). Unit tests: 1,802 of 1,804 pass; the 2 failures are environment-dependent (item L1). The e2e result is at the end.

**How to read this:** each item has a severity, a location, the evidence, and a suggested fix. "Confirmed" means I reproduced it with a test or by reading the library code it depends on. "Likely" means I found it by reading the code but didn't reproduce it.

| Severity   | Meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| **High**   | Can lose work, block uploads, or freeze the app on real data |
| **Medium** | A visible bug, or a slowdown at realistic sizes              |
| **Low**    | An edge case, an inconsistency, or a nit                     |

---

## 1. Bugs

### H1. A refused upload sets up a retry loop that never rebases (Confirmed)

`src/lib/state/data-sync.svelte.ts:205` and `:232`

Any `OsmApiError` that carries a changeset id sets `failedChangeset`, including definite refusals such as a 409 version conflict, 410 gone, 412 precondition, or 400. The next upload sees `failedChangeset !== undefined` and **skips the rebase** ("a retry of a lost answer checks its changeset first"). The check of the old changeset finds it empty, so the same stale graph is sent again and fails again with the same 409. That sets `failedChangeset` again, and the loop never ends. `failedChangeset` is also autosaved (`autosave.svelte.ts:85`), so reloading the page doesn't break the loop. The only way out is to discard the edits.

Repro (unit test, run with `--project unit`): with an API whose `upload` throws `new OsmApiError("Version mismatch", "conflict", 409, 41)`, three `sync.upload()` calls call `loadEntities` (the rebase) **once**, and `failedChangeset` stays `41`.

Fix: only remember the changeset when the answer may really have been lost, meaning kinds `network` and `server` (5xx), or a timeout. Either way, run the rebase after the "already uploaded?" check, not instead of it:

```ts
// in #rebaseAndUpload
if (this.failedChangeset !== undefined)
	await this.#api.checkRetry(this.failedChangeset); // throws "uploaded"
// ...then always: loadEntities → rebase → conflicts
```

and in the `.catch`: `if (error.changesetId !== undefined && (error.kind === "network" || error.kind === "server"))`.

### H2. One bad `level` range in the data freezes the editor (Confirmed)

`src/lib/map/features.ts:267` (`knownLevels`), `src/lib/levels/levels.ts:82` (`listLevels`), called from `feature-store.ts:142` on **every** update, and from `validate.ts:567,618` and `conformance.ts:91,160`.

`encodeLevels` caps a feature's own ranges at `MAX_OWN_LEVELS = 250`, but `knownLevels` and `listLevels` expand every whole level in a range with no cap. A single downloaded feature tagged `level=0-10000000` (or `min_level=0` + `max_level=10000000`) gives:

| Value        | Levels listed | Time for `buildFeatures` on 2 nodes                    |
| ------------ | ------------- | ------------------------------------------------------ |
| `0-1000`     | 1,001         | 2 ms (but the switcher lists 1,001 levels)             |
| `0-100000`   | 100,001       | 54 ms, on every edit                                   |
| `0-10000000` | 10,000,001    | 10.2 s, on every edit; larger values run out of memory |

The validator's "room on several levels" fix would also offer to make one copy per level.

Fix: share one `wholeLevels(range)` helper used by `encodeLevels`, `knownLevels` and `listLevels`. It should apply the same cap (skip or clamp ranges wider than `MAX_OWN_LEVELS`), and `listLevels` should return `null` above the cap. Add a validator issue for "implausible level range".

### M1. The editor crashes on start when site storage is blocked (Likely)

`src/lib/ui/EditorView.svelte:317` (`new Autosave()`), `src/lib/persist/autosave.ts:51-62`, `EditorView.svelte:691`

When a browser blocks site data, even reading the `localStorage` or `sessionStorage` identifier throws `SecurityError`. That covers Chrome's "block all cookies" or "block third-party cookies" when the editor is embedded, and some privacy modes. `Autosave`'s constructor reads both as default parameters and calls `getItem` and `setItem` unguarded, and it isn't inside a try. `rememberedWidth(localStorage)` evaluates the identifier before the function's own try. The heartbeat `setInterval` also calls `setItem` unguarded, and a full quota would throw from it every 5 s. The code comments say autosave is meant to be a safety net that degrades gracefully, but construction doesn't.

Fix: add one `safeStorage(kind)` helper; `catalog.svelte.ts:104` already has one. Use it everywhere (see R3), and build `Autosave` lazily inside `EditAutosave.start()` behind a try.

### M2. Room labels repeat or jump at tile edges (Confirmed in MapLibre's code)

`src/lib/map/style/layers.ts:611` (`indoor-labels` takes `isPolygon`)

For a Polygon, MapLibre's symbol layout puts one label at the pole of inaccessibility **of each tile's clipped piece** (`maplibre-gl-worker.mjs`, `findPoleOfInaccessibility(polygon, 16)` inside `addFeature`). So a room or corridor that crosses a tile boundary gets two or more labels, and they jump as you zoom. Long corridors and halls are hit most. The cross-tile symbol index doesn't merge them because the anchors differ.

Fix: in `features.ts`, emit a separate label point per area (polylabel on the full ring, cached in the draft). Point `indoor-labels` at those points, with polygons excluded from it. The hit test for labels already treats non-point label hits specially, so that code gets simpler too.

### M3. `indoor=area` (or corridor) plus `room=*` is drawn as a walled room (Confirmed by reading)

`src/lib/map/classify.ts:62-66`

The `room` check runs before `isSpace`, so `indoor=area` + `room=toilets` or `room=shop` is drawn as a room. The project's own validator accepts that tagging as correct (`validate.ts:498`, `ROOM_SPACES`), and Simple Indoor Tagging makes `indoor=*` the primary key. Fix: decide from `indoor` first, and use `room=*` or `buildingpart=*` only when `indoor` is missing.

### M4. Hover and label-hiding run two `queryRenderedFeatures` calls per pointer event (Likely, a performance issue)

`src/lib/edit/mode-manager.ts:212` and `:218`

Every `pointermove` with no button pressed calls `hideLabelsNear` (a `queryRenderedFeatures`) and then `mode.hover`, which hit-tests with another `queryRenderedFeatures` or snaps. It also calls `getBoundingClientRect()` twice, which forces layout. Drags are already throttled to one per frame, but hover isn't. On a 1 kHz mouse in Firefox, or a dense map, this is the main cost of moving the pointer. Fix: keep the last event and handle it once per frame, the same way drags are handled; compute `toPoint` once.

### M5. Six selection, hover and drawing layers draw every feature at opacity 0 (performance)

`src/lib/map/style/layers.ts:663-733`

`indoor-drawing-*`, `indoor-selection-*` and `indoor-selection-point-*` all use the whole indoor source, filtered only by level, with feature-state opacity. MapLibre still builds buckets for, and draws, every line and point in those six layers. On a 10,000-room dataset that is about six times the line geometry for a few selected features. `EditOverlay` already exists as a small source. Fix: send the selected, hovered and being-drawn features' geometry to a small overlay source (or `EditOverlay`) and drop the feature-state paint. Selection redraws then cost what is selected.

### M6. The drawing frame lookup scans every feature on each hover before the first corner (performance)

`src/lib/ui/EditorView.svelte:309-313`, `:605`, `:635`, and `edit/modes/draw.ts:196`

`frameAt` spreads `editor.features.byId.values()` into a new array, then `containerAt` (`edit/unmapped-floor.ts:101`) point-in-polygon tests every feature. `draw.ts:196` calls it from `snapLines` on each hover before the first click. Fix: query level outlines and buildings through an rbush (`FeatureStore` already keeps `DraftIndex`); add `featuresAt(loc, level)` to `StoredFeatures`.

### M7. Downloads keep going for tiles you've panned away from (performance)

`src/lib/api/map-loader.ts:202`

The FIFO limiter (4 at a time) has no cancellation or priority. After a fast pan, the tiles in view wait behind every tile requested along the way. Fix: give queued tasks a "still wanted" check against the latest `load()` bounds, drop stale ones before they start, and pass an `AbortSignal` to `download`. iD aborts tile requests that leave the view. A minor side issue: `#limited` wakes a waiter after `#active--`, so a new caller can slip in and briefly run 5 at once.

### L1. Two unit tests fail on a Chromium that decodes JPEG XL

`floorplans/tile-codec.browser.test.ts:29` and `floorplans/codec.browser.test.ts:70` hard-code "Chromium doesn't read JXL". The preinstalled Chromium here does, so the codec correctly switches to JXL and the tests fail. They will fail in CI too once Playwright's Chromium ships JXL. Fix: assert against `probeSupport()`'s result (`expect(blob.type).toBe(support.decodesJxl ? "image/jxl" : "image/webp")`) and drop the fixed expectation.

### L2. Tagging edge cases

- `classify.ts:74`: `building=no` areas are classified `building` (`tags.building !== undefined`), while `isBuildingOutline` excludes `"no"`. Use the same test in both.
- `presets.ts:403`: `from.id.startsWith(to.id)` treats `amenity/bar_x` as a sub-preset of `amenity/bar`. Use `startsWith(to.id + "/")`.
- `presets.ts:523` `matchScore` lacks two parts of iD's: the `addTags` bonus and the `searchable: false` × 0.999 penalty. The result is different preset picks from iD's for some features.
- Presets with a `locationSet` (country-only presets) aren't filtered. `build-presets.ts` drops country-only _fields_ but not presets, so country-specific presets show in search everywhere and can win ties in `match`.
- `classify.ts` `doorWidth` doesn't read decimal commas (`0,9`) or feet and inches (`3'6"`). Both are common in the data.
- `labelFor` ignores `name:<locale>`. The viewer could prefer the UI locale's name.

### L3. Small correctness nits

- `api/changeset.ts:27`: `v.slice(0, 255)` cuts UTF-16 code units and can split an emoji into an invalid surrogate. `presets/text.ts` already does this correctly with code points; reuse `cleanValue`.
- `api/osm-api.ts`: `Number(changesetIdText)` isn't checked. A proxy or HTML error page answering 200 would produce changeset `NaN`.
- `map/hash.ts:82` assumes 256 px tiles, but MapLibre's zoom is 512 px tiles, so coordinates get one decimal less than "one pixel" at some zooms.
- The camera and hash drop bearing and pitch, but `dragRotate` is on, so a rotated view isn't kept in the link.
- `features.ts` `multipolygon()`: an inner ring is placed by its _first vertex_. An inner ring touching its outer at that vertex can fall into `polygons[0]`.
- `mode-manager` and keyboard: `event.repeat` isn't ignored, so holding a tool or operation key re-runs it.

---

## 2. Refactoring and simplification

### R1. Split `EditorView.svelte` (2,690 lines, 27 `$effect`s)

It holds building scope, drawing tools, the operations menu, frames and grid, guides, floor-plan wiring, keyboard handling, and a single 460-line map-lifetime `$effect` (`:1060-1520`) that builds every layer and every mode. Suggested cuts, each a pure move with no behaviour change:

1. `state/building-scope-controller.svelte.ts`: `enterBuilding`, `leaveBuilding`, `fitScope`, the hints, and `enterableAt`.
2. `edit/mode-factory.ts`: the `switch (kind)` that builds each mode from a small typed context object, instead of closures over a dozen component variables.
3. `ui/EditorLayers.svelte`, or a class: the overlay, guide, construction, grid, plan and indoor layer wiring, with one effect per layer.
4. `ui/OperationsMenu.svelte` and `ui/DrawToolbar.svelte`, which the existing snippets already outline.

This also makes the work in R2 and M5 easy to test.

### R2. One place for level-range expansion and the cap

`knownLevels`, `encodeLevels` and `listLevels` each expand ranges in their own loop (this is the cause of H2). Make one `wholeLevelsIn(range, cap)` in `levels/levels.ts`.

### R3. One storage wrapper

There are four hand-rolled `try { return localStorage } catch {}` blocks (`EditorView.svelte:290-296`, `MapShell.svelte:257`, `catalog.svelte.ts:104`, `panel-width.ts`), plus direct uses in `InspectorSection`, `ViewerView`, `TagEditor`, `recent-uploads` and `autosave`. Add a `persist/storage.ts` with `safeStorage("local" | "session")` and small `getJSON` and `setJSON` helpers (fixes M1).

### R4. Duplicated or diverging rules

- `isVertical` exists twice with different rules: `classify.ts:128` knows `room=stairs|elevator|escalator` and `buildingpart=verticalpassage`, while `validate.ts:183` doesn't. Choose one (in `osm/tags.ts` or `levels`) and say in a comment if the validator really wants the narrower one.
- `validate.ts:487` `ROOM_SPACES` and `:600` `SPACES` are the same set.
- The metres-to-pixels-at-z17 conversion is repeated for doors and rails (`features.ts:219,226`). Make it a `pixelsAtZ17(metres, lat)` helper.
- `[...editor.features.byId.values()]` is spread in three places in `EditorView` (see M6).

### R5. One polygon clipping library

`polyclip-ts` (unmapped floors, building checks) and `clipper2-ts` (area bands) are both shipped. Clipper2 does boolean operations too, works on integers so it is robust on near-degenerate OSM rings (polyclip has known throw-on-precision cases), and is faster. Move the two `polyclip-ts` call sites to Clipper2 and drop a dependency.

---

## 3. Dependencies

`bun outdated` on 25 November:

| Package                                                                                      | Now      | Latest    | Note                                                                              |
| -------------------------------------------------------------------------------------------- | -------- | --------- | --------------------------------------------------------------------------------- |
| maplibre-gl                                                                                  | 6.16.0   | 6.19.0    | Minor; worth taking (symbol and GeoJSON `updateData` fixes land often)            |
| @sveltejs/kit                                                                                | 3.1.0    | 3.4.0     | Minor                                                                             |
| svelte                                                                                       | 5.57.3   | 5.59.1    | Minor                                                                             |
| pdfjs-dist                                                                                   | 6.4.299  | 6.5.438   | Minor                                                                             |
| bits-ui                                                                                      | 2.20.2   | 2.22.0    | Minor                                                                             |
| @lucide/svelte                                                                               | 1.63.0   | 1.80.0    | Minor                                                                             |
| vitest / @vitest/browser-playwright                                                          | 5.0.5    | 5.1.2     | Minor                                                                             |
| playwright / @playwright/test                                                                | 1.63.0   | 1.65.1    | Minor; bump with the CI browser cache key                                         |
| immutable                                                                                    | 5.1.9    | 5.2.1     | Minor                                                                             |
| @biomejs/biome, vite, tailwindcss, svelte-check, @types/node, fake-indexeddb, adapter-static |          |           | Patches                                                                           |
| **osm-auth**                                                                                 | 3.2.0    | **4.0.0** | Major: check the changelog for the popup and PKCE API used in `session.svelte.ts` |
| **typescript**                                                                               | 6.0.3    | **7.0.2** | Major (native compiler): wait until `svelte-check` supports it                    |
| **tailwind-variants**                                                                        | 3.3.1    | **4.0.2** | Major: shadcn-svelte components use it                                            |
| clipper2-ts                                                                                  | 2.0.1-18 | 2.0.1-19  | **A prerelease pinned in runtime dependencies**; see R5                           |

Other dependency notes:

- Runtime libraries sit in `devDependencies`: `osm-auth`, `rbush`, `mode-watcher`, `tailwind-variants`, `cn`, `@internationalized/date`. That's harmless for a static build, but misleading. Move them to `dependencies`.
- There is no Renovate or Dependabot config. Add one, grouped weekly (MapLibre, Svelte, test tooling).
- CI uses `actions/checkout@v4` and `actions/setup-node@v4`; v5 runs on Node 24.
- `package.json` pins `bun@1.4.2`, while 1.4.4 is current.

## 4. Performance summary

Beyond M4 to M7:

- `FeatureStore.update` recomputes `knownLevels` over **all** drafts on every edit (`feature-store.ts:142`), and `IndoorMap.#updateBands` walks every feature on every edit and every `moveend` (`indoor-map.ts`). Keep a level count map (level → number of features), updated in `#redraft`, and have bands look features up through the existing rbush for the view.
- The editor loads about 2.6 MB of JS up front, about 600 KB of it gzipped. MapLibre is 1.66 MB raw and 450 KB gzipped. The editor route chunk is 500 KB raw and 148 KB gzipped. Presets and locale chunks already load lazily. The floor-plan tools (PDF, SVG, georef UI) could be a dynamic import behind the Floor plans pane.
- The JXL encoder and decoder (2.2 MB of WASM) load only in the plan worker, which is fine.

## 5. Questions

1. **H1:** when an upload fails with a network error _after_ the server may have applied it, should the retry still rebase if the changeset turns out empty? I recommend yes: always rebase, and use the changeset check only to detect "already applied".
2. **H2:** for an absurd range (`level=0-10000000`), would you rather draw the feature on its end levels only (like `encodeLevels` does today) or hide it and raise a validator issue? I'd do both: draw it on its ends, and raise the issue.
3. **R1:** do you want the `EditorView` split done as one PR per cut, or as one larger PR?

## Appendix: e2e run

The full suite ran here (Chromium, built app): **245 passed, 1 failed** (7.2 min).

- `tests/e2e/inspector.spec.ts:80` "lists the indoor types first, and the last types chosen above them" fails every time, including when run on its own. It fails at the **second** `selectRoom()`, after `reloadDiscardingEdits()`. The click on the room selects nothing ("Feature editor" never appears), and no dialog is left open. One possible cause, not checked: after the reload, `selectRoom`'s `page.goto` to the same URL is only a hash change, so `mapDrawn` may pass on the earlier draw and the click lands before the restored scope is ready. It needs a look to tell a test race from a real "nothing selectable after discarding restored edits" bug. If CI on `master` passes, this machine's newer Chromium may be part of it, like L1.
