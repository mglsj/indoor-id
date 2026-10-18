import {
	blend,
	clickMap,
	expectPixel,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	pixelAt,
	room,
	serveOsm,
	test,
} from "./fixtures.ts";

/** The style's selection colour (`INDOOR_COLORS.selection`). */
const SELECTION: [number, number, number] = [0xf5, 0x9e, 0x0b];
/** Room half-width (0.0002°) at zoom 19, in screen pixels: 0.0002 × 2^19 × 512 / 360. */
const HALF_WIDTH = 149;

test("a feature is outlined faintly under the pointer, and fully once selected", async ({
	page,
}) => {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	// On the room's west edge, away from its label.
	const edge = { x: x - HALF_WIDTH, y };
	const before = await pixelAt(page, edge.x, edge.y);

	await page.mouse.move(x, y);
	await expectPixel(page, edge.x, edge.y, blend(SELECTION, 0.45, before), 12);

	// Off the room: no outline.
	await page.mouse.move(x - 2 * HALF_WIDTH, y);
	await expectPixel(page, edge.x, edge.y, before);

	await clickMap(page);
	await expectPixel(page, edge.x, edge.y, SELECTION, 12);
	// Selected and hovered: the selection outline.
	await page.mouse.move(x + 10, y);
	await expectPixel(page, edge.x, edge.y, SELECTION, 12);
});
