import { expect, selectRoom, serveWiki, test } from "./fixtures.ts";

test("ⓘ shows the OSM wiki's documentation of a field's key", async ({
	page,
}) => {
	await serveWiki(page, {
		"Key:room": "The function of a room, with key:indoor.",
	});
	const editor = await selectRoom(page);
	const info = editor.getByRole("button", { name: "Documentation of Type" });
	await info.click();
	await expect(info).toHaveAttribute("aria-expanded", "true");
	await expect(editor).toContainText("The function of a room, with indoor=*.");
	await expect(editor.getByRole("link", { name: "indoor=*" })).toHaveAttribute(
		"href",
		"https://wiki.openstreetmap.org/wiki/Key:indoor",
	);
	await expect(
		editor.getByRole("link", { name: "View documentation" }),
	).toHaveAttribute("href", "https://wiki.openstreetmap.org/wiki/Key:room");

	await info.click();
	await expect(editor).not.toContainText("The function of a room");
});

test("ⓘ documents the feature type, and says when there is nothing", async ({
	page,
}) => {
	await serveWiki(page, {
		"Tag:indoor=room": "An enclosed area inside a building.",
	});
	const editor = await selectRoom(page);
	await editor
		.getByRole("button", { name: "Documentation of Room", exact: true })
		.click();
	await expect(editor).toContainText("An enclosed area inside a building.");

	await editor
		.getByRole("button", { name: "Documentation of Room Number" })
		.click();
	await expect(editor).toContainText("There is no documentation available.");
});

test("each feature type of the list has its ⓘ", async ({ page }) => {
	await serveWiki(page, {
		"Tag:indoor=corridor": "A room to walk from one room to another.",
	});
	const editor = await selectRoom(page);
	await editor.getByRole("button", { name: /change feature type/ }).click();
	await editor
		.getByRole("button", { name: "Documentation of Indoor Corridor" })
		.click();
	await expect(editor).toContainText(
		"A room to walk from one room to another.",
	);
	// The option is still named by its type alone, and still chooses it.
	await editor
		.getByRole("option", { name: "Indoor Corridor", exact: true })
		.click();
	await expect(
		editor.getByRole("button", {
			name: "Indoor Corridor, change feature type",
		}),
	).toBeVisible();
});
