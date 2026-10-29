import {
	camera,
	clickMap,
	expect,
	inspector,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	room,
	selectRoom,
	serveOsm,
	test,
} from "./fixtures.ts";

/** A room's width (0.0004°) at zoom 19, in screen pixels: 0.0004 × 2^19 × 512 / 360. */
const WIDTH = 298;

test("Delete removes the selected room and its corners, in one undo step", async ({
	page,
}) => {
	await selectRoom(page);
	await page.keyboard.press("Delete");
	// The way and its four nodes.
	await expect(page.getByTestId("edit-count")).toHaveText("5");
	await expect(inspector(page).root).toBeHidden();
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("0");
});

test("a copied room pastes where the pointer is, selected", async ({
	page,
}) => {
	await selectRoom(page);
	await page.getByRole("button", { name: "Copy" }).click();
	await expect(page.getByTestId("operation-note")).toHaveText(
		"Copied: paste it with Ctrl+V",
	);
	const { x, y } = await mapCenter(page);
	await page.mouse.move(x + 400, y);
	await page.keyboard.press("Control+v");
	// A new way and its four nodes, selected for editing.
	await expect(page.getByTestId("edit-count")).toHaveText("5");
	await expect(inspector(page).root).toBeVisible();
	await page.mouse.move(x + 400, y + 10);
	await expect(page.getByRole("button", { name: "Paste" })).toBeVisible();
});

test("two rooms selected with Shift+click merge into one", async ({ page }) => {
	// Room 200 is east of room 100 and shares its east side (nodes 102 and 103).
	const west = room(100, LON, LAT, "0");
	const east = room(200, LON + 0.0004, LAT, "0");
	const eastWay = east.at(-1) as { nodes: number[] };
	eastWay.nodes = [102, 202, 203, 103, 102];
	await serveOsm(page, [...west, east[1], east[2], eastWay] as never);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x, y);
	await page.keyboard.down("Shift");
	await page.mouse.click(x + WIDTH, y);
	await page.keyboard.up("Shift");
	await expect(page.getByRole("button", { name: "Merge rooms" })).toBeVisible();
	await page.keyboard.press("c");
	// Room 100 or 200 changed, the other deleted.
	await expect(page.getByTestId("edit-count")).toHaveText("2");
	await expect(inspector(page).root).toBeVisible();
});

test("an operation that can't run says why", async ({ page }) => {
	await selectRoom(page);
	await page.keyboard.press("q");
	await expect(page.getByTestId("operation-note")).toHaveText(
		"Its corners are square already",
	);
	await expect(page.getByTestId("edit-count")).toHaveText("0");
});

test("the split tool cuts a room in two along the line drawn", async ({
	page,
}) => {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	await page.getByRole("button", { name: "Split rooms" }).click();
	await expect(page.getByTestId("draw-hint")).toBeVisible();
	// Across the room from west to east, the room being 298 px wide.
	await page.mouse.click(x - 200, y);
	await page.mouse.click(x + 200, y);
	await page.keyboard.press("Enter");
	// Two new nodes, the room changed and a new way.
	await expect(page.getByTestId("edit-count")).toHaveText("4");
	await expect(page.getByTestId("draw-hint")).toBeHidden();
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("0");
});

test("Repeat on levels puts a copy of the room on the level checked", async ({
	page,
}) => {
	// Rooms on levels 0 and 1, so both are in view; the one on level 1 elsewhere.
	await serveOsm(page, [
		...room(100, LON, LAT, "0"),
		...room(200, LON + 0.001, LAT, "1"),
	]);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
	await clickMap(page);
	await expect(inspector(page).root).toBeVisible();
	await page.keyboard.press("r");
	const dialog = page.getByRole("dialog", { name: "Repeat on levels" });
	await dialog.getByRole("checkbox", { name: /^Level 1/ }).check();
	await dialog.getByRole("button", { name: "Apply" }).click();
	await expect(dialog).toBeHidden();
	// A new way and its four nodes.
	await expect(page.getByTestId("edit-count")).toHaveText("5");
});

test("a room and an area drawn inside it make a room with a hole", async ({
	page,
}) => {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	// An area drawn in the room stays selected, its type not picked yet.
	await page.getByRole("button", { name: "Draw area" }).click();
	await page.mouse.click(x - 30, y - 30);
	await page.mouse.click(x + 30, y - 30);
	await page.mouse.click(x + 30, y + 30);
	await page.mouse.click(x - 30, y - 30);
	await expect(page.getByTestId("edit-count")).toHaveText("4");
	await page.keyboard.down("Shift");
	await page.mouse.click(x + 100, y + 100);
	await page.keyboard.up("Shift");
	await page.keyboard.press("Shift+C");
	// And the relation, the room's tags moved to it.
	await expect(page.getByTestId("edit-count")).toHaveText("6");
	await expect(
		inspector(page).root.getByRole("button", { name: /^Members \(2\)$/ }),
	).toBeVisible();
});
