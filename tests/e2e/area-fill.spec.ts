import {
	BACKGROUND,
	blend,
	camera,
	expect,
	expectPixel,
	inspector,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	pixelAt,
	room,
	serveOsm,
	test,
} from "./fixtures.ts";

/** Room half-width (0.0002°) at zoom 19, in screen pixels: 0.0002 × 2^19 × 512 / 360. */
const HALF_WIDTH = 149;
/** The light map's band inside rooms (`LIGHT_EDIT_COLORS.room.fill`), over the background. */
const BAND = blend([120, 120, 120], 0.22, BACKGROUND);

test.beforeEach(async ({ page }) => {
	// The fixture fills areas whole for the other tests: back to iD's default here.
	await page.addInitScript(() =>
		localStorage.setItem("indoorid.area-fill", "partial"),
	);
	await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await mapDrawn(page);
});

test("a room is filled by a band inside its outline, its inside left clear (iD)", async ({
	page,
}) => {
	const { x, y } = await mapCenter(page);
	await expectPixel(page, x - HALF_WIDTH + 5, y, BAND, 4);
	await expectPixel(page, x - 60, y, BACKGROUND);
});

test("a click inside a room doesn't select it, a click on its band does", async ({
	page,
}) => {
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x - 60, y);
	await expect(inspector(page).root).toBeHidden();
	await page.mouse.click(x - HALF_WIDTH + 5, y);
	await expect(inspector(page).root).toBeVisible();
});

test("areas can be filled whole, or drawn as a wireframe with W", async ({
	page,
}) => {
	const { x, y } = await mapCenter(page);
	await page.getByRole("button", { name: "Background" }).click();
	await page.getByRole("radio", { name: "Full fill" }).click();
	await expectPixel(page, x - 60, y, BAND, 4);
	await page
		.getByRole("button", { name: "Close the background settings" })
		.click();
	// Whole areas are clicked anywhere inside.
	await page.mouse.click(x - 60, y);
	await expect(inspector(page).root).toBeVisible();
	await page.keyboard.press("Escape");

	await page.keyboard.press("w");
	await expectPixel(page, x - 60, y, BACKGROUND);
	await expectPixel(page, x - HALF_WIDTH + 5, y, BACKGROUND);
	await page.keyboard.press("w");
	await expectPixel(page, x - 60, y, BAND, 4);
});

test("a room mostly out of view can't be deleted or moved until it is seen (iD)", async ({
	page,
}) => {
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x - HALF_WIDTH + 5, y);
	await expect(inspector(page).root).toBeVisible();
	// Zoomed in on the room's west side: most of it is out of view.
	await page.evaluate(
		([lat, lon]) => (location.hash = `#22/${lat}/${lon}/0`),
		[LAT, LON - 0.0002],
	);
	await expect.poll(async () => (await camera(page)).zoom).toBe(22);
	await page.keyboard.press("Delete");
	await expect(page.getByText("Not enough of it is visible")).toBeVisible();
	await expect(page.getByTestId("edit-count")).toHaveText("0");

	// Z fits the selection in view (iD), and then it can be deleted.
	await page.keyboard.press("z");
	await expect(async () => {
		await page.keyboard.press("Delete");
		await expect(page.getByTestId("edit-count")).not.toHaveText("0", {
			timeout: 500,
		});
	}).toPass();
});

test("Highlight changes draws edited features with iD's halo", async ({
	page,
}) => {
	const { x, y } = await mapCenter(page);
	const edge = { x: x - HALF_WIDTH, y: y - 40 };
	const before = await pixelAt(page, edge.x, edge.y);
	await page.getByRole("button", { name: "Background" }).click();
	await page.getByRole("checkbox", { name: "Highlight changes" }).check();
	await page
		.getByRole("button", { name: "Close the background settings" })
		.click();
	await expectPixel(page, edge.x, edge.y, before);

	// Retagged: a name typed into the inspector.
	await page.mouse.click(x - HALF_WIDTH + 5, y);
	await inspector(page).root.getByLabel("Name", { exact: true }).fill("Lab");
	await page.keyboard.press("Escape");
	await expect
		.poll(async () => (await pixelAt(page, edge.x, edge.y)).join(","))
		.not.toBe(before.join(","));
	const [r, g, b] = await pixelAt(page, edge.x, edge.y);
	// iD's yellow (#fcde5a) over the room.
	expect(r).toBeGreaterThan(g - 40);
	expect(b).toBeLessThan(r);
});
