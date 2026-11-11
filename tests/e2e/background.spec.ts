import type { Page, Route } from "@playwright/test";
import {
	BACKGROUND,
	blankStyle,
	camera,
	expect,
	expectPixel,
	mapCenter,
	test,
} from "./fixtures.ts";

const ESRI =
	"https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile";
const CUSTOM = "https://tiles.example.test";
const CORS = { "access-control-allow-origin": "*" };

/** A 1×1 PNG of one colour: red, or transparent. */
const RED_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
	"base64",
);
const CLEAR_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

const png = (route: Route, body: Buffer) =>
	route.fulfill({ headers: CORS, contentType: "image/png", body });

async function openPane(page: Page) {
	await page.getByRole("button", { name: "Background" }).click();
	return page.getByRole("complementary", { name: "Background" });
}

test("shows Esri imagery chosen in the background pane", async ({ page }) => {
	await page.route(`${ESRI}/**`, (route) => png(route, CLEAR_PNG));
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);

	const pane = await openPane(page);
	await expect(pane.getByRole("radio")).toHaveCount(4);
	await expect(pane.getByRole("radio", { name: /^Map/ })).toBeChecked();

	// MapLibre zoom levels count 512 px tiles: 256 px imagery comes from the next zoom level.
	const tile = page.waitForRequest(
		(r) =>
			r.url().startsWith(`${ESRI}/20/`) && r.url().endsWith("?blankTile=false"),
	);
	await pane
		.getByRole("radio", { name: "Esri World Imagery", exact: true })
		.check();
	await tile;

	// The choice is kept for the next visit.
	await page.reload();
	await camera(page);
	const again = await openPane(page);
	await expect(
		again.getByRole("radio", { name: "Esri World Imagery", exact: true }),
	).toBeChecked();
	await again
		.getByRole("button", { name: "Close the background settings" })
		.click();
	await expect(again).toBeHidden();
});

test("scales up Esri's last tiles where it has none at this zoom", async ({
	page,
}) => {
	// Esri has no tiles past zoom 19 here: asked with blankTile=false, it answers 404.
	const requested: number[] = [];
	await page.route(`${ESRI}/**`, (route) => {
		const url = new URL(route.request().url());
		expect(url.searchParams.get("blankTile")).toBe("false");
		const z = Number(url.pathname.split("/").at(-3));
		requested.push(z);
		return z > 19
			? route.fulfill({ status: 404, headers: CORS })
			: png(route, CLEAR_PNG);
	});
	await page.goto("/#20/48.13/-1.69/0");
	await camera(page);

	const pane = await openPane(page);
	const zoom19 = page.waitForResponse(
		(r) => r.url().startsWith(`${ESRI}/19/`) && r.ok(),
	);
	await pane
		.getByRole("radio", { name: "Esri World Imagery", exact: true })
		.check();
	await zoom19;
	expect(requested).toContain(21);
});

test("shows a custom tile URL, moved by an offset", async ({ page }) => {
	await page.route(`${CUSTOM}/**`, (route) => png(route, RED_PNG));
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);
	const { x, y } = await mapCenter(page);
	await expectPixel(page, x, y, BACKGROUND);

	const pane = await openPane(page);
	const offset = pane.getByLabel("Offset in metres (east, north)");
	await expect(offset).toBeDisabled();
	await pane.getByRole("radio", { name: "Custom" }).check();
	const url = pane.getByLabel("Tile URL");
	await url.fill("https://tiles.example.test/{zoom}/{x}");
	await url.press("Enter");
	await expect(pane.getByText("This URL can't be shown")).toBeVisible();

	const tile = page.waitForRequest(/tiles\.example\.test\/20\/\d+\/\d+\.png/);
	await url.fill(`${CUSTOM}/{zoom}/{x}/{y}.png`);
	await url.press("Enter");
	await tile;
	await expectPixel(page, x, y, [255, 0, 0]);

	// Moved, each tile is drawn from the tiles it overlaps: still red all over.
	await pane.getByRole("button", { name: "Move the imagery east" }).click();
	await pane
		.getByRole("button", { name: "Move the imagery north" })
		.click({ modifiers: ["Shift"] });
	await expect(offset).toHaveValue("0.5, 5");
	await expectPixel(page, x, y, [255, 0, 0]);

	await offset.fill("nowhere");
	await offset.press("Enter");
	await expect(pane.getByText("Type two numbers")).toBeVisible();
	await offset.fill("-2, 1.25");
	await offset.press("Enter");
	await expect(pane.getByText("Type two numbers")).toBeHidden();

	await page.reload();
	await camera(page);
	const again = await openPane(page);
	await expect(again.getByLabel("Tile URL")).toHaveValue(
		`${CUSTOM}/{zoom}/{x}/{y}.png`,
	);
	await expect(again.getByLabel("Offset in metres (east, north)")).toHaveValue(
		"-2, 1.25",
	);
	await again.getByRole("button", { name: "Reset the offset" }).click();
	await expect(again.getByLabel("Offset in metres (east, north)")).toHaveValue(
		"0, 0",
	);
});

test("the map, its controls and the page share one theme, toggled in the header", async ({
	page,
}) => {
	const DARK: [number, number, number] = [0x20, 0x22, 0x28];
	await page.route(/\/styles\/dark$/, (route) =>
		route.fulfill({
			json: {
				...blankStyle,
				layers: [
					{
						id: "background",
						type: "background",
						paint: { "background-color": "#202228" },
					},
				],
			},
		}),
	);
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);
	const { x, y } = await mapCenter(page);

	await expect(page.locator("html")).toHaveClass(/dark/);
	await expectPixel(page, x, y, DARK);
	const zoomIn = page.locator(".maplibregl-ctrl-group").first();
	const darkControls = await zoomIn.evaluate(
		(el) => getComputedStyle(el).backgroundColor,
	);

	const light = page.waitForRequest(/\/styles\/positron$/);
	await page.getByRole("button", { name: "Switch to the light theme" }).click();
	await light;
	await expect(page.locator("html")).not.toHaveClass(/dark/);
	await expectPixel(page, x, y, BACKGROUND);
	await expect
		.poll(() => zoomIn.evaluate((el) => getComputedStyle(el).backgroundColor))
		.not.toBe(darkControls);

	// Kept over the system's preference.
	await page.reload();
	await camera(page);
	await expect(page.locator("html")).not.toHaveClass(/dark/);
	await expect(
		page.getByRole("button", { name: "Switch to the dark theme" }),
	).toBeVisible();
});
