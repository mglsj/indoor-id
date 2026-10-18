import type { Page } from "@playwright/test";
import {
	expect,
	inspector,
	LAT,
	LON,
	mapCenter,
	room,
	selectRoom,
	test,
} from "./fixtures.ts";

/** The name as the tag table shows it (the graph's value). */
async function nameTag(page: Page) {
	const table = await inspector(page).tags();
	return table.getByRole("combobox", { name: "Value of name" });
}

test("a name is applied while it is typed, and one Undo takes the whole edit back", async ({
	page,
}) => {
	const editor = await selectRoom(page, { name: "Library" });
	const tag = await nameTag(page);
	const name = editor.getByRole("textbox", { name: "Name", exact: true });
	await name.click();
	await name.press("ControlOrMeta+a");
	await name.pressSequentially("Archive ");
	// Applied before leaving the field, as typed.
	await expect(tag).toHaveValue("Archive ");
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await expect(name).toBeFocused();

	// Leaving the field trims it, in the same step.
	await name.press("Tab");
	await expect(tag).toHaveValue("Archive");
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(name).toHaveValue("Library");
	await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("a description is applied while it is typed too", async ({ page }) => {
	const editor = await selectRoom(page, { description: "Old" });
	const description = editor.getByRole("textbox", {
		name: "Description",
		exact: true,
	});
	await description.click();
	await description.press("End");
	await description.pressSequentially(" books");
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await expect(description).toBeFocused();
});

test("selecting another feature while typing keeps the edit on the first one", async ({
	page,
}) => {
	// A second room 0.0005° (~370 px at zoom 19) east.
	const editor = await selectRoom(page, {}, [
		...room(200, LON + 0.0005, LAT, "0"),
		...room(100, LON, LAT, "0"),
	]);
	await expect(editor.getByText("w100", { exact: true })).toBeVisible();
	const name = editor.getByRole("textbox", { name: "Name", exact: true });
	await name.click();
	await name.pressSequentially("Reading room");
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x + 370, y);
	await expect(editor.getByText("w200", { exact: true })).toBeVisible();
	await expect(name).toHaveValue("");
	await expect(page.getByTestId("edit-count")).toHaveText("1");

	await page.mouse.click(x, y);
	await expect(editor.getByText("w100", { exact: true })).toBeVisible();
	await expect(name).toHaveValue("Reading room");
	// One step for the whole name.
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(name).toHaveValue("");
	await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("an address part is applied while it is typed, and text typed back as it was makes no edit", async ({
	page,
}) => {
	const editor = await selectRoom(page, { amenity: "cafe" });
	const number = editor.getByRole("combobox", { name: "Address" });
	await number.click();
	await number.pressSequentially("12");
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await expect(number).toBeFocused();
	await number.press("Backspace");
	await number.press("Backspace");
	await number.press("Tab");
	await expect(page.getByTestId("edit-count")).toHaveText("0");

	// The next edit is a step of its own.
	const name = editor.getByRole("textbox", { name: "Name", exact: true });
	await name.fill("Café");
	await name.press("Tab");
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(name).toHaveValue("");
	await expect(number).toHaveValue("");
	await expect(page.getByTestId("edit-count")).toHaveText("0");
});

test("each keystroke is applied at once, as iD", async ({ page }) => {
	const editor = await selectRoom(page);
	const name = editor.getByRole("textbox", { name: "Name", exact: true });
	await name.click();
	// No timer runs from here: nothing waits for a pause in typing.
	await page.clock.install();
	await page.clock.pauseAt(Date.now() + 60_000);
	await name.press("A");
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await expect(await nameTag(page)).toHaveValue("A");
});

test("an address keeps its completion while each keystroke is applied", async ({
	page,
}) => {
	const street = [
		{ type: "node", id: 1, lon: LON - 0.001, lat: LAT + 0.0005, version: 1 },
		{ type: "node", id: 2, lon: LON + 0.001, lat: LAT + 0.0005, version: 1 },
		{
			type: "way",
			id: 3,
			version: 1,
			nodes: [1, 2],
			tags: { highway: "residential", name: "Rue de la Gare" },
		},
	];
	const editor = await selectRoom(page, { amenity: "cafe" }, [
		...street,
		...room(100, LON, LAT, "0"),
	]);
	const streetInput = editor.getByRole("combobox", { name: "Street" });
	await streetInput.click();
	await streetInput.pressSequentially("Rue");
	await expect(streetInput).toHaveValue("Rue de la Gare");
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await streetInput.press("Enter");
	await expect(streetInput).toHaveValue("Rue de la Gare");
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(streetInput).toHaveValue("");
	await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});
