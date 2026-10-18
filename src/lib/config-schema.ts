/**
 * Instance configuration, read at runtime from `static/config.json` so a deployed build can be
 * reconfigured without rebuilding. It must never contain secrets: it is public. `parseConfig`
 * checks it and fills in defaults, so a wrong file says what is wrong instead of failing later.
 */
export interface EditorConfig {
	/** OSM API base URL, e.g. https://api.openstreetmap.org or the dev server. */
	osm_api_url: string;
	/** OSM website handling the login; defaults to `osm_api_url` (true for the dev server). */
	oauth_url?: string;
	/** Public OAuth 2 client id registered on the OSM instance above (PKCE, no secret). */
	oauth_client_id: string;
	/** Editor Layer Index used to list background imagery; the osmlab one by default. */
	imagery_index_url?: string;
	/** Nominatim instance for place search; the OSMF one by default. */
	nominatim_url?: string;
	/** Taginfo API for value suggestions; the OSMF one by default. */
	taginfo_url?: string;
	/** Wikidata API; wikidata.org by default. */
	wikidata_api_url?: string;
	/** Wikipedia API, `{lang}` for the language; wikipedia.org by default. */
	wikipedia_api_url?: string;
	/** OSM wiki API, for tag documentation; wiki.openstreetmap.org by default. */
	osm_wiki_api_url?: string;
	/** URL of a MapLibre style used as the default basemap. */
	basemap_style: string;
	/** Minimal zoom at which OSM data is downloaded. */
	data_min_zoom: number;
	map_initial_zoom: number;
	/** [lat, lon], used when the URL has no valid hash. */
	map_initial_latlng: [number, number];
}

const OPTIONAL_URLS = [
	"oauth_url",
	"imagery_index_url",
	"nominatim_url",
	"taginfo_url",
	"wikidata_api_url",
	"wikipedia_api_url",
	"osm_wiki_api_url",
] as const;

const DEFAULTS = {
	data_min_zoom: 18,
	map_initial_zoom: 18,
	map_initial_latlng: [48.13678, -1.69533] as [number, number],
};

export function parseConfig(json: unknown): EditorConfig {
	if (typeof json !== "object" || json === null) {
		throw new Error("config.json must hold an object");
	}
	const raw = json as Record<string, unknown>;
	const problems: string[] = [];
	const url = (key: string, required: boolean): string | undefined => {
		const value = raw[key];
		if (value === undefined && !required) return undefined;
		if (typeof value === "string" && value !== "") return value;
		problems.push(`${key} must be a URL`);
		return undefined;
	};
	const number = (key: keyof typeof DEFAULTS & string, fallback: number) => {
		const value = raw[key];
		if (value === undefined) return fallback;
		if (typeof value === "number" && Number.isFinite(value)) return value;
		problems.push(`${key} must be a number`);
		return fallback;
	};

	const config: EditorConfig = {
		osm_api_url: url("osm_api_url", true) ?? "",
		oauth_client_id:
			typeof raw.oauth_client_id === "string" ? raw.oauth_client_id : "",
		basemap_style: url("basemap_style", true) ?? "",
		data_min_zoom: number("data_min_zoom", DEFAULTS.data_min_zoom),
		map_initial_zoom: number("map_initial_zoom", DEFAULTS.map_initial_zoom),
		map_initial_latlng: DEFAULTS.map_initial_latlng,
	};
	const latlng = raw.map_initial_latlng;
	if (latlng !== undefined) {
		if (
			Array.isArray(latlng) &&
			latlng.length === 2 &&
			latlng.every((n) => typeof n === "number" && Number.isFinite(n))
		) {
			config.map_initial_latlng = [latlng[0], latlng[1]];
		} else {
			problems.push("map_initial_latlng must be [lat, lon]");
		}
	}
	for (const key of OPTIONAL_URLS) {
		const value = url(key, false);
		if (value !== undefined) config[key] = value;
	}
	if (problems.length > 0) {
		throw new Error(`config.json: ${problems.join("; ")}`);
	}
	return config;
}
