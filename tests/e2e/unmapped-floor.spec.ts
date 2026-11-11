import {
	camera,
	expect,
	inspector,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	room,
	serveOsm,
	tagsBox,
	test,
} from "./fixtures.ts";

/** 0.0001° at zoom 19, in screen pixels: 0.0001 × 2^19 × 512 / 360. */
const UNIT = 74.6;

/**
 * A level 0 outline 0.0012° wide round the map's centre, and a room against its west side
 * (from 0.0006° to 0.0002° west of the centre) whose west corners lie on the outline's side.
 */
async function levelWithRoom(page: Parameters<typeof serveOsm>[0]) {
	const outline = room(300, LON, LAT, "0", 0.0006).map((e) =>
		e.type === "way" ? { ...e, tags: { indoor: "level", level: "0" } } : e,
	);
	await serveOsm(page, [...outline, ...room(100, LON - 0.0004, LAT, "0")]);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
}

test("a click on empty floor selects it, and a type maps it through its neighbours' nodes", async ({
	page,
}) => {
	await levelWithRoom(page);
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x + 3 * UNIT, y);
	const panel = page.getByRole("complementary", { name: "Unmapped floor" });
	await expect(panel).toBeVisible();
	await expect(panel.getByTestId("floor-summary")).toContainText("Level 0");
	await expect(inspector(page).root).toBeHidden();

	await panel.getByRole("button", { name: "Map as indoor area" }).click();
	// Only the new way: its corners are the outline's and the room's.
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await expect(panel).toBeHidden();
	await expect(inspector(page).root).toBeVisible();
	await expect(await tagsBox(page)).toHaveValue("indoor=area\nlevel=0");

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("0");
});

test("a click in a room selects the room, and Escape drops the floor", async ({
	page,
}) => {
	await levelWithRoom(page);
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x - 4 * UNIT, y);
	await expect(inspector(page).root).toBeVisible();
	await page.mouse.click(x + 3 * UNIT, y);
	const panel = page.getByRole("complementary", { name: "Unmapped floor" });
	await expect(panel).toBeVisible();
	await expect(inspector(page).root).toBeHidden();
	await page.keyboard.press("Escape");
	await expect(panel).toBeHidden();
});

test("a feature type chosen for the floor maps it with that type's tags", async ({
	page,
}) => {
	await levelWithRoom(page);
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x + 3 * UNIT, y);
	const panel = page.getByRole("complementary", { name: "Unmapped floor" });
	await panel
		.getByRole("combobox", { name: "Search feature types" })
		.fill("stairwell");
	await panel.getByRole("option", { name: "Indoor Stairwell" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nstairs=yes",
	);
});
