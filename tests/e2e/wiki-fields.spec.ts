import type { Page } from "@playwright/test";
import { expect, selectRoom, tagsBox, test } from "./fixtures.ts";

const LOUVRE = {
	id: "Q19675",
	labels: { en: { language: "en", value: "Louvre" } },
	descriptions: { en: { language: "en", value: "art museum in Paris" } },
	sitelinks: { enwiki: { title: "Louvre" } },
};

/** Serves Wikidata: the Louvre for any search, as an item, and for its articles. */
async function serveWikidata(page: Page) {
	const searches: string[] = [];
	await page.route("https://www.wikidata.org/w/api.php?*", (route) => {
		const params = new URL(route.request().url()).searchParams;
		if (params.get("action") === "wbsearchentities") {
			searches.push(params.get("search") ?? "");
			return route.fulfill({
				json: {
					search: [
						{
							id: "Q19675",
							display: {
								label: { language: "en", value: "Louvre" },
								description: { language: "en", value: "art museum in Paris" },
							},
							aliases: ["Louvre Museum"],
						},
					],
				},
			});
		}
		if (params.get("ids") === "Q19675" || params.get("titles")) {
			return route.fulfill({ json: { entities: { Q19675: LOUVRE } } });
		}
		return route.fulfill({ json: { entities: {} } });
	});
	return searches;
}

async function addField(page: Page, name: string) {
	const editor = page.getByRole("complementary", { name: "Feature editor" });
	await editor.getByRole("button", { name: "Add field" }).click();
	await page.getByRole("combobox", { name: "Search fields" }).fill(name);
	await page.getByRole("option", { name, exact: true }).click();
}

test("Wikidata is searched by the feature's name, and brings its Wikipedia article", async ({
	page,
}) => {
	const searches = await serveWikidata(page);
	const editor = await selectRoom(page, { name: "Louvre" });
	await addField(page, "Wikidata");
	const wikidata = editor.getByRole("combobox", { name: "Wikidata" });
	await wikidata.press("ArrowDown");
	await page.getByRole("option", { name: /Louvre/ }).click();
	expect(searches).toContain("Louvre");

	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nname=Louvre\nwikidata=Q19675\nwikipedia=en:Louvre",
	);
	await expect(wikidata).toHaveValue("Louvre");
	await expect(
		editor.getByRole("textbox", { name: "Wikidata description" }),
	).toHaveValue("art museum in Paris");
	await expect(
		editor.getByRole("link", { name: "View on wikidata.org" }),
	).toHaveAttribute("href", "https://wikidata.org/wiki/Q19675");

	// Both came in one step.
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nname=Louvre",
	);
});

test("a Wikipedia article is set by language and title, or pasted, and brings its item", async ({
	page,
}) => {
	await serveWikidata(page);
	const editor = await selectRoom(page, { name: "Louvre" });
	await addField(page, "Wikipedia");
	const language = editor.getByRole("combobox", { name: "Wikipedia language" });
	await expect(language).toHaveValue("English");
	await language.fill("French");
	await language.press("Enter");
	await expect(language).toHaveValue("français");

	const title = editor.getByRole("combobox", {
		name: "Wikipedia",
		exact: true,
	});
	await title.fill("Musée du Louvre");
	await title.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nname=Louvre\nwikidata=Q19675\nwikipedia=fr:Musée du Louvre",
	);
	await expect(
		editor.getByRole("link", { name: "View on wikipedia.org" }),
	).toHaveAttribute(
		"href",
		"https://fr.wikipedia.org/wiki/Mus%C3%A9e_du_Louvre",
	);

	await title.fill("https://de.wikipedia.org/wiki/Louvre");
	await title.press("Enter");
	await expect(language).toHaveValue("Deutsch");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nname=Louvre\nwikidata=Q19675\nwikipedia=de:Louvre",
	);
});
