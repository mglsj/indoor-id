import { describe, expect, it } from "vitest";
import {
	customImagery,
	ESRI_IMAGERY,
	imageryFor,
	offsetPixels,
	offsetTileParts,
	rasterSource,
	tileUrl,
} from "./backgrounds.ts";

describe("rasterSource", () => {
	it("converts a TMS template", () => {
		expect(
			rasterSource("https://tiles.example.org/{zoom}/{x}/{y}.jpg", {
				minzoom: 2,
				maxzoom: 20,
				attribution: { text: "© Example & co", url: "https://example.org/" },
			}),
		).toEqual({
			type: "raster",
			tiles: ["https://tiles.example.org/{z}/{x}/{y}.jpg"],
			tileSize: 256,
			minzoom: 2,
			maxzoom: 20,
			attribution:
				'<a href="https://example.org/" target="_blank" rel="noopener">© Example &amp; co</a>',
		});
	});

	it("uses the TMS scheme for {-y}", () => {
		expect(
			rasterSource("https://tiles.example.org/{z}/{x}/{-y}.png"),
		).toMatchObject({
			tiles: ["https://tiles.example.org/{z}/{x}/{y}.png"],
			scheme: "tms",
		});
	});

	it("expands {switch:} into one URL per server", () => {
		expect(
			rasterSource("https://{switch:a,b,c}.tiles.example.org/{zoom}/{x}/{y}")
				?.tiles,
		).toEqual([
			"https://a.tiles.example.org/{z}/{x}/{y}",
			"https://b.tiles.example.org/{z}/{x}/{y}",
			"https://c.tiles.example.org/{z}/{x}/{y}",
		]);
	});

	it("asks Esri for missing tiles rather than its placeholder picture", () => {
		expect(ESRI_IMAGERY.map((imagery) => imagery.source.tiles)).toEqual([
			[
				"https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
				"https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
			],
			[
				"https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
			],
		]);
		const kept =
			"https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=true";
		expect(rasterSource(kept)?.tiles).toEqual([kept]);
		expect(
			rasterSource("https://tiles.example.org/MapServer/tile/{z}/{y}/{x}")
				?.tiles,
		).toEqual(["https://tiles.example.org/MapServer/tile/{z}/{y}/{x}"]);
	});

	it("takes Web Mercator WMS and quadkey URLs", () => {
		const wms =
			"https://wms.example.org/?CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256";
		expect(rasterSource(wms)?.tiles).toEqual([wms]);
		expect(rasterSource("https://t.example.org/{quadkey}.jpg")?.tiles).toEqual([
			"https://t.example.org/{quadkey}.jpg",
		]);
	});

	it.each([
		["an API key", "https://tiles.example.org/{z}/{x}/{y}?key={apikey}"],
		["an unknown placeholder", "https://tiles.example.org/{z}/{x}/{y}?t={t}"],
		["no zoom", "https://tiles.example.org/tile.png"],
		["no row", "https://tiles.example.org/{z}/{x}.png"],
	])("rejects a URL with %s", (_, url) => {
		expect(rasterSource(url)).toBeNull();
	});
});

describe("imageryFor", () => {
	it("shows no imagery over the map", () => {
		expect(imageryFor("map", "")).toBeNull();
	});

	it("finds Esri's imagery", () => {
		expect(imageryFor("esri-clarity", "")?.name).toBe(
			"Esri World Imagery (Clarity) Beta",
		);
	});

	it("names custom imagery after its URL", () => {
		const imagery = imageryFor(
			"custom",
			" https://tiles.example.org/{z}/{x}/{y}.png ",
		);
		expect(imagery).toMatchObject({
			id: "custom",
			name: "Custom (https://tiles.example.org/{z}/{x}/{y}.png)",
			source: { tiles: ["https://tiles.example.org/{z}/{x}/{y}.png"] },
		});
	});

	it("refuses a custom URL that isn't a web tile template", () => {
		expect(customImagery("")).toBeNull();
		expect(customImagery("file:///tiles/{z}/{x}/{y}.png")).toBeNull();
		expect(customImagery("https://example.org/map.png")).toBeNull();
	});
});

describe("offsetPixels", () => {
	it("moves one pixel per 156 543 m at zoom 0 on the equator", () => {
		const [dx, dy] = offsetPixels({ east: 156543.03392804097, north: 0 }, 0, 0);
		expect(dx).toBeCloseTo(1, 9);
		expect(dy).toBeCloseTo(0, 9);
	});

	it("counts ground metres where Web Mercator stretches them", () => {
		// Rennes (48.13° N) at zoom 20: a pixel is 0.09964 m on the ground.
		const [dx, dy] = offsetPixels(
			{ east: 0.0996432, north: 0.996432 },
			20,
			363933,
		);
		expect(dx).toBeCloseTo(1, 3);
		expect(dy).toBeCloseTo(-10, 2);
	});
});

describe("offsetTileParts", () => {
	it("draws an unmoved tile from itself", () => {
		expect(offsetTileParts(3, 2, 5, [0, 0])).toEqual([
			{ x: 2, y: 5, left: 0, top: 0 },
		]);
	});

	it("draws a tile moved right and up from four source tiles", () => {
		// Imagery moved 10 px right and 20 px up: the tile shows its left and lower neighbours.
		expect(offsetTileParts(3, 2, 5, [10, -20])).toEqual([
			{ x: 1, y: 5, left: -246, top: -20 },
			{ x: 2, y: 5, left: 10, top: -20 },
			{ x: 1, y: 6, left: -246, top: 236 },
			{ x: 2, y: 6, left: 10, top: 236 },
		]);
	});

	it("wraps around the antimeridian and stops at the poles", () => {
		expect(offsetTileParts(1, 0, 0, [5, 5])).toEqual([
			{ x: 1, y: 0, left: -251, top: 5 },
			{ x: 0, y: 0, left: 5, top: 5 },
		]);
	});
});

describe("tileUrl", () => {
	it("fills the placeholders of a tile", () => {
		const source = rasterSource(
			"https://{switch:a,b}.example.org/{z}/{x}/{-y}/{quadkey}",
		);
		expect(source && tileUrl(source, 3, 2, 5)).toBe(
			"https://b.example.org/3/2/2/212",
		);
	});

	it("fills a Web Mercator bounding box", () => {
		const source = rasterSource(
			"https://wms.example.org/?BBOX={bbox-epsg-3857}",
		);
		expect(source && tileUrl(source, 1, 1, 0)).toBe(
			"https://wms.example.org/?BBOX=0,0,20037508.342789244,20037508.342789244",
		);
	});
});
