import {
	camera,
	type Element,
	expect,
	hash,
	inspector,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	serveOsm,
	tagsBox,
	test,
} from "./fixtures.ts";

/** 0.0001° at zoom 19, in screen pixels: 0.0001 × 2^19 × 512 / 360. */
const UNIT = 74.6;

/**
 * A building 0.0008° wide round the map's centre (way 1), and a room in its west half (way 2)
 * that shares the building's west corners, so their west sides are the same wall.
 */
function buildingWithRoom(): Element[] {
	const r = 0.0004;
	const h = 0.0002;
	const nodes: [number, number, number][] = [
		[1, LON - r, LAT - h],
		[2, LON + r, LAT - h],
		[3, LON + r, LAT + h],
		[4, LON - r, LAT + h],
		[5, LON, LAT - h],
		[6, LON, LAT + h],
	];
	return [
		...nodes.map(([id, lon, lat]) => ({
			type: "node",
			id,
			lon,
			lat,
			version: 1,
		})),
		{
			type: "way",
			id: 1,
			version: 1,
			nodes: [1, 2, 3, 4, 1],
			tags: { building: "yes" },
		},
		{
			type: "way",
			id: 2,
			version: 1,
			nodes: [1, 5, 6, 4, 1],
			tags: { indoor: "room", level: "0" },
		},
	];
}

/** Where a position is on screen, from the map's camera (Web Mercator, 512 px tiles). */
async function screenOf(
	page: Parameters<typeof serveOsm>[0],
	[lon, lat]: [number, number],
): Promise<{ x: number; y: number }> {
	const view = await camera(page);
	const centre = await mapCenter(page);
	const world = 512 * 2 ** view.zoom;
	const mercatorY = (degrees: number) => {
		const phi = (degrees * Math.PI) / 180;
		return (
			((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * world
		);
	};
	return {
		x: centre.x + ((lon - view.lon) / 360) * world,
		y: centre.y + mercatorY(lat) - mercatorY(view.lat),
	};
}

async function open(page: Parameters<typeof serveOsm>[0], url: string) {
	await serveOsm(page, buildingWithRoom());
	await page.goto(url);
	await camera(page);
	await mapDrawn(page);
}

test("on the map a click on a facade picks the building; inside it, the room", async ({
	page,
}) => {
	await open(page, `/#19/${LAT}/${LON}/0`);
	const { x, y } = await mapCenter(page);
	// On the west wall, which the building and the room share.
	const wall = { x: x - 4 * UNIT, y };

	await page.mouse.click(wall.x, wall.y);
	await expect(inspector(page).root).toBeVisible();
	await expect(await tagsBox(page)).toHaveValue("building=yes");

	await page.getByRole("button", { name: "Edit indoor" }).click();
	await expect(page.getByTestId("building-scope")).toBeVisible();
	await expect.poll(() => hash(page)).toContain("&building=w1");

	// Entering fits the building beside its panel: the wall moved on screen.
	await expect
		.poll(async () => (await camera(page)).lon)
		.toBeLessThan(LON - 0.0001);
	const moved = await screenOf(page, [LON - 0.0004, LAT]);
	await page.mouse.click(moved.x, moved.y);
	await expect(inspector(page).root).toBeVisible();
	await expect(await tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
});

test("with iD's partial fill, a click on a room's band on the map enters its building", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("indoorid.area-fill", "partial"),
	);
	await open(page, `/#19/${LAT}/${LON}/0`);
	const { x, y } = await mapCenter(page);
	// Just inside the room's east side, deep inside the building, away from its band.
	await page.mouse.click(x - 4, y);
	await expect(page.getByTestId("building-scope")).toBeVisible();
	await expect(await tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
});

test("with areas filled whole, a click inside a building on the map picks the building", async ({
	page,
}) => {
	await open(page, `/#19/${LAT}/${LON}/0`);
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x - 2 * UNIT, y);
	await expect(page.getByTestId("building-scope")).toBeHidden();
	await expect(await tagsBox(page)).toHaveValue("building=yes");
});

test("building mode shows in a blue bar, a frame round the map and the header (A.2)", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("indoorid.building-hints", "0"),
	);
	await open(page, `/#19/${LAT}/${LON}/0&building=w1`);
	const bar = page.getByRole("region", { name: "Building mode" });
	await expect(bar).toContainText("Level 0");
	await expect(
		bar.getByRole("button", { name: "Leave building", exact: true }),
	).toBeVisible();
	await expect(page.getByTestId("building-frame")).toBeVisible();
	const crumb = page.getByRole("banner").getByTestId("building-crumb");
	await expect(crumb).toBeVisible();
	// The first visits get a hint saying how to leave.
	await expect(page.getByTestId("building-hint")).toContainText("Esc");

	// The header's × leaves too, and the bar's place offers to come back in.
	await crumb.getByRole("button", { name: /^Leave / }).click();
	await expect(bar).toBeHidden();
	await expect(page.getByTestId("building-frame")).toBeHidden();
	await expect(crumb).toBeHidden();
	const stack = page.getByTestId("bottom-stack");
	await expect(
		stack.getByRole("button", { name: "Edit indoor" }),
	).toBeVisible();
});

test("building tools stay in the toolbar on the map, disabled with a reason (A.2)", async ({
	page,
}) => {
	await open(page, `/#19/${LAT}/${LON}/0`);
	const rectangle = page.getByRole("button", { name: "Draw rectangle" });
	await expect(rectangle).toHaveAttribute("aria-disabled", "true");
	await expect(rectangle).toHaveAccessibleDescription("inside a building only");
	await rectangle.click({ force: true });
	await expect(rectangle).toHaveAttribute("aria-pressed", "false");
});

test("Escape with nothing selected, or Leave building, goes back to the map", async ({
	page,
}) => {
	await open(page, `/#19/${LAT}/${LON}/0&building=w1`);
	const scope = page.getByTestId("building-scope");
	await expect(scope).toBeVisible();

	await page
		.getByRole("button", { name: "Leave building", exact: true })
		.click();
	await expect(scope).toBeHidden();
	await expect.poll(() => hash(page)).not.toContain("building=");
	// The building left is selected.
	await expect(await tagsBox(page)).toHaveValue("building=yes");

	await page.getByRole("button", { name: "Edit indoor" }).click();
	await expect(scope).toBeVisible();
	// Outside the building: nothing is selected there.
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x, y + 5 * UNIT);
	await page.keyboard.press("Escape");
	await expect(scope).toBeHidden();
});

test("a double-click on a building enters it, fitting it in view beside its panel", async ({
	page,
}) => {
	await open(page, `/#19/${LAT}/${LON}/0`);
	const { x, y } = await mapCenter(page);
	await page.mouse.dblclick(x + 2 * UNIT, y);
	await expect(page.getByTestId("building-scope")).toBeVisible();
	await expect.poll(() => hash(page)).toContain("&building=w1");
	// The panel shows the building, with nothing selected.
	const panel = page.getByTestId("building-panel");
	await expect(panel).toBeVisible();
	await expect(panel.getByRole("button", { name: "Level 0" })).toBeVisible();
	await expect(inspector(page).root).toBeHidden();
	// The camera fits the building instead of zooming in.
	await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(19.9);
	await expect
		.poll(async () => (await camera(page)).lon)
		.toBeLessThan(LON - 0.0001);

	await panel.getByRole("button", { name: "Leave building (Esc)" }).click();
	await expect(page.getByTestId("building-scope")).toBeHidden();
	await expect(await tagsBox(page)).toHaveValue("building=yes");
});

test("a double-click on the open map still zooms in", async ({ page }) => {
	await open(page, `/#19/${LAT}/${LON}/0`);
	const { x, y } = await mapCenter(page);
	await page.mouse.dblclick(x + 6 * UNIT, y);
	await expect
		.poll(async () => (await camera(page)).zoom)
		.toBeGreaterThan(19.5);
	await expect(page.getByTestId("building-scope")).toBeHidden();
});

test("with iD's partial fill, Edit indoor here enters the building clicked in", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("indoorid.area-fill", "partial"),
	);
	await open(page, `/#19/${LAT}/${LON}/0`);
	const { x, y } = await mapCenter(page);
	const here = page.getByRole("button", { name: "Edit indoor here" });
	// In the building's empty east half, away from every band: nothing is picked.
	await page.mouse.click(x + 2 * UNIT, y);
	await expect(here).toBeVisible();
	await page.mouse.click(x + 2 * UNIT, y);
	await here.click();
	await expect(page.getByTestId("building-scope")).toBeVisible();
	await expect.poll(() => hash(page)).toContain("&building=w1");
});

test("outside any building, Edit indoor here opens the indoor data no building holds", async ({
	page,
}) => {
	await open(page, `/#19/${LAT}/${LON}/0`);
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x + 6 * UNIT, y);
	await page.getByRole("button", { name: "Edit indoor here" }).click();
	await expect(page.getByTestId("building-scope")).toContainText(
		"Indoor data here",
	);
	await expect.poll(() => hash(page)).toContain("&building=here");
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("building-scope")).toBeHidden();
});

test("the map offers iD's tools; CAD tools, floor plans and levels are building mode's", async ({
	page,
}) => {
	await open(page, `/#19/${LAT}/${LON}/0`);
	const draw = page.getByRole("toolbar", { name: "Draw" });
	// Building mode's tools keep their place, disabled (A.2).
	const usable = draw.locator(
		'button:not([aria-disabled="true"]):not([disabled])',
	);
	await expect(usable).toHaveCount(3);
	await expect(page.getByRole("button", { name: "Floor plans" })).toBeHidden();
	await expect(page.getByTestId("level")).toBeHidden();
	// Keys of tools not offered do nothing.
	await page.keyboard.press("4");
	await expect(page.getByTestId("draw-hint")).toBeHidden();

	await page.goto(`/#19/${LAT}/${LON}/0&building=w1`);
	await expect(page.getByTestId("building-scope")).toBeVisible();
	await expect(
		draw.getByRole("button", { name: "Draw rectangle" }),
	).toBeVisible();
	await expect(usable).toHaveCount(7);
	await expect(page.getByRole("button", { name: "Floor plans" })).toBeVisible();
	await expect(page.getByTestId("level")).toBeVisible();
});

test("inside, the outline is locked: a corner it shares with a room stays until Edit outline", async ({
	page,
}) => {
	// The building's west side right of the building panel.
	await open(page, `/#19/${LAT}/${LON - 0.0003}/0&building=w1`);
	const panel = page.getByTestId("building-panel");
	await expect(panel).toBeVisible();
	// From the camera each time: a refused drag pans the map.
	const corner = () => screenOf(page, [LON - 0.0004, LAT - 0.0002]);
	const clickRoom = async () => {
		const inRoom = await screenOf(page, [LON - 0.0002, LAT]);
		await page.mouse.click(inRoom.x, inRoom.y);
	};
	const dragCorner = async () => {
		const at = await corner();
		await page.mouse.move(at.x, at.y);
		await page.mouse.down();
		await page.mouse.move(at.x - 40, at.y + 40, { steps: 8 });
		await page.mouse.up();
	};

	await clickRoom();
	await expect(await tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
	await dragCorner();
	await expect(page.getByTestId("operation-note")).toContainText(
		"Shared with the building outline",
	);
	await expect(page.getByTestId("edit-count")).toHaveText("0");
	// Operations that move the room's corners are refused the same way.
	await clickRoom();
	await page.getByRole("button", { name: "Transform" }).click();
	const move = page.getByRole("menuitem", { name: /^Move by a distance/ });
	await expect(move).toHaveAttribute("aria-disabled", "true");
	// The reason shows in the menu itself (A.3).
	await expect(move).toContainText("Shared with the building outline");
	await page.keyboard.press("Escape");
	await page.keyboard.press("Shift+M");
	await expect(page.getByTestId("operation-note")).toContainText(
		"Shared with the building outline",
	);
	await expect(page.getByTestId("transform-hint")).toHaveCount(0);

	await page.keyboard.press("Escape");
	await panel.getByRole("checkbox", { name: "Edit outline" }).click();
	await clickRoom();
	await expect(await tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
	await dragCorner();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
});

test("inside, the level switcher offers every floor building:levels counts, mapped or not", async ({
	page,
}) => {
	// Only level 0 has a room; the building counts three floors.
	const elements = buildingWithRoom().map((e) =>
		e.type === "way" && e.id === 1
			? { ...e, tags: { building: "yes", "building:levels": "3" } }
			: e,
	);
	await serveOsm(page, elements);
	await page.goto(`/#19/${LAT}/${LON}/0&building=w1`);
	await camera(page);
	await mapDrawn(page);
	const levels = page.getByRole("group", { name: "Levels" });
	await expect(levels.getByRole("radio")).toHaveText(["2", "1", "0"]);
	await levels.getByRole("radio", { name: "2" }).click();
	await expect(page.getByTestId("level")).toHaveAttribute("data-level", "2");
	await expect(page.getByRole("button", { name: "Level 2" })).toBeVisible();

	// Back on the map, which has no switcher, the ground floor shows again.
	await page
		.getByRole("button", { name: "Leave building", exact: true })
		.click();
	await expect(page.getByTestId("building-scope")).toBeHidden();
	await expect(page.getByTestId("level")).toBeHidden();
	await expect.poll(() => hash(page)).toMatch(/\/0$/);
});

test("Preview in indoor= sends the building, edits included, to indoor= once it is ready (P6)", async ({
	page,
	context,
}) => {
	// indoor= stands in: it says it is ready to its opener, and keeps what it is sent.
	await context.route("https://indoorequal.org/**", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<script>
				window.received = [];
				addEventListener("message", (e) => window.received.push({
					origin: e.origin,
					command: e.data.command,
					name: e.data.file ? e.data.file.name : null,
				}));
				window.opener.postMessage({ event: "ready" }, "*");
			</script>`,
		}),
	);
	await open(page, `/#19/${LAT}/${LON}/0&building=w1`);
	const panel = page.getByTestId("building-panel");
	const [tab] = await Promise.all([
		context.waitForEvent("page"),
		panel.getByRole("button", { name: "Preview in indoor=" }).click(),
	]);
	await expect
		.poll(() =>
			tab.evaluate(() =>
				(window as never as { received: { command: string }[] }).received.map(
					(r) => r.command,
				),
			),
		)
		.toEqual(["preview", "level", "coordinates"]);
	const [preview] = await tab.evaluate(
		() => (window as never as { received: { name: string }[] }).received,
	);
	expect(preview?.name).toBe("indoorid.geojson");
});

test("inside a building the level switcher lists all its levels, in view or not (A.5)", async ({
	page,
}) => {
	// A room on level 1 in the building's east half.
	await serveOsm(page, [
		...buildingWithRoom(),
		{
			type: "way",
			id: 3,
			version: 1,
			nodes: [5, 2, 3, 6, 5],
			tags: { indoor: "room", level: "1" },
		},
	]);
	// Zoomed in on the west room: the east one is out of view.
	await page.goto(`/#22/${LAT}/${LON - 0.0003}/0&building=w1`);
	await camera(page);
	await mapDrawn(page);
	const levels = page.getByRole("group", { name: "Levels" });
	await expect(levels.getByRole("radio", { name: "Level 1" })).toBeVisible();
	await expect(levels.getByRole("radio", { name: "Level 0" })).toBeVisible();
});
