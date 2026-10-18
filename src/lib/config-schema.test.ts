import { describe, expect, it } from "vitest";
import { parseConfig } from "./config-schema.ts";

const minimal = {
	osm_api_url: "https://api.openstreetmap.org",
	oauth_client_id: "abc",
	basemap_style: "https://tiles.example/style.json",
};

describe("parseConfig", () => {
	it("fills in what an instance may leave out", () => {
		expect(parseConfig(minimal)).toEqual({
			...minimal,
			data_min_zoom: 18,
			map_initial_zoom: 18,
			map_initial_latlng: [48.13678, -1.69533],
		});
	});

	it("keeps the optional service URLs given, and drops keys it doesn't know", () => {
		const config = parseConfig({
			...minimal,
			editor_name: "IndoorID",
			taginfo_url: "https://taginfo.example/api/4/",
			data_min_zoom: 17,
		});
		expect(config.taginfo_url).toBe("https://taginfo.example/api/4/");
		expect(config.data_min_zoom).toBe(17);
		expect(config).not.toHaveProperty("editor_name");
	});

	it("says which settings are missing or wrong", () => {
		expect(() => parseConfig({ oauth_client_id: "abc" })).toThrow(
			"config.json: osm_api_url must be a URL; basemap_style must be a URL",
		);
		expect(() =>
			parseConfig({ ...minimal, map_initial_latlng: [1], data_min_zoom: "18" }),
		).toThrow(
			"config.json: data_min_zoom must be a number; map_initial_latlng must be [lat, lon]",
		);
		expect(() => parseConfig(null)).toThrow("config.json must hold an object");
	});
});
