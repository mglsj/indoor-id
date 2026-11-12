import type { Page, Route } from "@playwright/test";
import {
	BACKGROUND,
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
	await expect(
		pane.getByRole("group", { name: "Map or imagery" }).getByRole("radio"),
	).toHaveCount(5);
	await expect(
		pane.getByRole("radio", { name: "OpenFreeMap Light" }),
	).toBeChecked();

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

test("the map stays light in the dark theme; MapLibre's controls follow the theme", async ({
	page,
}) => {
	const styles: string[] = [];
	page.on("request", (r) => {
		if (r.url().includes("/styles/")) styles.push(r.url());
	});
	await page.emulateMedia({ colorScheme: "dark" });
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);
	const { x, y } = await mapCenter(page);

	await expect(page.locator("html")).toHaveClass(/dark/);
	await expectPixel(page, x, y, BACKGROUND);
	const zoomIn = page.locator(".maplibregl-ctrl-group").first();
	const darkControls = await zoomIn.evaluate(
		(el) => getComputedStyle(el).backgroundColor,
	);

	await page.getByRole("button", { name: "Switch to the light theme" }).click();
	await expect(page.locator("html")).not.toHaveClass(/dark/);
	await expect
		.poll(() => zoomIn.evaluate((el) => getComputedStyle(el).backgroundColor))
		.not.toBe(darkControls);
	await expectPixel(page, x, y, BACKGROUND);
	expect(styles.every((url) => url.endsWith("/styles/positron"))).toBe(true);
});

test("shows a solid colour in place of the map, picked in the pane", async ({
	page,
}) => {
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);
	const { x, y } = await mapCenter(page);
	await expectPixel(page, x, y, BACKGROUND);

	const pane = await openPane(page);
	await pane.getByRole("radio", { name: "Solid color" }).check();
	const color = pane.getByLabel("Background color");
	await color.fill("#336699");
	await expectPixel(page, x, y, [0x33, 0x66, 0x99]);

	// Kept for the next visit.
	await page.reload();
	await camera(page);
	await expectPixel(page, x, y, [0x33, 0x66, 0x99]);
	const again = await openPane(page);
	await again.getByRole("radio", { name: "OpenFreeMap Light" }).check();
	await expectPixel(page, x, y, BACKGROUND);
});

test("imagery is moved by dragging in the pane, and dimmed with its sliders (iD)", async ({
	page,
}) => {
	await page.route(`${CUSTOM}/**`, (route) => png(route, RED_PNG));
	await page.goto("/#19/48.13/-1.69/0");
	await camera(page);
	const { x, y } = await mapCenter(page);
	const pane = await openPane(page);
	await pane.getByRole("radio", { name: "Custom" }).check();
	const url = pane.getByLabel("Tile URL");
	await url.fill(`${CUSTOM}/{zoom}/{x}/{y}.png`);
	await url.press("Enter");
	await expectPixel(page, x, y, [255, 0, 0]);

	// A quarter of the pointer's move: 80 px right and up is 20 px at zoom 19 (~4 cm/px here).
	const pad = pane.getByTestId("offset-drag");
	const box = await pad.boundingBox();
	if (!box) throw new Error("No drag pad");
	const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 80, from.y - 80, { steps: 8 });
	await page.mouse.up();
	const offset = pane.getByLabel("Offset in metres (east, north)");
	await expect
		.poll(async () => (await offset.inputValue()).split(", ").map(Number))
		.toEqual([expect.closeTo(0.4, 0), expect.closeTo(0.4, 0)]);
	// The value is typed in the middle of the gray area, without dragging it.
	await offset.click();
	await expect(offset).toBeFocused();

	// Held down, an arrow keeps moving the imagery (iD).
	const east = Number((await offset.inputValue()).split(", ")[0]);
	const arrow = pane.getByRole("button", { name: "Move the imagery east" });
	await arrow.hover();
	await page.mouse.down();
	await expect
		.poll(async () => Number((await offset.inputValue()).split(", ")[0]))
		.toBeGreaterThan(east + 1);
	await page.mouse.up();
	// Still red: the moved tiles replaced the others.
	await expectPixel(page, x, y, [255, 0, 0]);

	// Half the brightness: half the red.
	// The first slider: brightness.
	const brightness = pane.getByRole("slider").first();
	await brightness.focus();
	for (let i = 0; i < 10; i++) await brightness.press("ArrowLeft");
	await expect(pane.getByText("50%")).toBeVisible();
	await expectPixel(page, x, y, [128, 0, 0], 6);
	await pane.getByRole("button", { name: "Reset the display" }).click();
	await expectPixel(page, x, y, [255, 0, 0]);
});
