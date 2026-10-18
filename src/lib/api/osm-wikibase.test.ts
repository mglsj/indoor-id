import { describe, expect, it } from "vitest";
import { linkifyWikiText, OsmWikibase } from "./osm-wikibase.ts";

const BASE = "https://wiki.example.org/w/api.php";

/** A data item of the OSM wiki, as wbgetentities returns it. */
const item = (title: string, extra: Record<string, unknown> = {}) => ({
	title,
	sitelinks: { wiki: { title } },
	descriptions: {},
	claims: {},
	...extra,
});
const description = (value: string) => ({ en: { language: "en", value } });
const page = (lang: string, text: string) => ({
	mainsnak: { datavalue: { value: { language: lang, text } } },
});

function fakeWiki(entities: Record<string, unknown>[]) {
	const urls: URL[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		urls.push(new URL(String(input)));
		return Response.json({
			success: 1,
			entities: Object.fromEntries(entities.map((e, i) => [`Q${i}`, e])),
		});
	}) as typeof globalThis.fetch;
	return { wikibase: new OsmWikibase({ baseUrl: BASE, fetch }), urls };
}

describe("OsmWikibase.docs, as iD's tag reference", () => {
	it("asks for the key's and the tag's data items", async () => {
		const { wikibase, urls } = fakeWiki([]);
		await wikibase.docs({ key: "amenity", value: "cafe" });
		const params = (urls[0] as URL).searchParams;
		expect(params.get("action")).toBe("wbgetentities");
		expect(params.get("titles")).toBe("Key:amenity|Tag:amenity=cafe");
		expect(params.get("languages")).toBe("en");
	});

	it("describes the tag, else the key, with an image and the wiki page", async () => {
		const { wikibase } = fakeWiki([
			item("Key:amenity", {
				descriptions: description("Useful facilities"),
				claims: { P31: [page("en", "Key:amenity")] },
			}),
			item("Tag:amenity=cafe", {
				descriptions: description("A place serving coffee"),
				claims: {
					P4: [
						{
							rank: "preferred",
							mainsnak: { datavalue: { type: "string", value: "Cafe.jpg" } },
						},
					],
					P31: [page("fr", "FR:Tag:amenity=cafe")],
				},
			}),
		]);
		expect(await wikibase.docs({ key: "amenity", value: "cafe" })).toEqual({
			title: "Tag:amenity=cafe",
			description: "A place serving coffee",
			editUrl: "https://wiki.example.org/wiki/Tag:amenity=cafe",
			imageUrl:
				"https://commons.wikimedia.org/w/index.php?title=Special%3ARedirect%2Ffile%2FCafe.jpg&width=400",
			// The tag's page isn't in English: the key's is.
			wiki: {
				title: "Key:amenity",
				url: "https://wiki.example.org/wiki/Key:amenity",
			},
		});
	});

	it("knows nothing about an undocumented key, and asks only once", async () => {
		const { wikibase, urls } = fakeWiki([{ missing: "" }]);
		expect(await wikibase.docs({ key: "survey_note" })).toBeNull();
		const documented = fakeWiki([
			item("Key:level", { descriptions: description("Floor") }),
		]);
		await documented.wikibase.docs({ key: "level" });
		await documented.wikibase.docs({ key: "level" });
		expect(documented.urls).toHaveLength(1);
		expect(urls).toHaveLength(1);
	});
});

describe("linkifyWikiText", () => {
	it("links the keys and tags a description mentions", () => {
		expect(linkifyWikiText("Use with key:level or tag:indoor=room.")).toEqual([
			{ text: "Use with " },
			{ tag: "level=*", href: "https://wiki.openstreetmap.org/wiki/Key:level" },
			{ text: " or " },
			{
				tag: "indoor=room",
				href: "https://wiki.openstreetmap.org/wiki/Tag:indoor=room",
			},
			{ text: "." },
		]);
	});
});
