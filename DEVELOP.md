# Develop

IndoorID is a client-side web application written in TypeScript with [Svelte 5](https://svelte.dev) and [SvelteKit](https://svelte.dev/docs/kit), rendered with [MapLibre GL JS](https://maplibre.org) and styled with [Tailwind CSS](https://tailwindcss.com) and [shadcn-svelte](https://shadcn-svelte.com) components. It has no backend of its own: OpenStreetMap is the backend.

> IndoorID is a rewrite of the OsmInEdit 1.x editor (React + Leaflet). Its last version is kept under the git tag `legacy-v1.0.16`.

## Requirements

- [Bun](https://bun.sh) 1.4 (package manager and script runner)
- Node.js 24 or later (runs Vite, SvelteKit and the test tools)

## Commands

Install dependencies with `bun install`, then:

| Command             | Description                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `bun run dev`       | Starts a development server on [http://localhost:5173](http://localhost:5173) |
| `bun run build`     | Builds the static site into `build/`, ready to be served by any web server    |
| `bun run preview`   | Serves the production build locally                                           |
| `bun run check`     | Type-checks TypeScript and Svelte files                                       |
| `bun run lint`      | Checks formatting and lint rules (Biome)                                      |
| `bun run format`    | Formats and applies safe lint fixes (Biome)                                   |
| `bun run test:unit` | Runs unit tests (Vitest), found next to the code as `*.test.ts`               |
| `bun run test:e2e`  | Builds the app and runs browser tests (Playwright) from `tests/e2e`           |

The first time you run browser tests, install Chromium with `bunx playwright install chromium`.

## Project layout

```
src/
  app.html, app.css     Page shell, Tailwind and shadcn-svelte theme
  routes/               SvelteKit pages (the editor is the root page)
  lib/                  Application code, imported as `#lib/...`
    config.ts           Runtime configuration loader
    map/                Map helpers: MapLibre entry point, URL hash, ...
    components/shadcn/  shadcn-svelte components (added with `bunx shadcn-svelte@latest add`)
    ui/                 The editor's Svelte components
static/                 Files copied as-is: config.json, images
tests/e2e/              Playwright tests; external requests are mocked
```

Imports inside `src/lib` use the `#lib/*` [subpath import](https://nodejs.org/api/packages.html#subpath-imports) with explicit file extensions, e.g. `import { parseHash } from "#lib/map/hash.ts"`.

Always import MapLibre from `#lib/map/maplibre.ts`, never from `maplibre-gl` directly: that module registers the MapLibre web worker, without which no data source can load.

SvelteKit is configured in `vite.config.ts` (SvelteKit 3 no longer reads `svelte.config.js`).

## Configuration

`static/config.json` is read at runtime, so it can be edited in a deployed `build/` folder without rebuilding. It is public: never put secrets in it.

| Key                  | Description                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor_name`        | Name of this instance                                                                                                                                                           |
| `osm_api_url`        | OSM API to read and edit: `https://api.openstreetmap.org` (the default), or the [development API](https://master.apis.dev.openstreetmap.org) to test uploads                    |
| `oauth_url`          | OSM website handling the login and changeset links (`https://www.openstreetmap.org` with the production API; defaults to `osm_api_url`, which is right for the development API) |
| `oauth_client_id`    | Public client id of an [OAuth 2 application](https://wiki.openstreetmap.org/wiki/OAuth) registered on that OSM instance, without client secret (PKCE)                           |
| `imagery_index_url`  | [Editor Layer Index](https://github.com/osmlab/editor-layer-index) listing background imagery (optional, defaults to the osmlab one)                                            |
| `nominatim_url`      | Nominatim instance used for place search (optional, defaults to `https://nominatim.openstreetmap.org`)                                                                          |
| `basemap_style`      | URL of a MapLibre style used as background map                                                                                                                                  |
| `data_min_zoom`      | Minimal zoom at which OSM data is downloaded                                                                                                                                    |
| `map_initial_zoom`   | Zoom used when the URL has no position                                                                                                                                          |
| `map_initial_latlng` | `[lat, lon]` used when the URL has no position                                                                                                                                  |

### Logging in

Register an OAuth 2 application on the OSM instance (your user settings, "OAuth 2 applications") with:

- permissions: _Read user preferences_ and _Modify the map_;
- redirect URI: the editor's URL followed by `auth/callback`, e.g. `http://localhost:5173/auth/callback` for development;
- confidential application: **unchecked** (IndoorID uses PKCE and has no secret).

Put its client id in `oauth_client_id`.

To try uploads without touching the real map, register the application on the
[development server](https://master.apis.dev.openstreetmap.org) instead, set `osm_api_url` to
`https://master.apis.dev.openstreetmap.org` and remove `oauth_url`. Its data is a test sandbox:
anyone can edit it, so expect names and shapes that don't match reality.

## Translations

Translations are managed on [Transifex](https://www.transifex.com/openlevelup/osminedit). The translation setup of the new editor is not in place yet; existing translations remain available in the `legacy-v1.0.16` tag.
