import { describe, expect, it } from "vitest";
import { Taginfo } from "./taginfo.ts";

const BASE = "https://taginfo.example.org/api/4/";

/** A fake taginfo: popular keys first, then `data` for every other request. */
function fakeTaginfo(
	data: Record<string, unknown>[],
	popular: string[] = ["building", "highway"],
) {
	const urls: URL[] = [];
	const fetch = (async (input: RequestInfo | URL) => {
		const url = new URL(String(input));
		urls.push(url);
		if (url.searchParams.get("sortname") === "values_all") {
			return Response.json({ data: popular.map((key) => ({ key })) });
		}
		return Response.json({ data });
	}) as typeof globalThis.fetch;
	const taginfo = new Taginfo({ baseUrl: BASE, fetch });
	/** Requests other than the popular keys. */
	const requests = () =>
		urls.filter((u) => u.searchParams.get("sortname") !== "values_all");
	return { taginfo, urls, requests };
}

const value = (v: string, count = 5000, description?: string) => ({
	value: v,
	count,
	...(description ? { description } : {}),
});

describe("Taginfo.values, as iD's taginfo service", () => {
	it("asks for a key's values on the features of the geometry, the most used first", async () => {
		const { taginfo, requests } = fakeTaginfo([value("office")]);
		await taginfo.values({ key: "room", query: "of", geometry: "area" });

		const url = requests()[0] as URL;
		expect(url.origin + url.pathname).toBe(
			"https://taginfo.example.org/api/4/key/values",
		);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			key: "room",
			query: "of",
			filter: "ways",
			sortname: "count_ways",
			sortorder: "desc",
			page: "1",
			rp: "25",
			lang: "en",
		});
		await taginfo.values({ key: "shop", query: "", geometry: "point" });
		expect(requests()[1]?.searchParams.get("filter")).toBe("nodes");
		expect(requests()[1]?.searchParams.get("sortname")).toBe("count_nodes");
	});

	it("returns values with their description, leaving out rare, uppercase and listed ones", async () => {
		const { taginfo } = fakeTaginfo([
			value("office", 5000, "An office"),
			value("toilets"),
			value("rare", 100),
			value("Office"),
			value("office;toilets"),
			value("a,b"),
		]);
		expect(
			await taginfo.values({ key: "room", query: "", geometry: "area" }),
		).toEqual([
			{ value: "office", title: "An office" },
			{ value: "toilets", title: "toilets" },
		]);
	});

	it("keeps uppercase values for keys that need them (brand, opening hours…)", async () => {
		const { taginfo } = fakeTaginfo([value("Mo-Fr 08:00-18:00")]);
		expect(
			await taginfo.values({
				key: "opening_hours",
				query: "",
				geometry: "area",
			}),
		).toEqual([{ value: "Mo-Fr 08:00-18:00", title: "Mo-Fr 08:00-18:00" }]);
	});

	it("doesn't ask for the values of popular keys or names", async () => {
		const { taginfo, requests } = fakeTaginfo([value("yes")]);
		for (const key of [
			"building",
			"name",
			"alt_name",
			"name:fr",
			"addr:street",
		]) {
			expect(
				await taginfo.values({ key, query: "", geometry: "area" }),
			).toEqual([]);
		}
		expect(requests()).toHaveLength(0);
	});

	it("answers a query again from its cache, and a longer one when the shorter got everything", async () => {
		const { taginfo, requests } = fakeTaginfo([value("office")]);
		const ask = (query: string) =>
			taginfo.values({ key: "room", query, geometry: "area" });
		await ask("o");
		await ask("o");
		// "o" returned fewer than 25 values: all of "of" are among them.
		expect(await ask("of")).toEqual([{ value: "office", title: "office" }]);
		expect(requests()).toHaveLength(1);
	});

	it("asks again for a longer query when the shorter one was cut at 25 values", async () => {
		const many = Array.from({ length: 25 }, (_, i) => value(`v${i}`));
		const { taginfo, requests } = fakeTaginfo(many);
		await taginfo.values({ key: "room", query: "v", geometry: "area" });
		await taginfo.values({ key: "room", query: "v1", geometry: "area" });
		expect(requests()).toHaveLength(2);
	});

	it("shares a request already on its way", async () => {
		const { taginfo, requests } = fakeTaginfo([value("office")]);
		await Promise.all([
			taginfo.values({ key: "room", query: "", geometry: "area" }),
			taginfo.values({ key: "room", query: "", geometry: "area" }),
		]);
		expect(requests()).toHaveLength(1);
	});

	it("fails when taginfo does", async () => {
		const fetch = (async () =>
			new Response("", { status: 503 })) as typeof globalThis.fetch;
		const taginfo = new Taginfo({ baseUrl: BASE, fetch });
		await expect(
			taginfo.values({ key: "room", query: "", geometry: "area" }),
		).rejects.toThrow("503");
	});
});

describe("Taginfo.multikeys", () => {
	it("lists the keys under a prefix, one level deep", async () => {
		const { taginfo, requests } = fakeTaginfo([
			{ key: "payment:cash" },
			{ key: "payment:cards" },
			{ key: "payment:cards:visa" },
			{ key: "payment" },
		]);
		expect(
			await taginfo.multikeys({ query: "payment:c", geometry: "point" }),
		).toEqual([
			{ value: "payment:cash", title: "payment:cash" },
			{ value: "payment:cards", title: "payment:cards" },
		]);
		const url = requests()[0] as URL;
		expect(url.pathname).toBe("/api/4/keys/all");
		expect(url.searchParams.get("query")).toBe("payment:c");
		expect(url.searchParams.get("sortname")).toBe("count_nodes");
	});
});

describe("Taginfo.keys", () => {
	it("lists the keys used often or documented, simple keys first", async () => {
		const { taginfo, requests } = fakeTaginfo([
			{ key: "level:ref", count_all: 9000 },
			{ key: "level", count_all: 5000 },
			{ key: "levelz", count_all: 10 },
			{ key: "level_note", count_all: 10, in_wiki: true },
			{ key: "created_by", count_all: 99999 },
		]);
		expect(
			(await taginfo.keys({ query: "lev", geometry: "area" })).map(
				(k) => k.value,
			),
		).toEqual(["level", "level_note", "level:ref"]);
		const url = requests()[0] as URL;
		expect(url.pathname).toBe("/api/4/keys/all");
		expect(url.searchParams.get("query")).toBe("lev");
		expect(url.searchParams.get("sortname")).toBe("count_ways");
		expect(url.searchParams.get("rp")).toBe("10");
	});
});

describe("Taginfo.roles, as iD's", () => {
	it("asks for the roles used in a type of relation by members of the geometry", async () => {
		const { taginfo, requests } = fakeTaginfo([
			{ role: "inner", count_way_members_fraction: 0.2 },
			{ role: "outer", count_way_members_fraction: 0.8 },
			{ role: "", count_way_members_fraction: 0.1 },
			{ role: "Outer", count_way_members_fraction: 0.1 },
			{ role: "a;b", count_way_members_fraction: 0.1 },
			{ role: "label", count_way_members_fraction: 0 },
		]);
		expect(
			await taginfo.roles({
				type: "multipolygon",
				query: "o",
				geometry: "area",
			}),
		).toEqual([
			// Those starting with what was typed first.
			{ value: "outer", title: "outer" },
			{ value: "inner", title: "inner" },
		]);
		const url = requests()[0] as URL;
		expect(url.pathname).toBe("/api/4/relation/roles");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			rtype: "multipolygon",
			query: "o",
			sortname: "count_way_members",
			sortorder: "desc",
			page: "1",
			rp: "25",
			lang: "en",
		});
	});

	it("counts points and vertices as node members, relations as relation members", async () => {
		const { taginfo, requests } = fakeTaginfo([
			{ role: "label", count_node_members_fraction: 0.5 },
			{ role: "subarea", count_relation_members_fraction: 0.5 },
		]);
		expect(
			await taginfo.roles({ type: "site", query: "", geometry: "vertex" }),
		).toEqual([{ value: "label", title: "label" }]);
		expect(
			await taginfo.roles({ type: "site", query: "", geometry: "relation" }),
		).toEqual([{ value: "subarea", title: "subarea" }]);
		expect(requests()[1]?.searchParams.get("sortname")).toBe(
			"count_relation_members",
		);
	});
});
