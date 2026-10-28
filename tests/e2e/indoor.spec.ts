import {
	BACKGROUND,
	blend,
	expect,
	expectPixel,
	hash,
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

/** The room colour of the style, drawn at its fill opacity over the background. */
const ROOM = blend([0xd6, 0xd1, 0xc7], 0.8, BACKGROUND);

test("draws a room on its level only", async ({ page }) => {
	await serveOsm(page, [
		...room(100, LON, LAT, "0"),
		...room(200, LON + 0.001, LAT, "1"),
	]);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	const { x, y } = await mapCenter(page);

	await expectPixel(page, x, y, ROOM);
	await page.getByRole("radio", { name: "Level 1", exact: true }).click();
	await expectPixel(page, x, y, BACKGROUND);
});

test("lists the levels found in the data", async ({ page }) => {
	await serveOsm(page, [
		...room(100, LON, LAT, "0"),
		...room(200, LON + 0.001, LAT, "1"),
		{
			type: "node",
			id: 300,
			lon: LON,
			lat: LAT,
			version: 1,
			tags: { amenity: "toilets", level: "-1" },
		},
	]);
	await page.goto(`/#19/${LAT}/${LON}/0`);

	const levels = page.getByRole("group", { name: "Levels" }).getByRole("radio");
	await expect(levels).toHaveText(["1", "0", "-1"]);
	await expect(
		page.getByRole("radio", { name: "Level 0", exact: true }),
	).toBeChecked();

	await page.getByRole("button", { name: "Level down" }).click();
	await expect.poll(() => hash(page)).toBe(`#19/${LAT}/${LON}/-1`);
	await expect(page.getByRole("button", { name: "Level down" })).toBeDisabled();
});

test("shows no level list when the data has a single level", async ({
	page,
}) => {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await expect(page.getByTestId("level")).toHaveText("0");
	await expect(page.getByRole("button", { name: "Level up" })).toBeDisabled();
	await expect(page.getByRole("group", { name: "Levels" })).toBeHidden();
});

test("names levels from their indoor=level outlines", async ({ page }) => {
	const named = (id: number, level: string, tags: Record<string, string>) =>
		room(id, LON, LAT, level).map((e) =>
			e.type === "way"
				? { ...e, tags: { indoor: "level", level, ...tags } }
				: e,
		);
	await serveOsm(page, [
		...named(100, "0", { "level:ref": "EG", name: "Erdgeschoss" }),
		...named(200, "1", { name: "Untere Verkaufsebene" }),
		...room(300, LON, LAT, "-1"),
	]);
	await page.goto(`/#19/${LAT}/${LON}/0`);

	const levels = page.getByRole("group", { name: "Levels" }).getByRole("radio");
	await expect(levels).toHaveText(["Unter…", "EG", "-1"]);
	await expect(page.getByTestId("level")).toHaveText("EG");
	await page
		.getByRole("radio", { name: "Level 1: Untere Verkaufsebene · level 1" })
		.hover();
	await expect(page.getByText("Untere Verkaufsebene · level 1")).toBeVisible();
	// The hash keeps the number.
	await page.getByRole("radio", { name: /^Level 1:/ }).click();
	await expect.poll(() => hash(page)).toBe(`#19/${LAT}/${LON}/1`);
});

test("lists the levels of the data in view only, skipping non-existent ones", async ({
	page,
}) => {
	const building = room(400, LON, LAT, "0", 0.0003).map((e) =>
		e.type === "way"
			? { ...e, tags: { building: "yes", non_existent_levels: "13" } }
			: e,
	);
	await serveOsm(page, [
		...building,
		...room(100, LON, LAT, "12-14"),
		// Far away: not in view.
		...room(200, LON + 0.01, LAT, "3"),
	]);
	await page.goto(`/#19/${LAT}/${LON}/12`);

	const levels = page.getByRole("group", { name: "Levels" }).getByRole("radio");
	await expect(levels).toHaveText(["14", "12"]);
	await page.evaluate(
		([lon, lat]) => (location.hash = `#19/${lat}/${lon}/12`),
		[LON + 0.05, LAT],
	);
	// No data in view: levels step by one, with no list.
	await expect(page.getByRole("group", { name: "Levels" })).toBeHidden();
	await expect(page.getByRole("button", { name: "Level up" })).toBeEnabled();
});

test("downloads each area only once", async ({ page }) => {
	const requests = await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await expect.poll(() => requests.length).toBeGreaterThan(0);
	await expect(page.getByTestId("load-status")).toBeHidden();

	await page.evaluate(() => (location.hash = "#19/48.2/-1.6/0"));
	await expect(page.getByTestId("load-status")).toBeHidden();
	const afterAway = requests.length;

	await page.evaluate(
		([lat, lon]) => (location.hash = `#19/${lat}/${lon}/0`),
		[LAT, LON],
	);
	const { x, y } = await mapCenter(page);
	await expectPixel(page, x, y, ROOM);
	expect(requests.length).toBe(afterAway);
});

test("asks to zoom in instead of downloading a large area", async ({
	page,
}) => {
	const requests = await serveOsm(page, []);
	await page.goto(`/#16/${LAT}/${LON}/0`);
	await expect(page.getByTestId("load-status")).toHaveText(
		"Zoom in to load indoor data here",
	);
	expect(requests).toEqual([]);
});

test("reports areas that could not be downloaded", async ({ page }) => {
	await page.route("**/api/0.6/map.json*", (route) =>
		route.fulfill({ status: 509, body: "Bandwidth limit exceeded" }),
	);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await expect(page.getByTestId("load-status")).toContainText(
		"could not be loaded",
	);
});

test("draws the preset's Maki icon for a point of interest", async ({
	page,
}) => {
	await serveOsm(page, [
		{
			type: "node",
			id: 300,
			lon: LON,
			lat: LAT,
			version: 1,
			tags: { amenity: "toilets", level: "0" },
		},
	]);
	// The Restroom preset's icon, rather than the 1.x amenity_toilets.png.
	const icon = page.waitForRequest(/\/maki-toilet\.[\w-]+\.svg$/);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await icon;
	const { x, y } = await mapCenter(page);

	await expect
		.poll(async () => (await pixelAt(page, x, y)).join(","), {
			timeout: 10_000,
		})
		.not.toBe(BACKGROUND.join(","));
});

test("edits are drawn at once: a room moved to another level leaves this one, and Undo brings it back", async ({
	page,
}) => {
	// Other rooms on levels 0 and 1: moving one keeps the levels of the data, so only it is
	// sent to the map again.
	await serveOsm(page, [
		...room(200, LON + 0.001, LAT, "1"),
		...room(300, LON - 0.001, LAT, "0"),
		...room(100, LON, LAT, "0"),
	]);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	const { x, y } = await mapCenter(page);
	await expectPixel(page, x, y, ROOM);
	const editor = inspector(page).root;
	await mapDrawn(page);
	await page.mouse.click(x, y);
	await expect(editor).toBeVisible();
	const selected = (await pixelAt(page, x, y)).join(",");

	const level = editor.getByRole("combobox", { name: "Level", exact: true });
	await level.fill("1");
	await level.press("Enter");
	await expectPixel(page, x, y, BACKGROUND);
	await page.getByRole("button", { name: "Undo" }).click();
	await expect
		.poll(async () => (await pixelAt(page, x, y)).join(","))
		.toBe(selected);
});
