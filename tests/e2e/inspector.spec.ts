import type { Locator } from "@playwright/test";
import {
	expect,
	LAT,
	LON,
	room,
	selectRoom,
	tagsBox,
	test,
} from "./fixtures.ts";

/** The Feature Type button, showing the type of the selected feature. */
function featureType(editor: Locator, name: string) {
	return editor.getByRole("button", {
		name: `${name}, change feature type`,
		exact: true,
	});
}

test("selecting a room shows its type and fields", async ({ page }) => {
	const editor = await selectRoom(page);
	await expect(featureType(editor, "Room")).toBeVisible();
	await expect(editor.getByLabel("Level", { exact: true })).toHaveValue("0");
	await expect(await tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
});

test("editing a field changes the tags, and undo/redo revert it", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	const roomNumber = editor.getByRole("textbox", { name: "Room Number" });
	await roomNumber.fill("B12");
	await roomNumber.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nref=B12",
	);

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(await tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
	await expect(roomNumber).toHaveValue("");

	await page.getByRole("button", { name: "Redo" }).click();
	await expect(roomNumber).toHaveValue("B12");
});

test("Ctrl+Z undoes the last edit when not typing", async ({ page }) => {
	const editor = await selectRoom(page);
	const roomNumber = editor.getByRole("textbox", { name: "Room Number" });
	await roomNumber.fill("B12");
	await roomNumber.press("Enter");
	await editor.getByRole("heading", { name: "Edit feature" }).click();
	await page.keyboard.press("Control+z");
	await expect(roomNumber).toHaveValue("");
});

test("changing the type keeps the other tags", async ({ page }) => {
	const editor = await selectRoom(page, { ref: "S1" });
	await editor.getByRole("button", { name: /change feature type/i }).click();
	await page
		.getByRole("combobox", { name: "Search feature types" })
		.fill("stairwell");
	await editor.getByRole("option", { name: "Indoor Stairwell" }).click();

	await expect(featureType(editor, "Indoor Stairwell")).toBeVisible();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nref=S1\nstairs=yes",
	);
});

test("Enter chooses the first feature type found", async ({ page }) => {
	const editor = await selectRoom(page);
	await featureType(editor, "Room").click();
	const search = page.getByRole("combobox", { name: "Search feature types" });
	await search.fill("stairwell");
	await search.press("Enter");
	await expect(featureType(editor, "Indoor Stairwell")).toBeVisible();
});

test("lists the indoor types first, and the last types chosen above them", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	await featureType(editor, "Room").click();
	const options = editor.getByRole("option");
	await expect(options.first()).toHaveText("Room");
	await expect(options.nth(1)).toHaveText("Indoor Corridor");
	// The feature's type is marked.
	await expect(options.first()).toHaveAttribute("aria-current", "true");

	await page
		.getByRole("combobox", { name: "Search feature types" })
		.fill("cafe");
	await editor.getByRole("option", { name: "Cafe", exact: true }).click();
	await expect(featureType(editor, "Cafe")).toBeVisible();

	// Remembered across visits, for areas.
	await page.reload();
	const again = await selectRoom(page);
	await featureType(again, "Room").click();
	await expect(again.getByRole("option").first()).toHaveText("Cafe");
	await expect(again.getByRole("option").nth(1)).toHaveText("Room");
});

test("categories open in place, with the mouse or the arrow keys", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	await featureType(editor, "Room").click();
	const category = editor.getByRole("option", { name: "Building Features" });
	const house = editor.getByRole("option", { name: "House", exact: true });
	await expect(house).toBeHidden();

	await category.click();
	await expect(house).toBeVisible();
	await category.click();
	await expect(house).toBeHidden();

	// Down to the category, → opens it, ↓ to its first member, ← back and closed.
	const search = page.getByRole("combobox", { name: "Search feature types" });
	const names = await editor.getByRole("option").allTextContents();
	for (let i = 0; i < names.indexOf("Building Features"); i++) {
		await search.press("ArrowDown");
	}
	await expect(category).toHaveAttribute("aria-selected", "true");
	await search.press("ArrowRight");
	await expect(category).toHaveAttribute("aria-expanded", "true");
	await search.press("ArrowDown");
	await expect(
		editor.getByRole("option", { name: "Building", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await search.press("ArrowLeft");
	await expect(category).toHaveAttribute("aria-selected", "true");
	await expect(house).toBeHidden();

	await search.press("ArrowRight");
	await house.click();
	await expect(featureType(editor, "House")).toBeVisible();
	await expect(await tagsBox(page)).toHaveValue("building=house\nlevel=0");
});

test("the raw tag editor edits every tag", async ({ page }) => {
	const editor = await selectRoom(page);
	await (await tagsBox(page)).fill("indoor=room\nlevel=0\nname=Library");
	await (await tagsBox(page)).blur();
	await expect(editor.getByRole("textbox", { name: "Name" })).toHaveValue(
		"Library",
	);
});

test("Escape and clicking elsewhere close the editor", async ({ page }) => {
	const editor = await selectRoom(page);
	await page.keyboard.press("Escape");
	await expect(editor).toBeHidden();

	await selectRoom(page);
	const box = await page.getByTestId("map").boundingBox();
	if (!box) throw new Error("No map");
	// An empty spot, clear of the editor on the left.
	await page.mouse.click(box.x + box.width - 80, box.y + box.height - 60);
	await expect(editor).toBeHidden();
});

test("fixes outdated tags in one click, and the fix can be undone", async ({
	page,
}) => {
	const editor = await selectRoom(page, { room: "stairs" });
	const issues = editor.getByRole("region", { name: "Issues" });
	await expect(issues).toContainText("Outdated tags: room=stairs");

	await issues.getByRole("button", { name: "Upgrade to stairs=yes" }).click();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nstairs=yes",
	);
	await expect(featureType(editor, "Indoor Stairwell")).toBeVisible();
	await expect(issues).toBeHidden();

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nroom=stairs",
	);
});

test("flags a level value it can't read", async ({ page }) => {
	const editor = await selectRoom(page);
	const level = editor.getByLabel("Level", { exact: true });
	await level.fill("1,5");
	await level.press("Enter");
	await expect(editor.getByRole("region", { name: "Issues" })).toContainText(
		"level=1,5 can't be read",
	);
});

test("lays the editor out in iD's sections", async ({ page }) => {
	const elements = room(100, LON, LAT, "0");
	Object.assign(elements.at(-1) as object, {
		user: "Alice",
		timestamp: "2020-01-15T10:00:00Z",
	});
	const editor = await selectRoom(page, {}, elements);
	await expect(
		editor.getByRole("heading", { name: "Edit feature" }),
	).toBeVisible();
	// Feature Type and Fields open, Tags (2) closed until asked for.
	for (const [name, open] of [
		["Feature Type", "true"],
		["Fields", "true"],
		["Tags (2)", "false"],
	] as const) {
		await expect(
			editor.getByRole("button", { name, exact: true }),
		).toHaveAttribute("aria-expanded", open);
	}
	await expect(
		editor.getByRole("button", { name: /^Room.*change feature type/i }),
	).toBeVisible();
	await expect(
		editor.getByRole("textbox", { name: "Tags", exact: true }),
	).toBeHidden();

	// The footer links to the feature on openstreetmap.org.
	const link = editor.getByRole("link", { name: "View on openstreetmap.org" });
	await expect(link).toHaveAttribute(
		"href",
		"https://www.openstreetmap.org/way/100",
	);
	await expect(editor).toContainText(/Last edited \d+ years ago by Alice/);
});

test("remembers which sections are open", async ({ page }) => {
	const editor = await selectRoom(page);
	const tags = editor.getByRole("button", { name: "Tags (2)", exact: true });
	const fields = editor.getByRole("button", { name: "Fields", exact: true });
	await tags.click();
	await fields.click();
	await expect(tags).toHaveAttribute("aria-expanded", "true");
	await expect(fields).toHaveAttribute("aria-expanded", "false");

	await page.keyboard.press("Escape");
	await expect(editor).toBeHidden();
	await page.reload();
	const again = await selectRoom(page);
	await expect(
		again.getByRole("button", { name: "Tags (2)", exact: true }),
	).toHaveAttribute("aria-expanded", "true");
	await expect(
		again.getByRole("button", { name: "Fields", exact: true }),
	).toHaveAttribute("aria-expanded", "false");
});

test("opens the tags of a feature without a matching type", async ({
	page,
}) => {
	const elements = room(100, LON, LAT, "0");
	const way = elements.at(-1) as { tags: Record<string, string> };
	way.tags = { area: "yes", level: "0", survey_note: "check" };
	const editor = await selectRoom(page, {}, elements);
	await expect(
		editor.getByRole("button", { name: "Tags (3)", exact: true }),
	).toHaveAttribute("aria-expanded", "true");
});

test("shows a ✓ to close the editor once the feature was changed", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	await expect(editor.getByRole("button", { name: "Close" })).toBeVisible();
	await editor.getByRole("textbox", { name: "Name" }).fill("Library");
	await editor.getByRole("textbox", { name: "Name" }).press("Enter");
	await expect(editor.getByRole("button", { name: "Done" })).toBeVisible();
});

test("Add field adds a field, ready to type in", async ({ page }) => {
	const editor = await selectRoom(page);
	await editor.getByRole("button", { name: "Add field" }).click();
	await page.getByRole("combobox", { name: "Search fields" }).fill("descr");
	await page.getByRole("option", { name: "Description" }).click();
	const description = editor.getByRole("textbox", { name: "Description" });
	await expect(description).toBeFocused();
	await description.fill("Reading room");
	await description.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"description=Reading room\nindoor=room\nlevel=0",
	);
});

test("Remove clears all the field's keys, in one undo step", async ({
	page,
}) => {
	const editor = await selectRoom(page, { name: "Lab", "name:fr": "Labo" });
	await editor.getByRole("button", { name: "Remove Name" }).click();
	await expect(await tagsBox(page)).toHaveValue("indoor=room\nlevel=0");
	await expect(editor.getByRole("textbox", { name: "Name" })).toHaveValue("");

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nname=Lab\nname:fr=Labo",
	);
});

test("Revert brings back the downloaded value", async ({ page }) => {
	const editor = await selectRoom(page, { name: "Lab" });
	const revert = editor.getByRole("button", { name: "Revert Name" });
	await expect(revert).toBeHidden();
	const name = editor.getByRole("textbox", { name: "Name" });
	await name.fill("Library");
	await name.press("Enter");

	await revert.click();
	await expect(name).toHaveValue("Lab");
	await expect(revert).toBeHidden();
});

test("a field waits for the tag it needs: Alternative Name for a name", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	const addField = editor.getByRole("button", { name: "Add field" });
	const search = page.getByRole("combobox", { name: "Search fields" });
	const alternative = page.getByRole("option", { name: "Alternative Name" });
	await addField.click();
	await search.fill("alternative");
	await expect(alternative).toBeHidden();
	await search.press("Escape");
	await expect(search).toBeHidden();

	const name = editor.getByRole("textbox", { name: "Name" });
	await name.fill("Lab");
	await name.press("Enter");
	await addField.click();
	await search.fill("alternative");
	await expect(alternative).toBeVisible();
});

test("the name of a feature linked to Wikidata is locked, as in iD", async ({
	page,
}) => {
	const editor = await selectRoom(page, { name: "Louvre", wikidata: "Q19675" });
	await expect(editor.getByRole("textbox", { name: "Name" })).toHaveAttribute(
		"readonly",
	);
	await expect(editor.getByRole("img", { name: /Name.*locked/ })).toBeVisible();
	await expect(
		editor.getByRole("button", { name: "Remove Name" }),
	).toBeHidden();
	// Other fields stay editable.
	await expect(
		editor.getByRole("button", { name: "Remove Level" }),
	).toBeVisible();
});

test("the Escape that closes a popover keeps the selection", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	await page.getByRole("button", { name: "Background" }).click();
	const picker = page.getByRole("group", { name: "Background imagery" });
	await expect(picker).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(picker).toBeHidden();
	await expect(editor).toBeVisible();
});

test("undo doesn't work behind the Save dialog", async ({ page }) => {
	const editor = await selectRoom(page);
	const roomNumber = editor.getByRole("textbox", { name: "Room Number" });
	await roomNumber.fill("B12");
	await roomNumber.press("Enter");
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await page.getByRole("button", { name: /Save/ }).click();
	const dialog = page.getByRole("dialog", { name: "Upload your edits" });
	await dialog.getByRole("button", { name: "Cancel" }).focus();
	await page.keyboard.press("ControlOrMeta+z");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
});
