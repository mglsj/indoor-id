import { describe, expect, it } from "vitest";
import {
	customImagery,
	displayPaint,
	ESRI_IMAGERY,
	imageryFor,
	inAncestor,
	offsetPixels,
	rasterSource,
	tilesIn,
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
	it("moves one pixel per 156 543 m at zoom 0 (a 256 px world) on the equator", () => {
		const [dx, dy] = offsetPixels(
			{ east: 156543.03392804097, north: 0 },
			0,
			256,
		);
		expect(dx).toBeCloseTo(1, 9);
		expect(dy).toBeCloseTo(0, 9);
	});

	it("counts ground metres where Web Mercator stretches them", () => {
		// Rennes (48.13° N) at zoom 20 in 256 px tiles: a pixel is 0.09964 m on the ground.
		const [dx, dy] = offsetPixels(
			{ east: 0.0996432, north: 0.996432 },
			48.13,
			256 * 2 ** 20,
		);
		expect(dx).toBeCloseTo(1, 3);
		expect(dy).toBeCloseTo(-10, 2);
	});
});

describe("tilesIn", () => {
	it("covers a box with a tile more on every side", () => {
		// Zoom 2: columns of 90°, rows split at 0° and ±66.51°.
		const tiles = tilesIn({ west: 10, south: 10, east: 20, north: 20 }, 2);
		expect(tiles.map(({ x, y }) => `${x}/${y}`)).toEqual([
			"1/0",
			"2/0",
			"3/0",
			"1/1",
			"2/1",
			"3/1",
			"1/2",
			"2/2",
			"3/2",
		]);
	});

	it("wraps columns across the antimeridian and stops at the poles", () => {
		const tiles = tilesIn({ west: 170, south: 80, east: 190, north: 85 }, 1, 0);
		expect(tiles).toEqual([
			{ z: 1, x: 1, y: 0, column: 1 },
			{ z: 1, x: 2, y: 0, column: 0 },
		]);
	});
});

describe("inAncestor", () => {
	it("finds the part of a tile's ancestor it covers", () => {
		expect(inAncestor(3, 5, 6, 1)).toEqual({
			x: 1,
			y: 1,
			left: 0.25,
			top: 0.5,
			size: 0.25,
		});
		expect(inAncestor(3, 5, 6, 3)).toEqual({
			x: 5,
			y: 6,
			left: 0,
			top: 0,
			size: 1,
		});
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

describe("displayPaint", () => {
	it("leaves imagery as served at 1", () => {
		expect(displayPaint({ brightness: 1, contrast: 1, saturation: 1 })).toEqual(
			{
				"raster-brightness-min": 0,
				"raster-brightness-max": 1,
				"raster-contrast": 0,
				"raster-saturation": 0,
			},
		);
	});

	it("darkens below 1 and lightens above, as iD's sliders", () => {
		expect(
			displayPaint({ brightness: 0.5, contrast: 2, saturation: 0 }),
		).toEqual({
			"raster-brightness-min": 0,
			"raster-brightness-max": 0.5,
			"raster-contrast": 1,
			"raster-saturation": -1,
		});
		expect(
			displayPaint({ brightness: 1.5, contrast: 1, saturation: 1 })[
				"raster-brightness-min"
			],
		).toBe(0.5);
	});
});
