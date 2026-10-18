import {
	expect,
	inspector,
	selectRoom,
	serveTaginfo,
	serveWiki,
	tagsBox,
	test,
} from "./fixtures.ts";

const openTags = (page: import("@playwright/test").Page) =>
	inspector(page).tags();

test("tags are a table, sorted, with a row to add one", async ({ page }) => {
	await selectRoom(page, { name: "Library" });
	const table = await openTags(page);
	await expect(table.getByRole("combobox")).toHaveCount(8);
	await expect(table.getByRole("combobox", { name: "Key indoor" })).toHaveValue(
		"indoor",
	);
	await expect(
		table.getByRole("combobox", { name: "Value of name" }),
	).toHaveValue("Library");
	await expect(
		table.getByRole("combobox", { name: "New tag key" }),
	).toHaveAttribute("placeholder", "Add new tag");
});

test("a tag is added with = from key to value, and Enter goes to the next row", async ({
	page,
}) => {
	await selectRoom(page);
	const table = await openTags(page);
	const key = table.getByRole("combobox", { name: "New tag key" });
	await key.pressSequentially("ref");
	await key.press("=");
	const value = table.getByRole("combobox", { name: "Value of ref" });
	await expect(value).toBeFocused();
	await value.pressSequentially("B12");
	await value.press("Enter");
	await expect(
		table.getByRole("combobox", { name: "New tag key" }),
	).toBeFocused();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nref=B12",
	);
});

test("a key is renamed with its value; a key already set goes to its row", async ({
	page,
}) => {
	await selectRoom(page, { name: "Library" });
	const table = await openTags(page);
	const name = table.getByRole("combobox", { name: "Key name" });
	await name.fill("official_name");
	await name.press("Enter");
	await expect(
		table.getByRole("combobox", { name: "Value of official_name" }),
	).toHaveValue("Library");

	const indoor = table.getByRole("combobox", { name: "Key indoor" });
	await indoor.fill("level");
	await indoor.press("Tab");
	await expect(indoor).toHaveValue("indoor");
	await expect(
		table.getByRole("combobox", { name: "Value of level" }),
	).toBeFocused();

	await table.getByRole("button", { name: "Remove tag level" }).click();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nofficial_name=Library",
	);
});

test("keys are suggested by taginfo, without those set", async ({ page }) => {
	await serveTaginfo(page, {}, ["level", "level:ref", "levels"]);
	await selectRoom(page);
	const table = await openTags(page);
	const key = table.getByRole("combobox", { name: "New tag key" });
	await key.pressSequentially("lev");
	await expect(page.getByRole("option", { name: "level:ref" })).toBeVisible();
	await expect(
		page.getByRole("option", { name: "level", exact: true }),
	).toBeHidden();
});

test("the text view is remembered", async ({ page }) => {
	await selectRoom(page);
	await tagsBox(page);
	await page.keyboard.press("Escape");
	await page.reload();
	const editor = await selectRoom(page);
	// The section stayed open, and shows the text again.
	await expect(
		editor.getByRole("textbox", { name: "Tags", exact: true }),
	).toBeVisible();
});

test("each tag has its ⓘ", async ({ page }) => {
	await serveWiki(page, {
		"Tag:indoor=room": "An enclosed area inside a building.",
	});
	await selectRoom(page);
	const table = await openTags(page);
	await table
		.getByRole("button", { name: "Documentation of indoor=room" })
		.click();
	await expect(table).toContainText("An enclosed area inside a building.");
});
