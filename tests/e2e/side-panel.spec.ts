import type { Locator, Page } from "@playwright/test";
import { expect, selectRoom, test } from "./fixtures.ts";

const handle = (page: Page) =>
	page.getByRole("separator", { name: "Resize the side panel" });

async function width(locator: Locator): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error("Not shown");
	return Math.round(box.width);
}

/** Drags the side panel's edge `dx` pixels to the right. */
async function dragEdge(page: Page, dx: number) {
	const box = await handle(page).boundingBox();
	if (!box) throw new Error("No handle");
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx / 2, y);
	await page.mouse.move(x + dx, y);
	await page.mouse.up();
}

test("the side panel is resized by dragging its edge, and keeps its width", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	expect(await width(editor)).toBe(352);
	const history = page.getByRole("group", { name: "Edit history" });
	expect((await history.boundingBox())?.x).toBe(352 + 16);

	await dragEdge(page, 150);
	expect(await width(editor)).toBe(502);
	await expect(handle(page)).toHaveAttribute("aria-valuenow", "502");
	// The map controls move along, beside the panel.
	expect((await history.boundingBox())?.x).toBe(502 + 16);

	// The floor plan editor opens at the same width.
	await page.getByRole("button", { name: "Floor plans" }).click();
	const plans = page.getByRole("complementary", { name: "Floor plan editor" });
	await expect(plans).toBeVisible();
	expect(await width(plans)).toBe(502);

	// And the width is kept after a reload.
	await plans.getByRole("button", { name: "Close" }).click();
	await page.reload();
	const again = await selectRoom(page);
	expect(await width(again)).toBe(502);
});

test("the side panel takes at most 60% of the window, and at least 280 px", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	const viewport = page.viewportSize();
	if (!viewport) throw new Error("No viewport");
	await dragEdge(page, 2000);
	expect(await width(editor)).toBe(Math.round(viewport.width * 0.6));
	await dragEdge(page, -2000);
	expect(await width(editor)).toBe(280);
});

test("the side panel's edge moves with the keyboard, and a double click resets it", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	const edge = handle(page);
	await edge.focus();
	await page.keyboard.press("ArrowRight");
	await expect(edge).toHaveAttribute("aria-valuenow", "368");
	expect(await width(editor)).toBe(368);
	await page.keyboard.press("Home");
	await expect(edge).toHaveAttribute("aria-valuenow", "280");
	await page.keyboard.press("End");
	await expect(edge).toHaveAttribute(
		"aria-valuenow",
		await edge.getAttribute("aria-valuemax").then(String),
	);
	await edge.dblclick();
	expect(await width(editor)).toBe(352);
});
