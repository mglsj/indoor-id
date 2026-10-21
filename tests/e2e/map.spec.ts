import {
	blankStyle,
	camera,
	expect,
	hash,
	mapLocator,
	pixelAt,
	selectRoom,
	test,
} from "./fixtures.ts";

test("centres the map on a 1.x style URL hash", async ({ page }) => {
	await page.goto("/#19/48.13/-1.69/1");

	const view = await camera(page);
	expect(view.zoom).toBeCloseTo(19, 5);
	expect(view.lat).toBeCloseTo(48.13, 5);
	expect(view.lon).toBeCloseTo(-1.69, 5);
	await expect(page.getByTestId("level")).toHaveText("1");
	expect(await hash(page)).toBe("#19/48.13/-1.69/1");
});

test("opens on the configured default view when the hash is missing", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page).toHaveTitle("IndoorID");

	const view = await camera(page);
	expect(view.zoom).toBeCloseTo(18, 5);
	await expect.poll(() => hash(page)).toBe("#18/48.13678/-1.69533/0");
});

test("level buttons step through levels and update the hash", async ({
	page,
}) => {
	await page.goto("/#19/48.13/-1.69/1");
	await camera(page);

	await page.getByRole("button", { name: "Level up" }).click();
	await expect.poll(() => hash(page)).toBe("#19/48.13/-1.69/2");

	const down = page.getByRole("button", { name: "Level down" });
	await down.click();
	await down.click();
	await down.click();
	await expect(page.getByTestId("level")).toHaveText("-1");
	await expect.poll(() => hash(page)).toBe("#19/48.13/-1.69/-1");
});

test("follows hash edits made after loading", async ({ page }) => {
	await page.goto("/#19/48.13/-1.69/1");
	await camera(page);

	await page.evaluate(() => (location.hash = "#17/40.1/2.5/0.5"));

	await expect.poll(async () => (await camera(page)).lat).toBeCloseTo(40.1, 5);
	const view = await camera(page);
	expect(view.lon).toBeCloseTo(2.5, 5);
	expect(view.zoom).toBeCloseTo(17, 5);
	await expect(page.getByTestId("level")).toHaveText("0.5");
});

test("dragging the map updates the hash", async ({ page }) => {
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);

	const box = (await mapLocator(page).boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 200, y + 150, { steps: 10 });
	await page.mouse.up();

	// Dragging content left and down moves the view east and north.
	await expect
		.poll(async () => (await camera(page)).lon)
		.toBeGreaterThan(-1.69);
	const view = await camera(page);
	expect(view.lat).toBeGreaterThan(48.13);
	await expect.poll(() => hash(page)).not.toBe("#19/48.13/-1.69/0");
});

test("reports a basemap that cannot be loaded, and still shows indoor data", async ({
	page,
}) => {
	await page.route("**/styles/**", (route) =>
		route.fulfill({ status: 500, body: "down" }),
	);
	const editor = await selectRoom(page);
	await expect(page.getByRole("alert")).toContainText(
		"basemap could not be loaded",
	);
	await expect(editor).toBeVisible();
});

test("draws vector data, which needs the MapLibre worker", async ({ page }) => {
	const world = {
		type: "Polygon",
		coordinates: [
			[
				[-180, -85],
				[180, -85],
				[180, 85],
				[-180, 85],
				[-180, -85],
			],
		],
	};
	await page.route("**/styles/**", (route) =>
		route.fulfill({
			json: {
				...blankStyle,
				sources: { data: { type: "geojson", data: world } },
				layers: [
					...blankStyle.layers,
					{
						id: "fill",
						type: "fill",
						source: "data",
						paint: { "fill-color": "#ff0000" },
					},
				],
			},
		}),
	);
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);

	const box = (await mapLocator(page).boundingBox())!;
	const x = Math.round(box.x + box.width / 2);
	const y = Math.round(box.y + box.height / 2);
	await expect
		.poll(() => pixelAt(page, x, y), { timeout: 10_000 })
		.toEqual([255, 0, 0]);
});
