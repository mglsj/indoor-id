import { describe, expect, it } from "vitest";
import {
	searchWikipedia,
	Wikidata,
	wikipediaFromSitelinks,
} from "./wikidata.ts";

function fakeFetch(respond: (url: URL) => unknown) {
	const urls: URL[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		urls.push(url);
		return Response.json(respond(url));
	}) as typeof globalThis.fetch;
	return { fetch, urls };
}

const BASE = "https://wikidata.example.org/w/api.php";

describe("Wikidata, as iD's service", () => {
	it("searches items in English, with their label, description and aliases", async () => {
		const { fetch, urls } = fakeFetch(() => ({
			search: [
				{
					id: "Q19675",
					display: {
						label: { value: "Louvre", language: "en" },
						description: { value: "art museum in Paris", language: "en" },
					},
					aliases: ["Louvre Museum"],
				},
			],
		}));
		const wikidata = new Wikidata({ baseUrl: BASE, fetch });
		expect(await wikidata.search("louvre")).toEqual([
			{
				id: "Q19675",
				label: "Louvre",
				description: "art museum in Paris",
				aliases: ["Louvre Museum"],
			},
		]);
		expect(Object.fromEntries((urls[0] as URL).searchParams)).toEqual({
			action: "wbsearchentities",
			format: "json",
			formatversion: "2",
			search: "louvre",
			type: "item",
			language: "en",
			uselang: "en",
			limit: "10",
			origin: "*",
		});
		expect(await wikidata.search("")).toEqual([]);
		expect(urls).toHaveLength(1);
	});

	it("gets an item once, with its labels, descriptions and Wikipedia links", async () => {
		const entity = {
			id: "Q19675",
			labels: { en: { value: "Louvre", language: "en" } },
			descriptions: {},
			sitelinks: { enwiki: { title: "Louvre" } },
		};
		const { fetch, urls } = fakeFetch(() => ({ entities: { Q19675: entity } }));
		const wikidata = new Wikidata({ baseUrl: BASE, fetch });
		expect(await wikidata.entity("Q19675")).toEqual(entity);
		await wikidata.entity("Q19675");
		expect(urls).toHaveLength(1);
		expect((urls[0] as URL).searchParams.get("props")).toBe(
			"labels|descriptions|claims|sitelinks",
		);
	});

	it("finds the items of a Wikipedia article", async () => {
		const { fetch, urls } = fakeFetch(() => ({
			entities: { Q19675: { id: "Q19675" }, "-1": { missing: "" } },
		}));
		const wikidata = new Wikidata({ baseUrl: BASE, fetch });
		expect(await wikidata.itemsByTitle("fr", "Musée du Louvre")).toEqual([
			"Q19675",
		]);
		const params = (urls[0] as URL).searchParams;
		expect(params.get("sites")).toBe("frwiki");
		expect(params.get("titles")).toBe("Musée du Louvre");
	});
});

describe("wikipediaFromSitelinks: the wikipedia tag for an item", () => {
	it("is its article in English, else in any language", () => {
		expect(
			wikipediaFromSitelinks({
				sitelinks: {
					frwiki: { title: "Musée du Louvre" },
					enwiki: { title: "Louvre" },
				},
			}),
		).toBe("en:Louvre");
		expect(
			wikipediaFromSitelinks({
				sitelinks: {
					zh_yuewiki: { title: "羅浮宮" },
					commonswiki: { title: "x" },
				},
			}),
		).toBe("zh-yue:羅浮宮");
	});

	it("is null without an article, and unknown without links", () => {
		expect(
			wikipediaFromSitelinks({ sitelinks: { commonswiki: { title: "x" } } }),
		).toBeNull();
		expect(wikipediaFromSitelinks({})).toBeUndefined();
	});
});

describe("searchWikipedia, as iD's", () => {
	it("suggests titles for a short text, searches for a longer one", async () => {
		const { fetch, urls } = fakeFetch((url) =>
			url.searchParams.get("action") === "opensearch"
				? ["Lou", ["Louvre", "Lourdes"]]
				: { query: { search: [{ title: "Louvre Pyramid" }] } },
		);
		const template = "https://{lang}.wiki.example.org/w/api.php";
		expect(await searchWikipedia("fr", "Lou", { template, fetch })).toEqual([
			"Louvre",
			"Lourdes",
		]);
		expect(
			await searchWikipedia("fr", "Louvre pyramid", { template, fetch }),
		).toEqual(["Louvre Pyramid"]);
		expect((urls[0] as URL).host).toBe("fr.wiki.example.org");
		expect((urls[1] as URL).searchParams.get("list")).toBe("search");
	});
});
