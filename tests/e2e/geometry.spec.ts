import type { Page } from "@playwright/test";
import {
	camera,
	expect,
	expectPixel,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	pixelAt,
	room,
	selectRoom,
	serveOsm,
	test,
} from "./fixtures.ts";

/**
 * A room's half-width and half-height (0.0002°) at zoom 19, in screen pixels: 0.0002 × 2^19 ×
 * 512 / 360, and that divided by cos(48.13°) in Web Mercator.
 */
const HALF_WIDTH = 149;
const HALF_HEIGHT = 223;

/** Drags with the mouse from one screen point to another, in steps. */
async function drag(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
}

test("a corner of the selected room drags, in one undo step", async ({
	page,
}) => {
	await selectRoom(page);
	const { x, y } = await mapCenter(page);
	const corner = { x: x - HALF_WIDTH, y: y + HALF_HEIGHT };
	const target = { x: corner.x - 40, y: corner.y + 40 };
	// Outside the room, on the way to where the corner goes.
	const between = { x: corner.x - 20, y: corner.y + 20 };
	const outside = await pixelAt(page, between.x, between.y);
	const inside = await pixelAt(page, x - 100, y + 100);

	await drag(page, corner, target);
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await expectPixel(page, between.x, between.y, inside, 12);

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("0");
	await expectPixel(page, between.x, between.y, outside, 12);
});

test("a side's midpoint drags out a new corner", async ({ page }) => {
	await selectRoom(page);
	const { x, y } = await mapCenter(page);
	// The middle of the south side.
	await drag(page, { x, y: y + HALF_HEIGHT }, { x, y: y + HALF_HEIGHT + 50 });
	// A new node, and the room's way.
	await expect(page.getByTestId("edit-count")).toHaveText("2");
});

test("dragging a corner shared by rooms on two levels says what it moves", async ({
	page,
}) => {
	// Room 200 on level 1 uses room 100's south-west corner (node 101).
	const lower = room(100, LON, LAT, "0");
	const upper = room(200, LON, LAT, "1");
	const upperWay = upper.at(-1) as { nodes: number[] };
	upperWay.nodes = [101, 202, 203, 204, 101];
	await serveOsm(page, [...lower, ...upper.slice(1)]);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x, y);
	const corner = { x: x - HALF_WIDTH, y: y + HALF_HEIGHT };

	await page.mouse.move(corner.x, corner.y);
	await page.mouse.down();
	await page.mouse.move(corner.x - 30, corner.y + 30, { steps: 4 });
	await expect(page.getByTestId("drag-hint")).toHaveText(
		"Moving this point moves 2 features on levels 0;1",
	);
	await page.mouse.up();
	await expect(page.getByTestId("drag-hint")).toBeHidden();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
});

test("an area is drawn corner by corner, then its type is picked", async ({
	page,
}) => {
	await serveOsm(page, []);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	const { x, y } = await mapCenter(page);
	await page.getByRole("button", { name: "Draw area" }).click();
	await expect(page.getByTestId("draw-hint")).toBeVisible();
	await page.mouse.click(x - 100, y - 100);
	await page.mouse.click(x + 100, y - 100);
	await page.mouse.click(x + 100, y + 100);
	// Back on the first corner: the area closes.
	await page.mouse.click(x - 100, y - 100);
	await expect(page.getByTestId("edit-count")).toHaveText("4");
	await expect(page.getByTestId("draw-hint")).toBeHidden();
	await expect(
		page.getByRole("heading", { name: "Select feature type" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("0");
});

test("a line is finished with Enter, and Escape stops a drawing too short", async ({
	page,
}) => {
	await serveOsm(page, []);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	const { x, y } = await mapCenter(page);
	await page.keyboard.press("2");
	await page.mouse.click(x - 100, y);
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("draw-hint")).toBeHidden();
	await expect(page.getByTestId("edit-count")).toHaveText("0");

	await page.keyboard.press("2");
	await page.mouse.click(x - 100, y);
	await page.mouse.click(x + 100, y);
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("edit-count")).toHaveText("3");
});

test("a point on a room's side becomes a door", async ({ page }) => {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	await page.getByRole("button", { name: "Draw point" }).click();
	// Just off the room's west side: it snaps onto it.
	await page.mouse.click(x - HALF_WIDTH + 3, y + 40);
	// The new door and the room it was put in.
	await expect(page.getByTestId("edit-count")).toHaveText("2");
	await expect(
		page.getByRole("button", { name: /^Indoor Door, change feature type/ }),
	).toBeVisible();
});
