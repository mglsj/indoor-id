import { afterEach, describe, expect, it } from "vitest";
import { place } from "#lib/floorplans/georef.ts";
import { VectorBuilder } from "#lib/floorplans/vector.ts";
import { Map as MapLibreMap } from "./maplibre.ts";
import { VectorPlanLayer } from "./vector-plan-layer.ts";

const WIDTH = 400;
const HEIGHT = 300;
/** Ground metres a CSS pixel spans at zoom 18 on the equator. */
const METRES_PER_PIXEL = (2 * Math.PI * 6378137) / (512 * 2 ** 18);

let map: MapLibreMap | undefined;
afterEach(() => {
	map?.remove();
	map = undefined;
	document.body.replaceChildren();
});

/** A white map, 400 × 300 px, centred on (0, 0) at zoom 18. */
async function whiteMap(): Promise<MapLibreMap> {
	const container = document.createElement("div");
	container.style.width = `${WIDTH}px`;
	container.style.height = `${HEIGHT}px`;
	document.body.append(container);
	const created = new MapLibreMap({
		container,
		style: {
			version: 8,
			sources: {},
			layers: [
				{
					id: "white",
					type: "background",
					paint: { "background-color": "#ffffff" },
				},
			],
		},
		center: [0, 0],
		zoom: 18,
		interactive: false,
		attributionControl: false,
		canvasContextAttributes: { preserveDrawingBuffer: true },
	});
	map = created;
	await created.once("load");
	return created;
}

/** The colour at CSS pixel (x, y), once the map has drawn. */
async function pixel(m: MapLibreMap, x: number, y: number): Promise<number[]> {
	m.triggerRepaint();
	await m.once("idle");
	const canvas = m.getCanvas();
	const ratio = canvas.width / WIDTH;
	const copy = new OffscreenCanvas(canvas.width, canvas.height);
	const context = copy.getContext("2d") as OffscreenCanvasRenderingContext2D;
	context.drawImage(canvas, 0, 0);
	return [
		...context.getImageData(Math.floor(x * ratio), Math.floor(y * ratio), 1, 1)
			.data,
	].slice(0, 3);
}

const close = (actual: number[], expected: number[]) =>
	actual.every((v, i) => Math.abs(v - (expected[i] ?? 0)) <= 3);

/**
 * A 400 × 300 unit plan over the whole map, one unit a CSS pixel: a red hairline across at
 * y 150.5, a green line 4 units wide down at x 300, a blue square from (20, 20) to (60, 60).
 */
function plan(layers?: { fill: string; lines: string }) {
	const builder = new VectorBuilder();
	builder.moveTo(20, 20);
	builder.lineTo(60, 20);
	builder.lineTo(60, 60);
	builder.lineTo(20, 60);
	builder.close();
	builder.fill({
		color: [0, 0, 255, 255],
		width: 0,
		layer: layers?.fill ?? null,
	});
	builder.clear();
	builder.moveTo(0, 150.5);
	builder.lineTo(400, 150.5);
	builder.stroke({
		color: [255, 0, 0, 255],
		width: 0,
		layer: layers?.lines ?? null,
	});
	builder.clear();
	builder.moveTo(300, 0);
	builder.lineTo(300, 300);
	builder.stroke({ color: [0, 255, 0, 255], width: 4, layer: null });
	return builder.build({ width: WIDTH, height: HEIGHT });
}

const transform = place(
	{ center: [0, 0], metresPerPixel: METRES_PER_PIXEL, bearing: 0 },
	WIDTH,
	HEIGHT,
);

describe("VectorPlanLayer (WebGL, in Chromium)", () => {
	it("draws hairlines one pixel wide, other lines at their width, fills under them", async () => {
		const m = await whiteMap();
		m.addLayer(new VectorPlanLayer("plan", plan(), transform, 1));
		expect(close(await pixel(m, 100, 150), [255, 0, 0])).toBe(true);
		expect(close(await pixel(m, 100, 149), [255, 255, 255])).toBe(true);
		expect(close(await pixel(m, 100, 151), [255, 255, 255])).toBe(true);
		// 4 units: x 298 to 302.
		expect(close(await pixel(m, 299, 100), [0, 255, 0])).toBe(true);
		expect(close(await pixel(m, 301, 100), [0, 255, 0])).toBe(true);
		expect(close(await pixel(m, 296, 100), [255, 255, 255])).toBe(true);
		expect(close(await pixel(m, 303, 100), [255, 255, 255])).toBe(true);
		expect(close(await pixel(m, 40, 40), [0, 0, 255])).toBe(true);
		expect(close(await pixel(m, 70, 40), [255, 255, 255])).toBe(true);
	});

	it("follows the plan when it moves, and its opacity", async () => {
		const m = await whiteMap();
		const layer = new VectorPlanLayer("plan", plan(), transform, 1);
		m.addLayer(layer);
		// 100 px east.
		layer.setTransform(
			place(
				{
					center: [100 * (360 / (512 * 2 ** 18)), 0],
					metresPerPixel: METRES_PER_PIXEL,
					bearing: 0,
				},
				WIDTH,
				HEIGHT,
			),
		);
		expect(close(await pixel(m, 140, 40), [0, 0, 255])).toBe(true);
		expect(close(await pixel(m, 40, 40), [255, 255, 255])).toBe(true);
		layer.setOpacity(0.5);
		expect(close(await pixel(m, 140, 40), [128, 128, 255])).toBe(true);
	});

	it("leaves out the paths of hidden CAD layers", async () => {
		const m = await whiteMap();
		const content = plan({ fill: "F", lines: "W" });
		const layer = new VectorPlanLayer(
			"plan",
			content,
			transform,
			1,
			new Set(["F"]),
		);
		m.addLayer(layer);
		expect(close(await pixel(m, 40, 40), [255, 255, 255])).toBe(true);
		expect(close(await pixel(m, 100, 150), [255, 0, 0])).toBe(true);
		layer.setHiddenLayers(new Set(["W"]));
		expect(close(await pixel(m, 40, 40), [0, 0, 255])).toBe(true);
		expect(close(await pixel(m, 100, 150), [255, 255, 255])).toBe(true);
		// Paths outside any layer always show.
		expect(close(await pixel(m, 299, 100), [0, 255, 0])).toBe(true);
	});
});
