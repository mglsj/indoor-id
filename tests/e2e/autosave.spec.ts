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

/** How many tabs have edits saved in this browser. */
function savedTabs(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			new Promise<number>((resolve, reject) => {
				const open = indexedDB.open("indoorid-edits");
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					if (!db.objectStoreNames.contains("edits")) return resolve(0);
					const count = db.transaction("edits").objectStore("edits").count();
					count.onsuccess = () => {
						resolve(count.result);
						db.close();
					};
				};
			}),
	);
}

test("edits come back after a reload, to undo as before", async ({ page }) => {
	await openRoom(page);
	await addPoint(page);

	await page.reload();
	const dialog = page.getByRole("alertdialog", RESTORE);
	await expect(dialog).toContainText("1 features changed");
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

	// A minute later for the new tab: the first one's last heartbeat is long gone.
	const other = await context.newPage();
	await other.clock.setFixedTime(Date.now() + 60_000);
	await blockExternal(other);
	await openRoom(other);

	const dialog = other.getByRole("alertdialog", RESTORE);
	await dialog.getByRole("button", { name: "Restore" }).click();
	await expect(other.getByTestId("edit-count")).toHaveText("1");
});
