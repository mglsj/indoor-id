import type { Page } from "@playwright/test";
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

/** A room's width (0.0004°) at zoom 19, in screen pixels. */
const WIDTH = 298;

/** Room 100 in the middle, room 200 two room widths east, with a ref. */
async function twoRooms(page: Page) {
	const east = room(200, LON + 0.0008, LAT, "0");
	const eastWay = east.at(-1) as { tags: Record<string, string> };
	eastWay.tags = { ...eastWay.tags, ref: "2" };
	await serveOsm(page, [...room(100, LON, LAT, "0"), ...east]);
	await page.goto(`/#18/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
	return mapCenter(page);
}

test("two features edited together, shared tags set on both", async ({
	page,
}) => {
	const { x, y } = await twoRooms(page);
	await page.mouse.click(x, y);
	await page.keyboard.down("Shift");
	await page.mouse.click(x + WIDTH, y);
	await page.keyboard.up("Shift");
	const { root, section } = inspector(page);
	await expect(
		root.getByRole("heading", { name: "Edit 2 features" }),
	).toBeVisible();
	await expect(section("Features (2)")).toBeVisible();
	const box = await tagsBox(page);
	// The ref only one room has is "key=" here: mixed, and kept.
	await expect(box).toHaveValue("indoor=room\nlevel=0\nref=");
	await box.fill("indoor=room\nlevel=0\nref=\nname=Hall");
	await box.blur();
	await expect(page.getByTestId("edit-count")).toHaveText("2");
	// Back to one: the first room only.
	await root
		.getByRole("button", { name: /^Deselect Room/ })
		.first()
		.click();
	await expect(
		root.getByRole("heading", { name: "Edit feature" }),
	).toBeVisible();
});

test("a Shift+drag lasso selects the rooms inside it", async ({ page }) => {
	const { x, y } = await twoRooms(page);
	await page.keyboard.down("Shift");
	// Around both rooms, each 150 × 223 px at zoom 18.
	await page.mouse.move(x - 100, y - 150);
	await page.mouse.down();
	await page.mouse.move(x + WIDTH + 100, y - 150, { steps: 4 });
	await page.mouse.move(x + WIDTH + 100, y + 150, { steps: 4 });
	await page.mouse.move(x - 100, y + 150, { steps: 4 });
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await expect(
		inspector(page).root.getByRole("heading", { name: "Edit 2 features" }),
	).toBeVisible();
});
