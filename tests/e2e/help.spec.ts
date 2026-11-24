import { camera, expect, test } from "./fixtures.ts";

test("? lists the shortcuts, operations included, and links to the help (P6)", async ({
	page,
}) => {
	await page.goto("/#19/48.85/2.35/0");
	await camera(page);
	await page.locator(".maplibregl-canvas").focus();
	await page.keyboard.press("Shift+?");
	const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
	await expect(dialog).toBeVisible();
	const selection = dialog.getByRole("region", { name: "Selection" });
	await expect(selection).toContainText("Cut out of the level outline");
	await expect(
		dialog.getByRole("region", { name: "While drawing" }),
	).toContainText("Trace along outlines");
	await expect(
		dialog.getByRole("link", { name: "How to use IndoorID" }),
	).toHaveAttribute("href", /\/help$/);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	// The toolbar's button opens it too.
	await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
	await expect(dialog).toBeVisible();
});

test("the help page explains the editor, section by section", async ({
	page,
}) => {
	await page.goto("/help");
	await expect(
		page.getByRole("heading", { name: "How to use IndoorID" }),
	).toBeVisible();
	await page
		.getByRole("navigation", { name: "Help sections" })
		.getByRole("link", { name: "Floor plans" })
		.click();
	await expect(page).toHaveURL(/#plans$/);
	await expect(page.getByRole("link", { name: "Help" })).toHaveAttribute(
		"aria-current",
		"page",
	);
});
