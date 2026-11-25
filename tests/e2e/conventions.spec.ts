import {
	camera,
	expect,
	INDOOR,
	LAT,
	LON,
	mapCenter,
	serveOsm,
	tagsBox,
	test,
} from "./fixtures.ts";

/**
 * Indoor features chosen inside a building are tagged as osm-simple3d-editor tags them, so
 * that it draws them too (presets/indoor-conventions.ts).
 */
test("a restroom drawn as an area becomes a room for toilets", async ({
	page,
}) => {
	await serveOsm(page, []);
	await page.goto(`/#19/${LAT}/${LON}/0${INDOOR}`);
	await camera(page);
	const { x, y } = await mapCenter(page);
	await page.keyboard.press("3");
	await page.mouse.click(x - 100, y - 100);
	await page.mouse.click(x + 100, y - 100);
	await page.mouse.click(x + 100, y + 100);
	await page.keyboard.press("Enter");
	await page.getByRole("option", { name: "Restroom" }).click();

	await expect(await tagsBox(page)).toHaveValue(
		"amenity=toilets\nindoor=room\nlevel=0\nroom=toilets",
	);
});

test("Steps drawn as a line become a flight up to the next level", async ({
	page,
}) => {
	await serveOsm(page, []);
	await page.goto(`/#19/${LAT}/${LON}/0${INDOOR}`);
	await camera(page);
	const { x, y } = await mapCenter(page);
	await page.keyboard.press("2");
	await page.mouse.click(x - 100, y);
	await page.mouse.click(x + 100, y);
	await page.keyboard.press("Enter");
	await page.getByRole("option", { name: "Steps" }).click();

	await expect(await tagsBox(page)).toHaveValue(
		"highway=steps\nincline=up\nindoor=yes\nlevel=0;1",
	);
});
