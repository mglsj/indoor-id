import { expect, test } from "./fixtures.ts";

test("the header's language menu shows IndoorID in another language, kept on reload", async ({
	page,
}) => {
	await page.goto("/help");
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await page.getByRole("button", { name: "Language" }).click();
	await page.getByRole("menuitemradio", { name: "Deutsch" }).click();
	await expect(page.locator("html")).toHaveAttribute("lang", "de");
	await expect(page.getByRole("link", { name: "Hilfe" })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("link", { name: "Hilfe" })).toBeVisible();
});

test.describe("in a French browser", () => {
	test.use({ locale: "fr-CA" });

	test("the browser's language is used when IndoorID has it", async ({
		page,
	}) => {
		await page.goto("/help");
		await expect(page.locator("html")).toHaveAttribute("lang", "fr");
		await expect(page.getByRole("link", { name: "Aide" })).toBeVisible();
	});
});
