import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { PLAN_COLORS } from "../../src/lib/floorplans/colors.ts";
import {
	BACKGROUND,
	blend,
	camera,
	expect,
	expectPixel,
	inspector,
	LAT,
	LON,
	lngLatAt,
	mapDrawn,
	mapLocator,
	pixelAt,
	room,
	serveOsm,
	test,
	WORLD,
} from "./fixtures.ts";

const FILES = path.join(import.meta.dirname, "files");
const RED: [number, number, number] = [255, 0, 0];
/** Colour of building outlines in floor plan mode. */
const BUILDING_OUTLINE: [number, number, number] = [0xd6, 0x24, 0x9f];

/** The rows of the layer list that are plans, top first (the Buildings row left out). */
function planRows(page: Page) {
	return page
		.getByRole("list", { name: "Layers" })
		.getByRole("listitem")
		.filter({ hasNot: page.getByText("Buildings", { exact: true }) });
}

/** Opens the floor plans panel and imports a file from tests/e2e/files. */
async function importPlan(page: Page, file: string) {
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await page.getByRole("button", { name: "Floor plans" }).click();
	await page
		.getByLabel("Import a floor plan")
		.setInputFiles(path.join(FILES, file));
}

/**
 * Where new plans go: the middle of the map beside the floor plan side panel. `mx` is the map's
 * own centre, (LON, LAT); `scale`, the screen pixels a plan pixel `planHeight` tall takes.
 */
async function initialLayout(page: Page, planHeight: number) {
	const box = await mapLocator(page).boundingBox();
	const panel = await page
		.getByRole("complementary", { name: "Floor plan editor" })
		.boundingBox();
	if (!box || !panel) throw new Error("No map or floor plan panel");
	const left = panel.x + panel.width;
	return {
		cx: (left + box.x + box.width) / 2,
		cy: box.y + box.height / 2,
		mx: box.x + box.width / 2,
		scale: (box.height * 0.6) / planHeight,
	};
}

/**
 * Checks that a plan of the given aspect ratio is drawn where new plans go, 60% of the map tall,
 * in `color` at opacity 0.5: pixels just inside its edges are blended, just outside not.
 */
async function expectPlanDrawn(
	page: Page,
	color: [number, number, number],
	aspect: number,
) {
	const { cx, cy, scale } = await initialLayout(page, 1);
	const height = scale;
	const width = height * aspect;
	const plan = blend(color, 0.5, BACKGROUND);

	await expectPixel(page, cx, cy, plan);
	await expectPixel(page, cx - width * 0.45, cy, plan);
	await expectPixel(page, cx + width * 0.45, cy, plan);
	await expectPixel(page, cx, cy - height * 0.45, plan);
	await expectPixel(page, cx, cy + height * 0.45, plan);
	await expectPixel(page, cx - width * 0.55, cy, BACKGROUND);
	await expectPixel(page, cx + width * 0.55, cy, BACKGROUND);
	await expectPixel(page, cx, cy - height * 0.55, BACKGROUND);
	await expectPixel(page, cx, cy + height * 0.55, BACKGROUND);
}

for (const file of ["plan.png", "plan.jpg", "plan.webp"]) {
	test(`imports a ${path.extname(file)} plan over the map`, async ({
		page,
	}) => {
		await importPlan(page, file);
		// Imported in Edit: the name is in the row's name field.
		await expect(planRows(page)).toContainText(["400 × 300 px"]);
		await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(
			"plan",
		);
		await expectPlanDrawn(page, RED, 4 / 3);
	});
}

test("imports an SVG plan as paths, without running its scripts, kept after a reload", async ({
	page,
}) => {
	await importPlan(page, "plan.svg");
	await expectPlanDrawn(page, [0, 255, 0], 4 / 3);
	expect(await page.evaluate(() => "svgRan" in window)).toBe(false);
	// Measured in its own units, not pixels: drawn from its paths.
	await expect(planRows(page).first()).toContainText("400 × 300");
	await expect(planRows(page).first()).not.toContainText("px");

	await page.getByRole("button", { name: "Done" }).click();
	// Saved once its paths are: a reload could cut the write short.
	await expect
		.poll(async () => {
			const { plans, complete } = await storedPlans(page);
			return complete && JSON.parse(plans).length === 1;
		})
		.toBe(true);
	await page.reload();
	await page.getByRole("button", { name: "Floor plans" }).click();
	await expectPlanDrawn(page, [0, 255, 0], 4 / 3);
});

test("imports the chosen page of a PDF at the chosen resolution", async ({
	page,
}) => {
	await importPlan(page, "plan.pdf");

	const dialog = page.getByRole("dialog", { name: "Import PDF pages" });
	const pages = dialog.getByRole("checkbox");
	await expect(pages).toHaveCount(2);
	// The first page is chosen to start with.
	await expect(dialog.getByRole("checkbox", { name: "Page 1" })).toBeChecked();
	await expect(dialog.getByLabel("Resolution (DPI)")).toHaveValue("150");
	await dialog.getByRole("radio", { name: "Image" }).click();
	await dialog.getByRole("checkbox", { name: "Page 1" }).click();
	await dialog.getByRole("checkbox", { name: "Page 2" }).click();
	await dialog.getByRole("button", { name: "Import" }).click();

	// 4 × 3 inches at 150 DPI. Rendering in software takes a while when the machine is busy.
	await expect(planRows(page)).toContainText(["600 × 450 px"], {
		timeout: 20_000,
	});
	await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(
		"plan, page 2",
	);
	await expectPlanDrawn(page, [0, 0, 255], 4 / 3);
});

test("imports a PDF page from its paths, measured in points", async ({
	page,
}) => {
	await importPlan(page, "plan.pdf");
	const dialog = page.getByRole("dialog", { name: "Import PDF pages" });
	await dialog.getByRole("radio", { name: "Vector" }).click();
	await dialog.getByRole("button", { name: "Import" }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	// 4 × 3 inches: 288 × 216 points, no pixels.
	await expect(planRows(page).first()).toContainText("288 × 216");
	await expect(planRows(page).first()).not.toContainText("px");
	await expectPlanDrawn(page, [255, 0, 0], 4 / 3);
});

/** The darkest channel value in a box of the screen: low where text is drawn. */
async function darkest(
	page: Page,
	box: { x: number; y: number; width: number; height: number },
): Promise<number> {
	const clip = {
		x: Math.round(box.x),
		y: Math.round(box.y),
		width: Math.round(box.width),
		height: Math.round(box.height),
	};
	const png = await page.screenshot({ clip });
	return page.evaluate(
		async ({ base64, width, height }) => {
			const blob = await (
				await fetch(`data:image/png;base64,${base64}`)
			).blob();
			const canvas = new OffscreenCanvas(width, height);
			const context = canvas.getContext("2d");
			if (!context) throw new Error("No 2D context");
			context.drawImage(await createImageBitmap(blob), 0, 0);
			const data = context.getImageData(0, 0, width, height).data;
			let min = 255;
			for (let i = 0; i < data.length; i += 4) {
				min = Math.min(
					min,
					data[i] ?? 255,
					data[i + 1] ?? 255,
					data[i + 2] ?? 255,
				);
			}
			return min;
		},
		{ base64: png.toString("base64"), width: clip.width, height: clip.height },
	);
}

test("draws a PDF's text as labels where the PDF has it", async ({ page }) => {
	await importPlan(page, "layers.pdf");
	const dialog = page.getByRole("dialog", { name: "Import PDF pages" });
	await dialog.getByRole("radio", { name: "Vector" }).click();
	await dialog.getByRole("button", { name: "Import" }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });

	// 288 × 216 pt; "Hall" in 24 pt Helvetica, 41 pt long from (100, 100) up from the bottom
	// left: its middle 23 pt left of the page's and level with it.
	const { cx, cy, scale } = await initialLayout(page, 216);
	const label = {
		x: cx - (23 + 25) * scale,
		y: cy - 15 * scale,
		width: 50 * scale,
		height: 30 * scale,
	};
	// Dark text (#333 at the plan's opacity, 0.5) where the label is; the page bare beside it.
	// The label waits for its glyphs and a software-rendered frame: slow on a busy machine.
	await expect
		.poll(() => darkest(page, label), { timeout: 15_000 })
		.toBeLessThan(170);
	expect(await darkest(page, { ...label, x: cx + 20 * scale })).toBeGreaterThan(
		200,
	);
});

test("hides a PDF's CAD layers, its text with them", async ({ page }) => {
	await importPlan(page, "layers.pdf");
	const dialog = page.getByRole("dialog", { name: "Import PDF pages" });
	await dialog.getByRole("radio", { name: "Vector" }).click();
	await dialog.getByRole("button", { name: "Import" }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });

	// The frame (Walls): a 4 pt black line 20 pt in from the page's left edge, at half opacity.
	const { cx, cy, scale } = await initialLayout(page, 216);
	const frame = { x: cx - (144 - 20) * scale, y: cy };
	const label = {
		x: cx - 48 * scale,
		y: cy - 15 * scale,
		width: 50 * scale,
		height: 30 * scale,
	};
	await expectPixel(page, frame.x, frame.y, blend([0, 0, 0], 0.5, BACKGROUND));
	await expect
		.poll(() => darkest(page, label), { timeout: 15_000 })
		.toBeLessThan(170);

	const layers = page.getByRole("group", { name: "Layers" });
	await expect(layers.getByRole("checkbox")).toHaveCount(2);
	await layers.getByRole("checkbox", { name: "Labels" }).click();
	await expect.poll(() => darkest(page, label)).toBeGreaterThan(200);
	await expectPixel(page, frame.x, frame.y, blend([0, 0, 0], 0.5, BACKGROUND));

	await layers.getByRole("checkbox", { name: "Walls" }).click();
	await expectPixel(page, frame.x, frame.y, BACKGROUND);
	await layers.getByRole("button", { name: "Show all" }).click();
	await expectPixel(page, frame.x, frame.y, blend([0, 0, 0], 0.5, BACKGROUND));
	await expect
		.poll(() => darkest(page, label), { timeout: 15_000 })
		.toBeLessThan(170);
});

test("imports several PDF pages as plans, all on the level shown", async ({
	page,
}) => {
	await importPlan(page, "plan.pdf");
	const dialog = page.getByRole("dialog", { name: "Import PDF pages" });
	await dialog.getByRole("checkbox", { name: "Page 2" }).click();
	await dialog.getByRole("button", { name: "Import 2 pages" }).click();
	// Rendering two pages in software takes a while when the machine is busy.
	await expect(dialog).toBeHidden({ timeout: 20_000 });

	// Top first: page 2, imported last and in Edit, then page 1; both on level 0.
	await expect(planRows(page)).toHaveCount(2);
	await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(
		"plan, page 2",
	);
	const level = page.getByRole("textbox", { name: "Level", exact: true });
	await expect(level).toHaveValue("0");
	await expect(planRows(page).nth(1)).toContainText("plan, page 1");
	await expect(planRows(page).nth(1)).toContainText("Level 0");
	// Both shown, in the same spot: page 2 (blue) drawn over page 1 (red).
	const { cx, cy } = await initialLayout(page, 300);
	await expectPixel(
		page,
		cx,
		cy,
		blend([0, 0, 255], 0.5, blend([255, 0, 0], 0.5, BACKGROUND)),
	);
});

/** How many files plans were imported from are stored in IndexedDB. */
function storedFiles(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			new Promise<number>((resolve, reject) => {
				const open = indexedDB.open("indoorid-floorplans");
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const count = open.result
						.transaction("originals")
						.objectStore("originals")
						.count();
					count.onsuccess = () => {
						open.result.close();
						resolve(count.result);
					};
				};
			}),
	);
}

test("exports plans in an archive with their PDF once, read back drawn again", async ({
	page,
}) => {
	await importPlan(page, "plan.pdf");
	const dialog = page.getByRole("dialog", { name: "Import PDF pages" });
	await dialog.getByRole("checkbox", { name: "Page 2" }).click();
	await dialog.getByRole("button", { name: "Import 2 pages" }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	await expect.poll(() => storedFiles(page)).toBe(1);

	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("button", { name: "Export floor plans" }).click(),
	]);
	expect(download.suggestedFilename()).toBe("indoorid-floorplans.zip");
	const bytes = readFileSync(await download.path());
	const archive = unzipSync(bytes);
	expect(Object.keys(archive).sort()).toEqual(["files/1.pdf", "plans.json"]);
	const { version, plans } = JSON.parse(
		strFromU8(archive["plans.json"] ?? new Uint8Array()),
	);
	expect(version).toBe(2);
	expect(plans.map((p: { source: unknown }) => p.source)).toEqual([
		// Auto: the test PDF's pages are paths.
		{ kind: "pdf", file: "files/1.pdf", page: 1, dpi: 150, mode: "vector" },
		{ kind: "pdf", file: "files/1.pdf", page: 2, dpi: 150, mode: "vector" },
	]);

	// Imported back: both pages drawn again from the PDF, stored once more (a copy of its own).
	await page.getByLabel("Import a floor plan").setInputFiles({
		name: download.suggestedFilename(),
		mimeType: "application/zip",
		buffer: bytes,
	});
	await expect(planRows(page)).toHaveCount(4, { timeout: 20_000 });
	// Drawn again from their paths, as they were.
	await expect(planRows(page).first()).toContainText("288 × 216");
	await expect(planRows(page).first()).not.toContainText("px");
	await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue(
		"plan, page 2",
	);
	await expect.poll(() => storedFiles(page)).toBe(2);
});

/** A mall 0.0008° (~600 px at zoom 19) wide around (LON, LAT), tagged as the one in Rennes. */
function mall() {
	return room(200, LON, LAT, "0", 0.0004).map((e) =>
		e.type === "way"
			? { ...e, tags: { building: "retail", shop: "mall", name: "Mall" } }
			: e,
	);
}

test("floor plan mode shows only building outlines, without selection", async ({
	page,
}) => {
	// A room inside a mall 0.0008° (~600 px at zoom 19) wide, tagged as the one in Rennes.
	await serveOsm(page, [...room(100, LON, LAT, "0"), ...mall()]);
	await page.goto(`/#19/${LAT}/${LON}/0`);
	const box = await mapLocator(page).boundingBox();
	if (!box) throw new Error("No map");
	const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const editor = inspector(page).root;
	await mapDrawn(page);
	await page.mouse.click(centre.x, centre.y);
	await expect(editor).toBeVisible();
	const editing = await pixelAt(page, centre.x, centre.y);

	// The feature editor and the floor plan editor take turns in the side panel, on the left.
	const editorBox = await editor.boundingBox();
	expect(editorBox?.x).toBe(box.x);
	await page.getByRole("button", { name: "Floor plans" }).click();
	await expect(editor).toBeHidden();
	const planEditor = page.getByRole("complementary", {
		name: "Floor plan editor",
	});
	await expect(planEditor).toBeVisible();
	expect((await planEditor.boundingBox())?.x).toBe(box.x);
	await expect(page.getByRole("group", { name: "Edit history" })).toBeHidden();
	// Rooms and fills are hidden; the building's outline is drawn ~298 px right of the centre.
	await expectPixel(page, centre.x, centre.y, BACKGROUND);
	await expectPixel(page, centre.x + 298, centre.y, BUILDING_OUTLINE, 40);
	// Clicking a room selects nothing.
	await page.mouse.click(centre.x, centre.y);
	await expect(editor).toBeHidden();

	await page.getByRole("button", { name: "Close" }).click();
	await expect(planEditor).toBeHidden();
	await expect(page.getByRole("group", { name: "Edit history" })).toBeVisible();
	await expectPixel(page, centre.x, centre.y, editing);
});

test("draws a plan over the rooms already mapped", async ({ page }) => {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await importPlan(page, "plan.png");
	// The plan, ~540 px wide, covers the room in the map's centre.
	const { mx, cy } = await initialLayout(page, 300);
	await page.getByRole("button", { name: "Close" }).click();
	// Back to editing: the room's fill (80% opaque), then the plan at half opacity on top.
	const roomFill = blend([0xd6, 0xd1, 0xc7], 0.8, BACKGROUND);
	await expectPixel(page, mx, cy, blend(RED, 0.5, roomFill));
});

test("keeps the fine lines of a large plan when it is shown small", async ({
	page,
}) => {
	// 4000 × 3000 px of alternating 1 px black and white columns, shown ~400 px tall: each
	// screen pixel covers several columns and should average them to mid-grey everywhere.
	await importPlan(page, "stripes.png");
	const { cx, cy } = await initialLayout(page, 3000);
	const grey = blend([128, 128, 128], 0.5, BACKGROUND);
	for (const dx of [-150, -97, -41, 0, 23, 71, 133]) {
		await expectPixel(page, cx + dx, cy, grey, 12);
	}
});

/**
 * Checks a rectangle of plan colour, 5 px inside and outside each edge (screen pixels): clear of
 * the 2 px frame drawn around plans in floor plan mode.
 */
async function expectPlanAt(
	page: Page,
	{
		left,
		top,
		right,
		bottom,
	}: { left: number; top: number; right: number; bottom: number },
) {
	const plan = blend(RED, 0.5, BACKGROUND);
	const midX = (left + right) / 2;
	const midY = (top + bottom) / 2;
	await expectPixel(page, left + 5, midY, plan);
	await expectPixel(page, right - 5, midY, plan);
	await expectPixel(page, midX, top + 5, plan);
	await expectPixel(page, midX, bottom - 5, plan);
	await expectPixel(page, left - 5, midY, BACKGROUND);
	await expectPixel(page, right + 5, midY, BACKGROUND);
	await expectPixel(page, midX, top - 5, BACKGROUND);
	await expectPixel(page, midX, bottom + 5, BACKGROUND);
}

/**
 * OSM nodes to snap control points to: the ends of a wall on level 0 (snapping only goes to
 * nodes drawn on the shown level; floor plan mode hides the wall itself).
 */
function nodesAt(...offsets: [number, number][]) {
	return nodesOnLevel("0", ...offsets);
}

function nodesOnLevel(level: string, ...offsets: [number, number][]) {
	const nodes = offsets.map(([dx, dy], i) => {
		const [lon, lat] = lngLatAt(dx, dy);
		return { type: "node", id: 900 + i, lon, lat, version: 1 };
	});
	const wall = {
		type: "way",
		id: 950,
		version: 1,
		nodes: nodes.map((n) => n.id),
		tags: { indoor: "wall", level },
	};
	return [...nodes, wall];
}

test("aligns a plan with control points snapped to OSM nodes", async ({
	page,
}) => {
	// Nodes A and B, 360 × 260 screen px apart: plan pixels (20, 20) and (380, 280) go there.
	const A: [number, number] = [-180, -130];
	const B: [number, number] = [180, 130];
	await serveOsm(page, nodesAt(A, B));
	await importPlan(page, "plan.png");
	await expect(page.getByTestId("load-status")).toBeHidden();
	const { cx, cy, mx, scale } = await initialLayout(page, 300);

	await page.getByRole("radio", { name: "Control points" }).click();
	// Plan pixel (20, 20), where the plan was imported; then 7 px (5, −5) off node A. Both clicks
	// miss their node the same way, so without snapping the whole plan would shift.
	await page.mouse.click(cx + (20 - 200) * scale, cy + (20 - 150) * scale);
	await page.mouse.click(mx + A[0] + 5, cy + A[1] - 5);
	// One point moves the plan: pixel (380, 280) is now 360 × 260 plan pixels from A.
	await page.mouse.click(mx + A[0] + 360 * scale, cy + A[1] + 260 * scale);
	await page.mouse.click(mx + B[0] + 5, cy + B[1] - 5);

	await expect(
		page.getByRole("list", { name: "Control points" }).getByRole("listitem"),
	).toHaveCount(2);
	// Snapped exactly: one screen pixel per plan pixel, pixel (20, 20) on A.
	await expectPlanAt(page, {
		left: mx + A[0] - 20,
		top: cy + A[1] - 20,
		right: mx + A[0] + 380,
		bottom: cy + A[1] + 280,
	});
});

test("snaps a control point to a vector plan's own corner", async ({
	page,
}) => {
	const A: [number, number] = [-180, -130];
	await serveOsm(page, nodesAt(A, [180, 130]));
	await importPlan(page, "layers.pdf");
	const dialog = page.getByRole("dialog", { name: "Import PDF pages" });
	await dialog.getByRole("radio", { name: "Vector" }).click();
	await dialog.getByRole("button", { name: "Import" }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	await expect(page.getByTestId("load-status")).toBeHidden();
	// 288 × 216 pt; the frame (Walls) a 4 pt line whose top-left corner is at (20, 20).
	const { cx, cy, mx, scale } = await initialLayout(page, 216);

	await page.getByRole("radio", { name: "Control points" }).click();
	// Both clicks 5 px right of and above what they mean: the frame's corner, then node A.
	await page.mouse.click(
		cx + (20 - 144) * scale + 5,
		cy + (20 - 108) * scale - 5,
	);
	await page.mouse.click(mx + A[0] + 5, cy + A[1] - 5);
	await expect(
		page.getByRole("list", { name: "Control points" }).getByRole("listitem"),
	).toHaveCount(1);
	// The corner moved onto A exactly: the frame's left edge runs down through it (unsnapped,
	// it would run 5 px to the left, off a line some 7 px wide).
	await expectPixel(
		page,
		mx + A[0],
		cy + A[1] + 40,
		blend([0, 0, 0], 0.5, BACKGROUND),
	);
});

test("control points don't snap to nodes on another level", async ({
	page,
}) => {
	const A: [number, number] = [-180, -130];
	const B: [number, number] = [180, 130];
	// The wall is on level 1; level 0 is shown.
	await serveOsm(page, nodesOnLevel("1", A, B));
	await importPlan(page, "plan.png");
	await expect(page.getByTestId("load-status")).toBeHidden();
	const { cx, cy, mx, scale } = await initialLayout(page, 300);

	await page.getByRole("radio", { name: "Control points" }).click();
	await page.mouse.click(cx + (20 - 200) * scale, cy + (20 - 150) * scale);
	await page.mouse.click(mx + A[0] + 5, cy + A[1] - 5);
	await page.mouse.click(mx + A[0] + 360 * scale, cy + A[1] + 260 * scale);
	await page.mouse.click(mx + B[0] + 5, cy + B[1] - 5);

	// Placed where clicked: 5 px right of and 5 px above the nodes.
	await expectPlanAt(page, {
		left: mx + A[0] - 20 + 5,
		top: cy + A[1] - 20 - 5,
		right: mx + A[0] + 380 + 5,
		bottom: cy + A[1] + 280 - 5,
	});
});

test("shows how far each control point is from where the plan puts it", async ({
	page,
}) => {
	const A: [number, number] = [-180, -130];
	const B: [number, number] = [180, 130];
	await serveOsm(page, nodesAt(A, B));
	await importPlan(page, "plan.png");
	await expect(page.getByTestId("load-status")).toBeHidden();
	const { cx, cy, mx, scale } = await initialLayout(page, 300);

	await page.getByRole("radio", { name: "Control points" }).click();
	await page.mouse.click(cx + (20 - 200) * scale, cy + (20 - 150) * scale);
	await page.mouse.click(mx + A[0], cy + A[1]);
	await page.mouse.click(mx + A[0] + 360 * scale, cy + A[1] + 260 * scale);
	await page.mouse.click(mx + B[0], cy + B[1]);
	// Plan pixel (380, 20), now on screen at A + (360, 0), measured 20 px (~2 m) too far south.
	await page.mouse.click(mx + A[0] + 360, cy + A[1]);
	await page.mouse.click(mx + A[0] + 360, cy + A[1] + 20);

	const points = page
		.getByRole("list", { name: "Control points" })
		.getByRole("listitem");
	await expect(points).toHaveCount(3);
	const rms = await page.getByText(/^RMS error/).textContent();
	const metres = Number(rms?.match(/([\d.]+) m/)?.[1]);
	// Least squares spreads the 2 m error over the three points.
	expect(metres).toBeGreaterThan(0.3);
	expect(metres).toBeLessThan(2);
});

test("scales a plan to a measured distance", async ({ page }) => {
	await importPlan(page, "plan.png");
	const { cx, cy, scale } = await initialLayout(page, 300);

	await page.getByRole("radio", { name: "Measure" }).click();
	// Plan pixels (10, 150) and (390, 150): 380 px apart, said to be 38 m.
	const x1 = cx + (10 - 200) * scale;
	await page.mouse.click(x1, cy);
	await page.mouse.click(cx + (390 - 200) * scale, cy);
	await page.getByLabel("Real distance (m)").fill("38");
	await page.getByRole("button", { name: "Scale" }).click();

	// The plan is now 40 × 30 m. At zoom 19 a screen pixel is 2πR·cos(lat) / 512 / 2^19 m.
	const metresPerPixel =
		(2 * Math.PI * 6378137 * Math.cos((LAT * Math.PI) / 180)) / WORLD;
	const s = 40 / 400 / metresPerPixel;
	// Scaled about the first measured point, which stays put.
	await expectPlanAt(page, {
		left: x1 - 10 * s,
		top: cy - 150 * s,
		right: x1 + 390 * s,
		bottom: cy + 150 * s,
	});
});

test("keeps plans, where they were placed, after a reload", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const { cx, cy, scale } = await initialLayout(page, 300);
	await page.getByRole("radio", { name: "Measure" }).click();
	const x1 = cx + (10 - 200) * scale;
	await page.mouse.click(x1, cy);
	await page.mouse.click(cx + (390 - 200) * scale, cy);
	await page.getByLabel("Real distance (m)").fill("38");
	await page.getByRole("button", { name: "Scale" }).click();
	const metresPerPixel =
		(2 * Math.PI * 6378137 * Math.cos((LAT * Math.PI) / 180)) / WORLD;
	const s = 40 / 400 / metresPerPixel;
	const scaled = {
		left: x1 - 10 * s,
		top: cy - 150 * s,
		right: x1 + 390 * s,
		bottom: cy + 150 * s,
	};
	await expectPlanAt(page, scaled);
	await untilSaved(page, () =>
		page.getByRole("button", { name: "Done" }).click(),
	);

	await page.reload();

	await expectPlanAt(page, scaled);
	await page.getByRole("button", { name: "Floor plans" }).click();
	await expect(planRows(page)).toContainText(["plan 400 × 300 px"]);
});

test("draws a large stored plan's tiles on screen only, more as the map is panned", async ({
	page,
}) => {
	await page.goto(`/#19/${LAT}/${LON}/0`);
	// 6000 × 1500 px: three columns of 2048 px tiles, red, green and blue.
	const png = await page.evaluate(async () => {
		const canvas = new OffscreenCanvas(6000, 1500);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("No 2D context");
		for (const [x, color] of [
			[0, "#ff0000"],
			[2048, "#00ff00"],
			[4096, "#0000ff"],
		] as const) {
			context.fillStyle = color;
			context.fillRect(x, 0, 2048, 1500);
		}
		const blob = await canvas.convertToBlob({ type: "image/png" });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	});
	await page.getByRole("button", { name: "Floor plans" }).click();
	await page.getByLabel("Import a floor plan").setInputFiles({
		name: "large.png",
		mimeType: "image/png",
		buffer: Buffer.from(png, "base64"),
	});
	const latitude = page.getByRole("spinbutton", { name: "Latitude" });
	const longitude = page.getByRole("spinbutton", { name: "Longitude" });
	await expect(latitude).not.toHaveValue("");
	const centre = [await latitude.inputValue(), await longitude.inputValue()];
	await page.getByRole("button", { name: "Done" }).click();
	// Saved once its tiles are encoded: then they load from storage, not decoded yet.
	await expect
		.poll(
			async () => {
				const { plans, complete } = await storedPlans(page);
				return complete && JSON.parse(plans).length === 1;
			},
			{ timeout: 60_000 },
		)
		.toBe(true);

	// Zoomed in on the plan's middle: about a plan pixel a screen pixel, its full size drawn,
	// only the green tile on screen.
	await page.goto(`/#21/${centre[0]}/${centre[1]}/0`);
	await page.reload();
	const map = mapLocator(page);
	await expect(map).toHaveAttribute("data-plan-tiles", "1", {
		timeout: 20_000,
	});
	const box = await map.boundingBox();
	if (!box) throw new Error("No map");
	const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await expectPixel(
		page,
		middle.x,
		middle.y,
		blend([0, 255, 0], 0.5, BACKGROUND),
	);

	// Panned 1200 px east: the blue tile comes on screen, right of the middle.
	await page.mouse.move(middle.x + 600, middle.y);
	await page.mouse.down();
	await page.mouse.move(middle.x - 600, middle.y, { steps: 20 });
	await page.mouse.up();
	await expect(map).toHaveAttribute("data-plan-tiles", "2", {
		timeout: 20_000,
	});
	await expectPixel(
		page,
		middle.x + 450,
		middle.y,
		blend([0, 0, 255], 0.5, BACKGROUND),
	);
});

test("shows a plan only on its level", async ({ page }) => {
	await importPlan(page, "plan.png");
	const { cx, cy } = await initialLayout(page, 300);
	const centre = { x: cx, y: cy };
	const plan = blend(RED, 0.5, BACKGROUND);
	// Imported on the level shown, 0.
	await expect(
		page.getByRole("textbox", { name: "Level", exact: true }),
	).toHaveValue("0");
	await expectPixel(page, centre.x, centre.y, plan);

	await page.getByRole("textbox", { name: "Level", exact: true }).fill("1");
	await page
		.getByRole("textbox", { name: "Level", exact: true })
		.press("Enter");
	await expectPixel(page, centre.x, centre.y, BACKGROUND);

	await page.getByRole("button", { name: "Level up" }).click();
	await expect(page.getByTestId("level")).toHaveText("1");
	await expectPixel(page, centre.x, centre.y, plan);
});

/** Drags with the mouse from one screen point to another, in steps like a hand would. */
async function drag(
	page: Page,
	from: { x: number; y: number },
	to: { x: number; y: number },
) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 8 });
	await page.mouse.up();
}

/**
 * The plans' settings as saved in the browser's IndexedDB, as JSON, and whether each plan's
 * content is saved too. Saving takes a moment: a test reloads once what it saved is there, or
 * the reload may cut the write short.
 */
function storedPlans(
	page: Page,
): Promise<{ plans: string; complete: boolean }> {
	return page.evaluate(
		() =>
			new Promise<{ plans: string; complete: boolean }>((resolve, reject) => {
				const open = indexedDB.open("indoorid-floorplans");
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					if (!db.objectStoreNames.contains("vectors")) {
						db.close();
						resolve({ plans: "[]", complete: true });
						return;
					}
					const tx = db.transaction(["plans", "rasters", "vectors"]);
					const plans = tx.objectStore("plans").getAll();
					const rasters = tx.objectStore("rasters").getAllKeys();
					const vectors = tx.objectStore("vectors").getAllKeys();
					tx.onerror = () => reject(tx.error);
					tx.oncomplete = () => {
						db.close();
						const saved = new Set([...rasters.result, ...vectors.result]);
						resolve({
							plans: JSON.stringify(plans.result),
							complete: plans.result.every((p: { id: string }) =>
								saved.has(p.id),
							),
						});
					};
				};
			}),
	);
}

/** Runs `change`, then waits until the saved plans differ from before it. */
async function untilSaved(page: Page, change: () => Promise<void>) {
	const before = (await storedPlans(page)).plans;
	await change();
	await expect
		.poll(async () => {
			const { plans, complete } = await storedPlans(page);
			return plans !== before && complete;
		})
		.toBe(true);
}

/** Where the 400 × 300 px plan is once imported: centred, 60% of the map tall. */
async function importedPlanBox(page: Page) {
	// Imported in the plan worker: the plan is in Edit once it is there.
	await expect(
		page.getByRole("region", { name: "Editing plan" }),
	).toBeVisible();
	const { cx, cy, scale } = await initialLayout(page, 300);
	const w = 400 * scale;
	const h = 300 * scale;
	return {
		cx,
		cy,
		w,
		h,
		left: cx - w / 2,
		top: cy - h / 2,
		right: cx + w / 2,
		bottom: cy + h / 2,
	};
}

test("moves a plan by dragging it", async ({ page }) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await expectPlanAt(page, plan);

	await drag(
		page,
		{ x: plan.cx, y: plan.cy },
		{ x: plan.cx + 100, y: plan.cy + 60 },
	);

	await expectPlanAt(page, {
		left: plan.left + 100,
		top: plan.top + 60,
		right: plan.right + 100,
		bottom: plan.bottom + 60,
	});
});

test("places a plan from a longitude typed, the fields following a drag", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await expectPlanAt(page, plan);

	// 100 screen pixels east at zoom 19: MapLibre's world is 512 × 2^19 pixels around.
	const longitude = page.getByRole("spinbutton", { name: "Longitude" });
	const before = Number(await longitude.inputValue());
	await longitude.fill(String(before + (100 * 360) / (512 * 2 ** 19)));
	await longitude.press("Enter");
	await expectPlanAt(page, {
		left: plan.left + 100,
		top: plan.top,
		right: plan.right + 100,
		bottom: plan.bottom,
	});

	// Dragged back: the field follows.
	await drag(
		page,
		{ x: plan.cx + 100, y: plan.cy },
		{ x: plan.cx, y: plan.cy },
	);
	await expect
		.poll(async () => Number(await longitude.inputValue()))
		.toBeCloseTo(before, 6);
});

test("turns and resizes a plan from a corner, around the opposite one", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);

	// The top-right corner a quarter of the diagonal further out: 1.25 times larger, the
	// bottom-left corner staying put.
	await drag(
		page,
		{ x: plan.right, y: plan.top },
		{ x: plan.right + plan.w / 4, y: plan.top - plan.h / 4 },
	);

	await expectPlanAt(page, {
		left: plan.left,
		top: plan.bottom - plan.h * 1.25,
		right: plan.left + plan.w * 1.25,
		bottom: plan.bottom,
	});
});

test("only resizes a plan when a corner is dragged off its diagonal", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);

	// 100 px to the right of the top-right corner: along the diagonal from the bottom left,
	// (w + 100, −h) reaches k = 1 + 100·w / (w² + h²) of it. No turning.
	await drag(
		page,
		{ x: plan.right, y: plan.top },
		{ x: plan.right + 100, y: plan.top },
	);

	const k = 1 + (100 * plan.w) / (plan.w ** 2 + plan.h ** 2);
	await expectPlanAt(page, {
		left: plan.left,
		top: plan.bottom - plan.h * k,
		right: plan.left + plan.w * k,
		bottom: plan.bottom,
	});
});

test("turns a plan with the handle above it", async ({ page }) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);

	// The handle sits above the top edge's middle, 8% of the plan's height out. Dragged to
	// the right of the centre, the plan turns a quarter clockwise around its centre.
	await drag(
		page,
		{ x: plan.cx, y: plan.top - 0.08 * plan.h },
		{ x: plan.cx + 250, y: plan.cy },
	);

	await expectPlanAt(page, {
		left: plan.cx - plan.h / 2,
		top: plan.cy - plan.w / 2,
		right: plan.cx + plan.h / 2,
		bottom: plan.cy + plan.w / 2,
	});
});

test("stretches a plan from a corner with Shift", async ({ page }) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);

	await page.keyboard.down("Shift");
	await drag(
		page,
		{ x: plan.right, y: plan.top },
		{ x: plan.right + 80, y: plan.top },
	);
	await page.keyboard.up("Shift");

	await expectPlanAt(page, { ...plan, right: plan.right + 80 });
});

test("keeps a dragged plan where it was left after a reload", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await drag(
		page,
		{ x: plan.cx, y: plan.cy },
		{ x: plan.cx + 70, y: plan.cy + 40 },
	);
	// (Moved right: the floor plans panel covers the left of the map.)
	const moved = {
		left: plan.left + 70,
		top: plan.top + 40,
		right: plan.right + 70,
		bottom: plan.bottom + 40,
	};
	await expectPlanAt(page, moved);
	await untilSaved(page, () =>
		page.getByRole("button", { name: "Done" }).click(),
	);

	await page.reload();

	await expectPlanAt(page, moved);
});

/** The colour of the `nth` plan from the top of the list, as its row's swatch shows it. */
async function planColor(
	page: Page,
	nth = 0,
): Promise<[number, number, number]> {
	const css = await planRows(page)
		.nth(nth)
		.locator("[data-slot=swatch]")
		.evaluate((el) => getComputedStyle(el).backgroundColor);
	const [r, g, b] = (css.match(/\d+/g) ?? []).map(Number);
	return [r ?? 0, g ?? 0, b ?? 0];
}

/**
 * How many pixels of the 2 px tall, `width` px long strip starting at (x, y) are in `color`:
 * enough to tell a dashed line (some) from a solid one (all) and from none.
 */
async function colorPixels(
	page: Page,
	x: number,
	y: number,
	width: number,
	color: [number, number, number],
) {
	const clip = { x: Math.round(x), y: Math.round(y) - 1, width, height: 2 };
	const png = await page.screenshot({ clip });
	const pixels = await page.evaluate(
		async ({ base64, w }) => {
			const blob = await (
				await fetch(`data:image/png;base64,${base64}`)
			).blob();
			const canvas = new OffscreenCanvas(w, 2);
			const context = canvas.getContext("2d");
			if (!context) throw new Error("No 2D context");
			context.drawImage(await createImageBitmap(blob), 0, 0);
			return [...context.getImageData(0, 0, w, 2).data];
		},
		{ base64: png.toString("base64"), w: width },
	);
	let count = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		const rgb = pixels.slice(i, i + 3);
		if (rgb.every((c, j) => Math.abs(c - (color[j] ?? 0)) <= 40)) count++;
	}
	return count;
}

test("shows a crosshair over the map while an align tool is on", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	const canvas = page.locator("canvas.maplibregl-canvas");
	// Over the plan, without a tool, the plan can be dragged.
	await page.mouse.move(plan.cx, plan.cy);
	await expect(canvas).toHaveCSS("cursor", "move");

	for (const name of ["Control points", "Measure", "Rotate"]) {
		await page.getByRole("radio", { name }).click();
		await page.mouse.move(plan.cx + 10, plan.cy);
		await expect(canvas).toHaveCSS("cursor", "crosshair");
		await page.mouse.move(plan.right + 40, plan.cy);
		await expect(canvas).toHaveCSS("cursor", "crosshair");
	}

	await page.getByRole("radio", { name: "Rotate" }).click();
	await expect(canvas).not.toHaveCSS("cursor", "crosshair");
});

test("draws the measure line to the pointer, then between the two spots", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	const color = await planColor(page);
	const toolPixels = (x: number, y: number, width: number) =>
		colorPixels(page, x, y, width, color);
	await page.getByRole("radio", { name: "Measure" }).click();
	const x1 = Math.round(plan.left + 20);
	const y = Math.round(plan.cy);
	await page.mouse.click(x1, y);

	// A dashed line follows the pointer: some of the strip along it is in the marks' colour.
	await page.mouse.move(x1 + 200, y, { steps: 4 });
	await expect.poll(() => toolPixels(x1 + 60, y, 24)).toBeGreaterThan(4);
	await expect.poll(() => toolPixels(x1 + 60, y, 24)).toBeLessThan(40);
	// Pointer moved down: the line turns away from the strip.
	await page.mouse.move(x1 + 200, y + 120, { steps: 4 });
	await expect.poll(() => toolPixels(x1 + 120, y, 24)).toBe(0);

	// The second spot: a solid line joins the two, and stays when the pointer leaves.
	await page.mouse.click(x1 + 200, y);
	await page.mouse.move(plan.cx, plan.bottom - 10, { steps: 4 });
	await expect.poll(() => toolPixels(x1 + 60, y, 24)).toBe(48);
});

test("clears the control points, leaving the plan where they put it", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await page.getByRole("radio", { name: "Control points" }).click();
	const clear = page.getByRole("button", { name: "Clear" });
	await expect(clear).toBeDisabled();
	// The plan's centre, then 60 px to the right: one point moves the whole plan.
	await page.mouse.click(plan.cx, plan.cy);
	await expect(clear).toBeEnabled();
	await page.mouse.click(plan.cx + 60, plan.cy);
	const points = page
		.getByRole("list", { name: "Control points" })
		.getByRole("listitem");
	await expect(points).toHaveCount(1);
	const moved = {
		left: plan.left + 60,
		top: plan.top,
		right: plan.right + 60,
		bottom: plan.bottom,
	};
	await expectPlanAt(page, moved);

	await clear.click();

	await expect(points).toHaveCount(0);
	await expect(clear).toBeDisabled();
	await expectPlanAt(page, moved);
	await untilSaved(page, () =>
		page.getByRole("button", { name: "Done" }).click(),
	);
	await page.reload();
	await expectPlanAt(page, moved);
});

test("draws each plan's frame in its own colour, which can be changed", async ({
	page,
}) => {
	// Two plans, a reload and a screenshot per colour poll: under load (4 workers in
	// SwiftShader) a screenshot can take 5 s and the test about 36 s of the default 30.
	test.slow();
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await page
		.getByLabel("Import a floor plan")
		.setInputFiles(path.join(FILES, "plan.png"));
	await expect(planRows(page)).toHaveCount(2);
	// The second plan, imported on the first, is moved 120 px right.
	await drag(
		page,
		{ x: plan.cx, y: plan.cy },
		{ x: plan.cx + 120, y: plan.cy },
	);
	// The list is top first: the second plan, then the first.
	const first = await planColor(page, 1);
	const second = await planColor(page, 0);
	expect(first).not.toEqual(second);

	// Each left edge is drawn in its plan's colour, and not the other's.
	const y = plan.cy + 40;
	await expect
		.poll(() => colorPixels(page, plan.left - 4, y, 8, first), {
			timeout: 15_000,
		})
		.toBeGreaterThan(0);
	await expect
		.poll(() => colorPixels(page, plan.left + 116, y, 8, second), {
			timeout: 15_000,
		})
		.toBeGreaterThan(0);
	expect(await colorPixels(page, plan.left - 4, y, 8, second)).toBe(0);

	// A colour neither plan has, picked for the first plan from its palette.
	const hex = (c: [number, number, number]) =>
		`#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
	const other = PLAN_COLORS.find(
		(c) => c.value !== hex(first) && c.value !== hex(second),
	);
	if (!other) throw new Error("No free colour");
	// The second plan, moved, is saved before the first one opens in Edit.
	await page.getByRole("button", { name: "Edit plan" }).click();
	await page
		.getByRole("dialog", { name: "Save changes to plan?" })
		.getByRole("button", { name: "Save" })
		.click();
	await page.getByRole("button", { name: "Colour of plan" }).click();
	await page.getByRole("button", { name: other.name, exact: true }).click();
	const picked = await planColor(page, 1);
	expect(hex(picked)).toBe(other.value);
	await expect
		.poll(() => colorPixels(page, plan.left - 4, y, 8, picked), {
			timeout: 15_000,
		})
		.toBeGreaterThan(0);
	await untilSaved(page, () =>
		page.getByRole("button", { name: "Done" }).click(),
	);

	await page.reload();
	await page.getByRole("button", { name: "Floor plans" }).click();
	expect(hex(await planColor(page, 1))).toBe(other.value);
	// The second plan stayed where it was moved.
	await expect
		.poll(() => colorPixels(page, plan.left + 116, y, 8, second), {
			timeout: 15_000,
		})
		.toBeGreaterThan(0);
	await expect
		.poll(() => colorPixels(page, plan.left - 4, y, 8, picked), {
			timeout: 15_000,
		})
		.toBeGreaterThan(0);
});

test("leaves a locked plan in place: dragging it pans the map", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await page.getByRole("button", { name: "Done" }).click();
	await expect(page.getByRole("button", { name: "Edit plan" })).toBeVisible();
	const before = await camera(page);

	await drag(
		page,
		{ x: plan.cx, y: plan.cy },
		{ x: plan.cx + 100, y: plan.cy + 50 },
	);

	// The map moved under the pointer, the plan with it.
	await expect.poll(async () => (await camera(page)).lon).not.toBe(before.lon);
	await expect.poll(async () => (await camera(page)).lat).not.toBe(before.lat);
});

test("puts a plan back as it was when Edit was pressed on Cancel", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	await page.getByRole("button", { name: "Done" }).click();
	await page.getByRole("button", { name: "Edit plan" }).click();

	await drag(
		page,
		{ x: plan.cx, y: plan.cy },
		{ x: plan.cx + 100, y: plan.cy + 50 },
	);
	await expectPlanAt(page, {
		left: plan.left + 100,
		top: plan.top + 50,
		right: plan.right + 100,
		bottom: plan.bottom + 50,
	});
	await page.getByRole("button", { name: "Cancel" }).click();

	await expectPlanAt(page, plan);
	await expect(page.getByRole("button", { name: "Edit plan" })).toBeVisible();
	await page.reload();
	await expectPlanAt(page, plan);
});

test("asks to save or discard a plan's changes when closing floor plans", async ({
	page,
}) => {
	// Three rounds (keep editing, discard, save and reload) while the worker still encodes the
	// imported plan's tiles: 22–27 s of the default 30 under SwiftShader, so it timed out.
	test.slow();
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	const moved = {
		left: plan.left + 100,
		top: plan.top + 50,
		right: plan.right + 100,
		bottom: plan.bottom + 50,
	};
	const panel = page.getByRole("complementary", {
		name: "Floor plan editor",
	});
	const question = page.getByRole("dialog", { name: "Save changes to plan?" });
	await drag(
		page,
		{ x: plan.cx, y: plan.cy },
		{ x: plan.cx + 100, y: plan.cy + 50 },
	);

	// Keep editing: nothing changes.
	await page.getByRole("button", { name: "Close" }).click();
	await question.getByRole("button", { name: "Keep editing" }).click();
	await expect(question).toBeHidden();
	await expect(panel).toBeVisible();
	await expectPlanAt(page, moved);

	// Discard: the plan goes back to where it was imported.
	await page.getByRole("button", { name: "Close" }).click();
	await question.getByRole("button", { name: "Discard" }).click();
	await expect(panel).toBeHidden();
	await expectPlanAt(page, plan);

	// Save: the move survives a reload.
	await page.getByRole("button", { name: "Floor plans" }).click();
	await page.getByRole("button", { name: "Edit plan" }).click();
	await drag(
		page,
		{ x: plan.cx, y: plan.cy },
		{ x: plan.cx + 100, y: plan.cy + 50 },
	);
	await page.keyboard.press("Escape");
	await untilSaved(page, () =>
		question.getByRole("button", { name: "Save" }).click(),
	);
	await expect(panel).toBeHidden();
	await page.reload();
	await expectPlanAt(page, moved);
});

test("draws the layers in the list's order, changed by dragging or Alt+arrows", async ({
	page,
}) => {
	await serveOsm(page, mall());
	await importPlan(page, "plan.png");
	await page.getByRole("button", { name: "Done" }).click();
	await page
		.getByLabel("Import a floor plan")
		.setInputFiles(path.join(FILES, "plan.svg"));
	await page.getByRole("button", { name: "Done" }).click();
	await expect(page.getByTestId("load-status")).toBeHidden();
	// The two plans lie on each other; the mall's outline runs ~298 px right of the map
	// centre, under both of them.
	const { cx, cy, mx } = await initialLayout(page, 300);
	const GREEN: [number, number, number] = [0, 255, 0];
	const greenOnRed = blend(GREEN, 0.5, blend(RED, 0.5, BACKGROUND));
	const redOnGreen = blend(RED, 0.5, blend(GREEN, 0.5, BACKGROUND));
	await expectPixel(page, cx, cy, greenOnRed);
	// The buildings start on top.
	await expectPixel(page, mx + 298, cy, BUILDING_OUTLINE, 40);
	await expect(
		page.getByRole("list", { name: "Layers" }).getByRole("listitem").first(),
	).toContainText("Buildings");

	// The red plan's row (second plan row) dragged above the green one's: red on top.
	const [green, red] = [planRows(page).nth(0), planRows(page).nth(1)];
	await expect(red).toContainText("400 × 300 px");
	await red
		.getByRole("button", { name: "Move plan", exact: true })
		.dragTo(green, { targetPosition: { x: 60, y: 3 } });
	await expect(planRows(page).nth(0)).toContainText("400 × 300 px");
	await expectPixel(page, cx, cy, redOnGreen);

	// Alt+↓ on the red plan's grip: back under the green one.
	await planRows(page)
		.nth(0)
		.getByRole("button", { name: "Move plan", exact: true })
		.press("Alt+ArrowDown");
	await expect(planRows(page).nth(1)).toContainText("400 × 300 px");
	await expectPixel(page, cx, cy, greenOnRed);

	// The buildings moved to the bottom: both plans are drawn over the outline.
	const buildings = page.getByRole("button", { name: "Move buildings" });
	await buildings.press("Alt+ArrowDown");
	await buildings.press("Alt+ArrowDown");
	await expect(
		page.getByRole("list", { name: "Layers" }).getByRole("listitem").last(),
	).toContainText("Buildings");
	await expectPixel(
		page,
		mx + 298,
		cy,
		blend(GREEN, 0.5, blend(RED, 0.5, BUILDING_OUTLINE)),
		12,
	);

	// Hidden: only the plans are left.
	await page.getByRole("button", { name: "Show buildings" }).click();
	await expectPixel(page, mx + 298, cy, greenOnRed);
});

test("shows the map's grab cursor over plans when none is in Edit", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const plan = await importedPlanBox(page);
	const canvas = page.locator("canvas.maplibregl-canvas");
	await page.mouse.move(plan.cx, plan.cy);
	await expect(canvas).toHaveCSS("cursor", "move");

	// Done, without moving the pointer, then moving it over the locked plan.
	await page.getByRole("button", { name: "Done" }).click();
	await expect(canvas).toHaveCSS("cursor", "grab");
	await page.mouse.move(plan.cx + 20, plan.cy + 10);
	await expect(canvas).toHaveCSS("cursor", "grab");

	// Back in Edit, the plan can be moved again; out of floor plan mode, the map's cursor.
	await page.getByRole("button", { name: "Edit plan" }).click();
	await page.mouse.move(plan.cx, plan.cy);
	await expect(canvas).toHaveCSS("cursor", "move");
	await page.getByRole("button", { name: "Close" }).click();
	await page.mouse.move(plan.cx + 20, plan.cy);
	await expect(canvas).toHaveCSS("cursor", "grab");
});

test("switches the map to a plan's level when its row is clicked", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const level = page.getByRole("textbox", { name: "Level", exact: true });
	await level.fill("2");
	await level.press("Enter");
	await page.getByRole("button", { name: "Done" }).click();
	await expect(page.getByTestId("level")).toHaveText("0");

	await planRows(page).getByRole("button", { name: /^plan/ }).click();
	await expect(page.getByTestId("level")).toHaveText("2");
	const { cx, cy } = await initialLayout(page, 300);
	await expectPixel(page, cx, cy, blend(RED, 0.5, BACKGROUND));

	// On several levels: stays on one of them, else goes to the lowest.
	await page.getByRole("button", { name: "Edit plan" }).click();
	await level.fill("1-3");
	await level.press("Enter");
	await page.getByRole("button", { name: "Done" }).click();
	await planRows(page).getByRole("button", { name: /^plan/ }).click();
	await expect(page.getByTestId("level")).toHaveText("2");
	await page.getByRole("button", { name: "Level down" }).click();
	await page.getByRole("button", { name: "Level down" }).click();
	await expect(page.getByTestId("level")).toHaveText("0");
	await planRows(page).getByRole("button", { name: /^plan/ }).click();
	await expect(page.getByTestId("level")).toHaveText("1");
});

test("renames a plan in its row: Done keeps the name, Cancel drops it", async ({
	page,
}) => {
	await importPlan(page, "plan.png");
	const name = page.getByRole("textbox", { name: "Name" });
	await name.fill("Ground floor");
	await name.press("Enter");
	await expect(
		page.getByRole("region", { name: "Editing Ground floor" }),
	).toBeVisible();
	await untilSaved(page, () =>
		page.getByRole("button", { name: "Done" }).click(),
	);
	await expect(planRows(page)).toContainText(["Ground floor"]);

	await page.getByRole("button", { name: "Edit Ground floor" }).click();
	await name.fill("Basement");
	await name.press("Enter");
	await page.getByRole("button", { name: "Cancel" }).click();
	await expect(planRows(page)).toContainText(["Ground floor"]);

	await page.reload();
	await page.getByRole("button", { name: "Floor plans" }).click();
	await expect(planRows(page)).toContainText(["Ground floor"]);
});

test("shows each plan's level in its row", async ({ page }) => {
	await importPlan(page, "plan.png");
	await page.getByRole("button", { name: "Done" }).click();
	await expect(planRows(page).first()).toContainText("Level 0");

	await page.getByRole("button", { name: "Edit plan" }).click();
	const level = page.getByRole("textbox", { name: "Level", exact: true });
	await level.fill("");
	await level.press("Enter");
	await expect(planRows(page).first()).toContainText("Level All");
});

test("asks before removing a plan", async ({ page }) => {
	await importPlan(page, "plan.png");
	await page.getByRole("button", { name: "Done" }).click();
	const { cx, cy } = await initialLayout(page, 300);
	const question = page.getByRole("alertdialog", { name: "Remove plan?" });

	await page.getByRole("button", { name: "Remove plan" }).click();
	await question.getByRole("button", { name: "Cancel" }).click();
	await expect(question).toBeHidden();
	await expect(planRows(page)).toHaveCount(1);
	await expectPixel(page, cx, cy, blend(RED, 0.5, BACKGROUND));

	await page.getByRole("button", { name: "Remove plan" }).click();
	await question.getByRole("button", { name: "Remove" }).click();
	await expect(planRows(page)).toHaveCount(0);
	await expectPixel(page, cx, cy, BACKGROUND);
});

test("assigns a plan to the building under it, and moves it by metres", async ({
	page,
}) => {
	await serveOsm(page, mall());
	await importPlan(page, "plan.png");
	await expect(page.getByTestId("load-status")).toBeHidden();

	const building = page.getByRole("group", { name: "Building" });
	await building.getByRole("radio", { name: "Mall" }).check();

	const longitude = page.getByRole("spinbutton", { name: "Longitude" });
	const latitude = page.getByRole("spinbutton", { name: "Latitude" });
	const before = [
		Number(await longitude.inputValue()),
		Number(await latitude.inputValue()),
	] as const;
	await page.getByRole("spinbutton", { name: "East (m)" }).fill("10");
	await page.getByRole("spinbutton", { name: "North (m)" }).fill("-5");
	await page.getByRole("button", { name: "Move", exact: true }).click();
	// 10 m east and 5 m south of where it was, at Rennes' latitude.
	const metresPerDegree = 111_320;
	await expect
		.poll(async () => {
			const lon = Number(await longitude.inputValue());
			const lat = Number(await latitude.inputValue());
			return [
				Math.round(
					(lon - before[0]) *
						metresPerDegree *
						Math.cos((before[1] * Math.PI) / 180),
				),
				Math.round((lat - before[1]) * metresPerDegree),
			];
		})
		.toEqual([10, -5]);

	await page.getByRole("button", { name: "Done" }).click();
	await expect(planRows(page).first()).toContainText("Mall ·");
});
