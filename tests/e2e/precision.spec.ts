import type { Page } from "@playwright/test";
import {
	camera,
	expect,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	room,
	selectRoom,
	serveOsm,
	test,
} from "./fixtures.ts";

/** Lengths in metres (the tests' browser says en-US, which would be feet and inches). */
async function metric(page: Page) {
	// Only on the first load: a reload keeps the settings the test changed.
	await page.addInitScript(() => {
		if (localStorage.getItem("indoorid.precision") === null)
			localStorage.setItem(
				"indoorid.precision",
				JSON.stringify({ units: "metric" }),
			);
	});
}

async function emptyMap(page: Page) {
	await serveOsm(page, []);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	return mapCenter(page);
}

// At zoom 19 and 48.13° N a screen pixel is about 0.0997 m: 200 px is 19.9 m.

test("a side drawn near an axis snaps to it, with its length and angle by the pointer", async ({
	page,
}) => {
	await metric(page);
	const { x, y } = await emptyMap(page);
	await page.keyboard.press("2");
	await page.mouse.click(x - 100, y);
	// 6 px off the horizontal over 200 px: 1.7°, within the 5° that snap.
	await page.mouse.move(x + 100, y - 6);
	const readout = page.getByTestId("measure-pointer");
	await expect(readout).toHaveText(/^19\.9\d m · 0°$/);

	// Snapping off (S): the side follows the pointer.
	await page.keyboard.press("s");
	await page.mouse.move(x + 100, y - 7);
	await expect(readout).toHaveText(/^19\.9\d m · 2°$/);
	await page.keyboard.press("s");

	// The second side, square to the first: the angle is the corner's.
	// Snapped onto the axis, the corner is at y: 100 px up is 9.97 m.
	await page.mouse.click(x + 100, y - 6);
	await page.mouse.move(x + 104, y - 100);
	await expect(readout).toHaveText(/^(9\.9\d|10\.0\d) m · 90°$/);
	await page.keyboard.press("Escape");
	await expect(readout).toBeHidden();
});

test("Shift keeps the direction of the side being drawn", async ({ page }) => {
	await metric(page);
	const { x, y } = await emptyMap(page);
	await page.keyboard.press("2");
	await page.mouse.click(x, y);
	await page.mouse.move(x + 100, y - 101);
	const readout = page.getByTestId("measure-pointer");
	await expect(readout).toHaveText(/ · 45°$/);
	await page.keyboard.down("Shift");
	await page.mouse.move(x + 101, y - 100);
	// Locked: farther along the 45° line, not towards the pointer.
	await page.mouse.move(x + 200, y - 120);
	await expect(readout).toHaveText(/ · 45°$/);
	await page.keyboard.up("Shift");
	await page.mouse.move(x + 200, y - 120);
	await expect(readout).not.toHaveText(/ · 45°$/);
});

test("lengths show in feet and inches where the browser's language says so", async ({
	page,
}) => {
	const { x, y } = await emptyMap(page);
	await page.keyboard.press("2");
	await page.mouse.click(x - 100, y);
	await page.mouse.move(x + 100, y);
	// 19.9 m is 65' 4".
	await expect(page.getByTestId("measure-pointer")).toHaveText(
		/^65' \d+(¼|½|¾)?" · 0°$/,
	);
});

test("the snapping menu turns angles off and switches units", async ({
	page,
}) => {
	const { x, y } = await emptyMap(page);
	await page.getByRole("button", { name: "Snapping…" }).click();
	await page.getByLabel("Angles").click();
	await page.getByRole("radio", { name: "Metres" }).click();
	await page.keyboard.press("Escape");

	await page.keyboard.press("2");
	await page.mouse.click(x - 100, y);
	await page.mouse.move(x + 100, y - 7);
	await expect(page.getByTestId("measure-pointer")).toHaveText(
		/^19\.9\d m · 2°$/,
	);
});

test("a dragged corner shows the lengths of both its sides", async ({
	page,
}) => {
	await metric(page);
	await selectRoom(page);
	const { x, y } = await mapCenter(page);
	// The room's south-west corner (see geometry.spec.ts).
	await page.mouse.move(x - 149, y + 223);
	await page.mouse.down();
	await page.mouse.move(x - 160, y + 230, { steps: 4 });
	await expect(page.getByTestId("measure-side")).toHaveCount(2);
	await page.mouse.up();
	await expect(page.getByTestId("measure-side")).toHaveCount(0);
});

test("the side panel measures the selected room", async ({ page }) => {
	await metric(page);
	await selectRoom(page);
	await page.getByRole("button", { name: "Measurements" }).click();
	const measurements = page.getByTestId("measurements");
	await expect(measurements).toContainText("Area");
	await expect(measurements).toContainText("m²");
	await expect(measurements).toContainText("Perimeter");
});

/** Opens the new feature's panel past its type list, at its measurements. */
async function measurements(page: Page) {
	await page.getByRole("button", { name: "Back to the feature" }).click();
	await page.getByRole("button", { name: "Measurements" }).click();
	return page.getByTestId("measurements");
}

test("a typed length places the next corner, to the centimetre", async ({
	page,
}) => {
	await metric(page);
	const { x, y } = await emptyMap(page);
	await page.keyboard.press("2");
	await page.mouse.click(x - 100, y);
	await page.mouse.move(x + 50, y - 60);
	// Digits now go to the length, not to the tool shortcuts.
	await page.keyboard.type("3.5");
	await expect(page.getByTestId("typed-input")).toContainText("3.5");
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("typed-input")).toBeHidden();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("edit-count")).toHaveText("3");
	await expect(await measurements(page)).toContainText("3.50 m");
});

test("the rectangle tool takes a typed width;depth", async ({ page }) => {
	await metric(page);
	const { x, y } = await emptyMap(page);
	await page.keyboard.press("4");
	await expect(page.getByTestId("draw-hint")).toContainText("opposite");
	await page.mouse.click(x, y);
	await page.mouse.move(x + 80, y - 60);
	await expect(page.getByTestId("measure-pointer")).toContainText(" × ");
	await page.keyboard.type("4;3");
	await page.keyboard.press("Enter");
	// Four new nodes and the way.
	await expect(page.getByTestId("edit-count")).toHaveText("5");
	const measured = await measurements(page);
	await expect(measured).toContainText("12.00 m²");
	await expect(measured).toContainText("14.00 m");
});

test("the rectangle tool draws from a side after Tab", async ({ page }) => {
	await metric(page);
	const { x, y } = await emptyMap(page);
	await page.getByRole("button", { name: "Draw rectangle" }).click();
	await page.mouse.click(x, y);
	await page.keyboard.press("Tab");
	await expect(page.getByTestId("draw-hint")).toContainText("both ends");
	await page.mouse.click(x + 100, y - 100);
	await page.mouse.click(x + 150, y);
	await expect(page.getByTestId("edit-count")).toHaveText("5");
});

/** Metres on the ground to longitude and latitude around the map's middle. */
function at(east: number, north: number): [number, number] {
	const metre = (Math.PI / 180) * 6_371_008.8;
	return [
		LON + east / (metre * Math.cos((LAT * Math.PI) / 180)),
		LAT + north / metre,
	];
}

/** A 30 × 20 m building turned 30° counterclockwise from east, around the map's middle. */
function turnedBuilding() {
	const turn = (30 * Math.PI) / 180;
	const corners = [
		[-15, -10],
		[15, -10],
		[15, 10],
		[-15, 10],
	].map(([x = 0, y = 0]) =>
		at(
			x * Math.cos(turn) - y * Math.sin(turn),
			x * Math.sin(turn) + y * Math.cos(turn),
		),
	);
	return [
		...corners.map(([lon, lat], i) => ({
			type: "node",
			id: i + 1,
			lon,
			lat,
			version: 1,
		})),
		{
			type: "way",
			id: 10,
			version: 1,
			nodes: [1, 2, 3, 4, 1],
			tags: { building: "yes" },
		},
	];
}

/** The frames kept in IndexedDB, by building. */
function storedFrames(page: Page): Promise<Record<string, { angle: number }>> {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const open = indexedDB.open("indoorid-floorplans");
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					const store = db.transaction("frames").objectStore("frames");
					const all: Record<string, { angle: number }> = {};
					const cursor = store.openCursor();
					cursor.onsuccess = () => {
						const c = cursor.result;
						if (!c) {
							db.close();
							resolve(all);
							return;
						}
						all[String(c.key)] = c.value;
						c.continue();
					};
				};
			}),
	);
}

test("G shows the grid, and the snapping menu takes its spacing", async ({
	page,
}) => {
	await metric(page);
	await emptyMap(page);
	const grid = page.getByRole("button", { name: "Show the grid" });
	await expect(grid).toHaveAttribute("aria-pressed", "false");
	await page.keyboard.press("g");
	await expect(grid).toHaveAttribute("aria-pressed", "true");

	await page.getByRole("button", { name: "Snapping…" }).click();
	const minor = page.getByLabel("Lines every");
	await minor.fill("1 m");
	await minor.press("Enter");
	await page.keyboard.press("Escape");
	await page.reload();
	await camera(page);
	await expect(grid).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: "Snapping…" }).click();
	await expect(page.getByLabel("Lines every")).toHaveValue(/^1(\.00)? m$/);
});

test("the drawing frame follows a turned building, and can be set and kept", async ({
	page,
}) => {
	await serveOsm(page, turnedBuilding());
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await page.getByRole("button", { name: "Snapping…" }).click();
	const state = page.getByTestId("frame-state");
	await expect(state).toHaveText("30°, along the building");

	await page.getByLabel("Frame angle").fill("10");
	await page.getByRole("button", { name: "OK" }).click();
	await expect(state).toHaveText("10°, set by you");
	await expect
		.poll(() => storedFrames(page))
		.toEqual({ w10: expect.objectContaining({ angle: 10 }) });

	await page.reload();
	await camera(page);
	await page.getByRole("button", { name: "Snapping…" }).click();
	await expect(state).toHaveText("10°, set by you");
	await page.getByRole("button", { name: "Use the building's" }).click();
	await expect(state).toHaveText("30°, along the building");
});

test("the drawing frame aligns to a clicked side", async ({ page }) => {
	await serveOsm(page, turnedBuilding());
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	const { x, y } = await mapCenter(page);
	await page.getByRole("button", { name: "Snapping…" }).click();
	await page.getByLabel("Frame angle").fill("10");
	await page.getByRole("button", { name: "OK" }).click();
	await page.getByRole("button", { name: "Align to a side" }).click();
	await expect(page.getByTestId("frame-hint")).toBeVisible();
	// The north side's middle: 10 m from the middle, turned 30°; a pixel is about 0.0997 m.
	await page.mouse.click(x - 50, y - 87);
	await expect(page.getByTestId("frame-hint")).toBeHidden();
	await page.getByRole("button", { name: "Snapping…" }).click();
	await expect(page.getByTestId("frame-state")).toHaveText("30°, set by you");
});

/** The room of `selectRoom`, not selected: its north side runs 149 px either side, 223 px up. */
async function roomMap(page: Page) {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
	return mapCenter(page);
}

test("resting on a side arms its extension, snapped to past its end", async ({
	page,
}) => {
	await metric(page);
	const { x, y } = await roomMap(page);
	await page.keyboard.press("2");
	await page.mouse.click(x + 300, y + 100);
	// A second on the north side, then past its east end, 4 px off its line.
	await page.mouse.move(x, y - 223);
	await page.waitForTimeout(1200);
	await page.mouse.move(x + 1, y - 223);
	await page.mouse.move(x + 220, y - 219);
	await expect(page.getByTestId("inference")).toHaveText("Extension");
});

test("resting on a corner lines a new corner up with it", async ({ page }) => {
	await metric(page);
	const { x, y } = await roomMap(page);
	await page.keyboard.press("2");
	await page.mouse.click(x + 300, y + 150);
	// Half a second on the north-west corner, then level with it east of the room, 3 px off.
	await page.mouse.move(x - 149, y - 223);
	await page.waitForTimeout(700);
	// Still on it: arms on this move too, should the timer run late on a busy machine.
	await page.mouse.move(x - 148, y - 223);
	await page.mouse.move(x + 297, y - 220);
	await expect(page.getByTestId("inference")).toHaveText(
		"In line with a corner",
	);
	// Straight up from the first corner, level with the room's north side: 373 px, 37.2 m.
	await expect(page.getByTestId("measure-pointer")).toHaveText(
		/^37\.\d\d m · 90°$/,
	);
});

test("M measures between two clicks, shown until the next measure", async ({
	page,
}) => {
	await metric(page);
	const { x, y } = await emptyMap(page);
	await page.keyboard.press("m");
	await expect(page.getByTestId("draw-hint")).toContainText("measure");
	await page.mouse.click(x - 100, y);
	await page.mouse.click(x + 100, y);
	await page.mouse.move(x, y + 150);
	await expect(page.getByTestId("measure-side")).toHaveText(/^19\.9\d m · 0°$/);
	// Nothing was drawn.
	await expect(page.getByTestId("edit-count")).toHaveText("0");
});

test("a guide at a typed distance from a side is snapped to, and kept", async ({
	page,
}) => {
	await metric(page);
	const { x, y } = await roomMap(page);
	await page.getByRole("button", { name: "Measure and guide" }).click();
	await page
		.getByTestId("measure-mode")
		.getByRole("radio", { name: "Guide" })
		.click();
	await expect(page.getByTestId("draw-hint")).toContainText("guide");
	// The room's north side, then 2 m north of it.
	await page.mouse.click(x, y - 223);
	await page.mouse.move(x, y - 300);
	await page.keyboard.type("2");
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("draw-hint")).toBeHidden();

	// A side drawn straight up east of the room stops on the guide, 20 px above the side.
	await page.keyboard.press("2");
	await page.mouse.click(x + 250, y - 100);
	await page.mouse.move(x + 251, y - 241);
	await expect(page.getByTestId("inference")).toHaveText("Intersection");
	await expect(page.getByTestId("measure-pointer")).toHaveText(
		/^14\.2\d m · 90°$/,
	);
	await page.keyboard.press("Escape");

	await expect.poll(() => storedGuides(page)).toBe(1);
	await page.reload();
	await camera(page);
	await page.getByRole("button", { name: "Snapping…" }).click();
	await expect(page.getByTestId("guides-count")).toHaveText(
		"Guides on this level: 1",
	);
	await page.getByRole("button", { name: "Manage guides…" }).click();
	const pane = page.getByTestId("guides-pane");
	await expect(
		pane.getByTestId("guides-list").getByRole("listitem"),
	).toHaveCount(1);
	await pane.getByRole("button", { name: "Hide guide 1" }).click();
	await expect(
		pane.getByRole("button", { name: "Show guide 1" }),
	).toBeVisible();
	await pane.getByRole("button", { name: "Delete guide 1" }).click();
	await expect(pane.getByTestId("guides-list")).toBeHidden();
	await expect.poll(() => storedGuides(page)).toBe(0);
});

/** How many construction guides IndexedDB holds. */
function storedGuides(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const open = indexedDB.open("indoorid-floorplans");
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					if (!db.objectStoreNames.contains("guides")) {
						db.close();
						resolve(0);
						return;
					}
					const count = db.transaction("guides").objectStore("guides").count();
					count.onsuccess = () => {
						db.close();
						resolve(count.result);
					};
				};
			}),
	);
}

test("arrow keys nudge the selection, not the map", async ({ page }) => {
	await metric(page);
	await selectRoom(page);
	const before = await camera(page);
	await page.keyboard.press("Shift+ArrowRight");
	await page.keyboard.press("ArrowUp");
	// The room's four nodes moved, in two steps.
	await expect(page.getByTestId("edit-count")).toHaveText("4");
	expect(await camera(page)).toEqual(before);
	await page.keyboard.press("Control+z");
	await page.keyboard.press("Control+z");
	await expect(page.getByTestId("edit-count")).toHaveText("0");
});

test("a side's length is typed in the measurements", async ({ page }) => {
	await metric(page);
	await selectRoom(page);
	await page.getByRole("button", { name: "Measurements" }).click();
	const first = page.getByLabel("Side 1");
	await first.fill("35 m");
	await first.press("Enter");
	await expect(first).toHaveValue("35.00 m");
	await expect(page.getByTestId("edit-count")).toHaveText("1");
});

test("E moves a side of the selected room by a typed distance", async ({
	page,
}) => {
	await metric(page);
	await selectRoom(page);
	const { x, y } = await mapCenter(page);
	await page.keyboard.press("e");
	await expect(page.getByTestId("transform-hint")).toContainText("side");
	// The east side, then 2 m east of it.
	await page.mouse.click(x + 149, y);
	await page.mouse.move(x + 200, y + 5);
	await expect(page.getByTestId("measure-pointer")).toHaveText(/^5\.\d\d m$/);
	await page.keyboard.type("2");
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("transform-hint")).toBeHidden();
	await expect(page.getByTestId("edit-count")).toHaveText("2");
});

test("O makes a parallel copy of the selected room, selected after", async ({
	page,
}) => {
	await metric(page);
	await selectRoom(page);
	const { x, y } = await mapCenter(page);
	await page.keyboard.press("o");
	await page.mouse.move(x + 100, y);
	await page.keyboard.type("1");
	await page.keyboard.press("Enter");
	// Four new nodes and the way.
	await expect(page.getByTestId("edit-count")).toHaveText("5");
});
