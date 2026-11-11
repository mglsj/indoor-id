import type { Page } from "@playwright/test";
import {
	BACKGROUND,
	blend,
	camera,
	type Element,
	expect,
	expectPixel,
	hash,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	room,
	serveOsm,
	test,
} from "./fixtures.ts";

/** The room colour drawn at the viewer's fill opacity (0.95, the editor's is 0.8). */
const VIEW_ROOM = blend([0xd6, 0xd1, 0xc7], 0.95, BACKGROUND);

/**
 * Serves `elements` for every Overpass data query, and `centres` (OSM JSON with `center`) for
 * discovery's; returns the queries asked.
 */
async function serveOverpass(
	page: Page,
	elements: Element[],
	centres: Element[] = [],
) {
	const queries: string[] = [];
	await page.route("**/api/interpreter", (route) => {
		const query =
			new URLSearchParams(route.request().postData() ?? "").get("data") ?? "";
		queries.push(query);
		return route.fulfill({
			json: {
				version: 0.6,
				elements: query.includes("out ids center") ? centres : elements,
			},
		});
	});
	return queries;
}

/** Room 100 on level 0 named "Library", room 200 on level 1. */
function building(): Element[] {
	const library = room(100, LON, LAT, "0");
	(library.at(-1) as { tags: Record<string, string> }).tags.name = "Library";
	return [...library, ...room(200, LON + 0.001, LAT, "1")];
}

test("shows indoor data from Overpass without an account, and a feature's details on click", async ({
	page,
}) => {
	const osmApi = await serveOsm(page, []);
	const queries = await serveOverpass(page, building());
	await page.goto(`/view#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
	expect(queries[0]).toContain('nwr["indoor"]');
	expect(osmApi).toEqual([]);
	await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);

	const { x, y } = await mapCenter(page);
	// Below the room's name.
	await expectPixel(page, x, y + 40, VIEW_ROOM);
	await page.mouse.click(x, y);
	const card = page.getByTestId("feature-card");
	await expect(card.getByRole("heading", { name: "Library" })).toBeVisible();
	await expect(card).toContainText("Levels 0");
	await expect(
		card.getByRole("link", { name: "View on OpenStreetMap" }),
	).toHaveAttribute("href", "https://www.openstreetmap.org/way/100");
	await page.keyboard.press("Escape");
	await expect(card).toBeHidden();
});

test("draws dark colours when the system is in dark mode", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await serveOverpass(page, building());
	await page.goto(`/view#19/${LAT}/${LON}/0`);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	await expectPixel(
		page,
		x,
		y + 40,
		blend([0x4a, 0x46, 0x3f], 0.95, BACKGROUND),
	);
});

test("labels unnamed levels as floors, counted as the browser's locale does", async ({
	page,
}) => {
	await serveOverpass(page, building());
	await page.goto(`/view#19/${LAT}/${LON}/0`);
	await mapDrawn(page);
	const levels = page.getByRole("group", { name: "Levels" }).getByRole("radio");
	// The tests run in en-US: the ground floor is floor 1.
	await expect(levels).toHaveText(["2", "1"]);

	await page.getByRole("radio", { name: "G, 1, 2…" }).click();
	await expect(levels).toHaveText(["1", "G"]);
	await expect(
		page.getByRole("radio", { name: "Level 0: G · Ground floor · level 0" }),
	).toBeChecked();
	// Kept for the next visit; the level's number in the URL doesn't change.
	await page.reload();
	await mapDrawn(page);
	await expect(levels).toHaveText(["1", "G"]);
	expect(await hash(page)).toMatch(/\/0$/);
});

test("shows what this browser just uploaded while Overpass lags behind", async ({
	page,
}) => {
	await page.addInitScript(
		([written]) => {
			localStorage.setItem(
				"indoorid.recentUploads",
				JSON.stringify([{ at: Date.now(), written, deleted: [] }]),
			);
		},
		[
			[
				{
					type: "way",
					id: "w100",
					version: 2,
					tags: { indoor: "room", level: "0", name: "Reading room" },
					nodes: ["n101", "n102", "n103", "n104", "n101"],
				},
			],
		],
	);
	await serveOverpass(page, building());
	await page.goto(`/view#19/${LAT}/${LON}/0`);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x, y);
	await expect(
		page
			.getByTestId("feature-card")
			.getByRole("heading", { name: "Reading room" }),
	).toBeVisible();
});

test("the header switches between the editor and the viewer at the same place", async ({
	page,
}) => {
	await serveOverpass(page, []);
	await page.goto(`/#19/${LAT}/${LON}/1`);
	await camera(page);
	await page.getByRole("link", { name: "View", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/view#19/${LAT}/${LON}/1$`));
	await expect(
		page.getByRole("link", { name: "View", exact: true }),
	).toHaveAttribute("aria-current", "page");
	await page.getByRole("link", { name: "Edit", exact: true }).click();
	await expect(page.getByRole("button", { name: "Draw area" })).toBeVisible();
});

test("zoomed out, bubbles show where indoor data is, and a click zooms in", async ({
	page,
}) => {
	const centres = [1, 2, 3].map((id) => ({
		type: "way",
		id,
		center: { lat: LAT + id * 0.0001, lon: LON },
	}));
	const queries = await serveOverpass(page, building(), centres);
	await page.goto(`/view#14/${LAT}/${LON}/0`);
	const before = await camera(page);
	const { x, y } = await mapCenter(page);
	// A bubble of 3: the outline's blue at 0.85 over the background.
	await expectPixel(
		page,
		x,
		y,
		blend([0x74, 0x95, 0xda], 0.85, BACKGROUND),
		12,
	);
	expect(queries.some((q) => q.includes("out ids center"))).toBe(true);
	expect(queries.some((q) => q.includes('nwr["indoor"]'))).toBe(false);

	await page.mouse.click(x, y);
	await expect
		.poll(async () => (await camera(page)).zoom)
		.toBeGreaterThan(before.zoom);
});

test("the side panel lists the places on the level and finds them by name or ref", async ({
	page,
}) => {
	const upper = room(200, LON + 0.001, LAT, "1");
	Object.assign((upper.at(-1) as { tags: Record<string, string> }).tags, {
		name: "Café des arts",
		ref: "B12",
	});
	await serveOverpass(page, [...building().slice(0, 5), ...upper]);
	await page.goto(`/view#19/${LAT}/${LON}/0`);
	await mapDrawn(page);
	const panel = page.getByTestId("viewer-panel");
	const list = panel.getByRole("list", { name: "Places" });
	await expect(list.getByRole("button")).toHaveText(["Library"]);

	await panel
		.getByRole("searchbox", { name: "Search rooms and places" })
		.fill("cafe");
	await expect(list.getByRole("button")).toHaveText([
		"Café des arts B12 Level 1",
	]);
	await list.getByRole("button").click();
	await expect(page.getByTestId("level")).toHaveAttribute("data-level", "1");
	await expect(
		panel
			.getByTestId("feature-card")
			.getByRole("heading", { name: "Café des arts" }),
	).toBeVisible();
	expect(await hash(page)).toMatch(/\/1$/);
});

test("colours an untagged room by the point of interest inside it", async ({
	page,
}) => {
	const elements = [
		...room(100, LON, LAT, "0"),
		{
			type: "node",
			id: 900,
			lon: LON,
			lat: LAT,
			version: 1,
			tags: { amenity: "cafe", level: "0" },
		},
	];
	await serveOverpass(page, elements);
	await page.goto(`/view#19/${LAT}/${LON}/0`);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	await expectPixel(
		page,
		x,
		y + 50,
		blend([0xf3, 0xc9, 0x8b], 0.95, BACKGROUND),
	);
});
