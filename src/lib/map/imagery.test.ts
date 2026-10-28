import { describe, expect, it } from "vitest";
import {
	availableImagery,
	type EliFeature,
	parseImageryIndex,
	rasterSource,
} from "./imagery.ts";

const tms = (props: Partial<EliFeature["properties"]> = {}): EliFeature => ({
	type: "Feature",
	geometry: null,
	properties: {
		id: "example",
		name: "Example",
		type: "tms",
		url: "https://tiles.example.org/{zoom}/{x}/{y}.jpg",
		...props,
	},
});

/** A square region from (x0, y0) to (x1, y1). */
const region = (x0: number, y0: number, x1: number, y1: number) => ({
	type: "Polygon" as const,
	coordinates: [
		[
			[x0, y0],
			[x1, y0],
			[x1, y1],
			[x0, y1],
			[x0, y0],
		],
	],
});

describe("rasterSource", () => {
	it("converts a TMS template", () => {
		expect(
			rasterSource(
				tms({
					min_zoom: 2,
					max_zoom: 20,
					attribution: { text: "© Example & co", url: "https://example.org/" },
				}).properties,
			),
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
		const source = rasterSource(
			tms({ url: "https://tiles.example.org/{z}/{x}/{-y}.png" }).properties,
		);
		expect(source).toMatchObject({
			tiles: ["https://tiles.example.org/{z}/{x}/{y}.png"],
			scheme: "tms",
		});
	});

	it("expands {switch:} into one URL per server", () => {
		const source = rasterSource(
			tms({ url: "https://{switch:a,b,c}.tiles.example.org/{zoom}/{x}/{y}" })
				.properties,
		);
		expect(source?.tiles).toEqual([
			"https://a.tiles.example.org/{z}/{x}/{y}",
			"https://b.tiles.example.org/{z}/{x}/{y}",
			"https://c.tiles.example.org/{z}/{x}/{y}",
		]);
	});

	it("asks Esri for missing tiles rather than its placeholder picture", () => {
		const esri = (url: string) => rasterSource(tms({ url }).properties)?.tiles;
		expect(
			esri(
				"https://{switch:services,server}.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}",
			),
		).toEqual([
			"https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
			"https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false",
		]);
		expect(
			esri(
				"https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}?token=x",
			),
		).toEqual([
			"https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=x&blankTile=false",
		]);
		const kept =
			"https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{zoom}/{y}/{x}?blankTile=true";
		expect(esri(kept)).toEqual([kept.replace("{zoom}", "{z}")]);
		expect(
			esri("https://tiles.example.org/MapServer/tile/{zoom}/{y}/{x}"),
		).toEqual(["https://tiles.example.org/MapServer/tile/{z}/{y}/{x}"]);
	});

	it("converts a WMS template in Web Mercator", () => {
		const source = rasterSource({
			id: "wms",
			name: "WMS",
			type: "wms",
			url: "https://wms.example.org/?SERVICE=WMS&CRS={proj}&BBOX={bbox}&WIDTH={width}&HEIGHT={height}",
			available_projections: ["EPSG:4326", "EPSG:3857"],
		});
		expect(source?.tiles).toEqual([
			"https://wms.example.org/?SERVICE=WMS&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256",
		]);
	});

	it.each([
		[
			"a WMS without Web Mercator",
			{
				type: "wms",
				url: "https://wms.example.org/?BBOX={bbox}",
				available_projections: ["EPSG:2154"],
			},
		],
		["Bing", { type: "bing", url: "https://www.bing.com/maps" }],
		[
			"a source needing an API key",
			{ url: "https://tiles.example.org/{z}/{x}/{y}?key={apikey}" },
		],
		[
			"an unknown placeholder",
			{ url: "https://tiles.example.org/{z}/{x}/{y}?t={token}" },
		],
	])("rejects %s", (_, props) => {
		expect(
			rasterSource(tms(props as Partial<EliFeature["properties"]>).properties),
		).toBeNull();
	});
});

describe("parseImageryIndex", () => {
	const now = new Date("2026-10-01");

	it("keeps usable background imagery only", () => {
		const entries = parseImageryIndex(
			{
				type: "FeatureCollection",
				features: [
					tms({ id: "photo", name: "Photo" }),
					tms({ id: "overlay", overlay: true }),
					tms({ id: "bing", type: "bing" }),
					tms({ id: "old", end_date: "2010-01-01" }),
					tms({ id: "recent", end_date: "2020-01-01" }),
				],
			},
			now,
		);
		expect(entries.map((e) => e.id)).toEqual(["photo", "recent"]);
	});
});

describe("availableImagery", () => {
	const entries = parseImageryIndex(
		{
			type: "FeatureCollection",
			features: [
				tms({ id: "world", name: "World" }),
				{
					...tms({ id: "france", name: "France", best: true }),
					geometry: region(-5, 41, 10, 51),
				},
				{
					...tms({ id: "spain", name: "Spain" }),
					geometry: region(-10, 35, 4, 43.5),
				},
				{
					...tms({ id: "split", name: "Split" }),
					geometry: {
						type: "MultiPolygon",
						coordinates: [
							region(0, 0, 1, 1).coordinates,
							region(-2, 48, -1, 49).coordinates,
						],
					},
				},
			],
		},
		new Date("2026-10-01"),
	);

	it("lists the imagery covering a place, best first", () => {
		expect(availableImagery(entries, [-1.69, 48.13]).map((e) => e.id)).toEqual([
			"france",
			"world",
			"split",
		]);
	});

	it("lists worldwide imagery everywhere", () => {
		expect(availableImagery(entries, [100, -30]).map((e) => e.id)).toEqual([
			"world",
		]);
	});
});
