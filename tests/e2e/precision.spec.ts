import type { Page } from "@playwright/test";
import {
	camera,
	expect,
	LAT,
	LON,
	mapCenter,
	selectRoom,
	serveOsm,
	test,
} from "./fixtures.ts";

/** Lengths in metres (the tests' browser says en-US, which would be feet and inches). */
async function metric(page: Page) {
	await page.addInitScript(() =>
		localStorage.setItem(
			"indoorid.precision",
			JSON.stringify({ units: "metric" }),
		),
	);
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
