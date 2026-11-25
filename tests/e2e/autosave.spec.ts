import type { Page } from "@playwright/test";
import {
	blockExternal,
	camera,
	expect,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	room,
	savedTabs,
	serveOsm,
	test,
} from "./fixtures.ts";

const RESTORE = { name: "Restore your unsaved edits?" };

/** Opens the editor on a room, at zoom 19. */
async function openRoom(page: Page) {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0`);
	await camera(page);
	await mapDrawn(page);
}

/** Puts a point in the middle of the room, then waits until it is autosaved. */
async function addPoint(page: Page) {
	const { x, y } = await mapCenter(page);
	await page.getByRole("button", { name: "Draw point" }).click();
	await page.mouse.click(x, y);
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await expect.poll(() => savedTabs(page)).toBe(1);
}

test("edits come back after a reload, to undo as before", async ({ page }) => {
	await openRoom(page);
	await addPoint(page);

	await page.reload();
	const dialog = page.getByRole("alertdialog", RESTORE);
	await expect(dialog).toContainText("1 feature changed");
	await dialog.getByRole("button", { name: "Restore" }).click();

	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("0");
});

test("discarded edits aren't offered again", async ({ page }) => {
	await openRoom(page);
	await addPoint(page);

	await page.reload();
	const dialog = page.getByRole("alertdialog", RESTORE);
	await dialog.getByRole("button", { name: "Discard" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("edit-count")).toHaveText("0");
	await expect.poll(() => savedTabs(page)).toBe(0);

	await page.reload();
	await mapDrawn(page);
	await expect(dialog).toBeHidden();
});

test("a second tab isn't offered the edits of a tab still open", async ({
	page,
	context,
}) => {
	await openRoom(page);
	await addPoint(page);

	const other = await context.newPage();
	await blockExternal(other);
	await openRoom(other);

	await expect(other.getByRole("alertdialog", RESTORE)).toBeHidden();
	await expect(other.getByTestId("edit-count")).toHaveText("0");
});

test("a tab silent for 20 s has closed: a new tab is offered its edits", async ({
	page,
	context,
}) => {
	await openRoom(page);
	await addPoint(page);

	// The first tab closes and its last heartbeat is long gone. (Faking the new tab's clock
	// instead stalled its start for seconds on CI runners.)
	await page.close();
	const other = await context.newPage();
	await other.addInitScript(() => {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith("indoorid:beat:")) localStorage.setItem(key, "0");
		}
	});
	await blockExternal(other);
	await openRoom(other);

	const dialog = other.getByRole("alertdialog", RESTORE);
	await dialog.getByRole("button", { name: "Restore" }).click();
	await expect(other.getByTestId("edit-count")).toHaveText("1");
});
