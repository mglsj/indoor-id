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

	await page.mouse.click(wall.x, wall.y);
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

test("Escape with nothing selected, or Done, goes back to the map", async ({
	page,
}) => {
	await open(page, `/#19/${LAT}/${LON}/0&building=w1`);
	const scope = page.getByTestId("building-scope");
	await expect(scope).toBeVisible();

	await page.getByRole("button", { name: "Done" }).click();
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
