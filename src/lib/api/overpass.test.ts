import { describe, expect, it } from "vitest";
import { OsmApiError } from "./osm-api.ts";
import { indoorQuery, Overpass } from "./overpass.ts";

const BBOX = { west: 2.1, south: 48.1, east: 2.2, north: 48.2 };

function fakeFetch(answer: () => Response) {
	const bodies: string[] = [];
	const urls: string[] = [];
	const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		urls.push(String(input));
		bodies.push(String(init?.body));
		return answer();
	};
	return { fetch: fetch as typeof globalThis.fetch, bodies, urls };
}

describe("indoorQuery", () => {
	it("asks for indoor data in the area (south, west, north, east) with its members", () => {
		expect(indoorQuery(BBOX)).toBe(
			'[out:json][timeout:25][bbox:48.1,2.1,48.2,2.2];(nwr["indoor"];nwr["level"];nwr["repeat_on"];nwr["building"];nwr["building:part"];nwr["door"];nwr["entrance"];);(._;>;);out meta;',
		);
	});
});

describe("Overpass", () => {
	it("posts the query to the interpreter and reads OSM JSON with versions", async () => {
		const { fetch, bodies, urls } = fakeFetch(() =>
			Response.json({
				elements: [
					{
						type: "node",
						id: 1,
						lat: 48.15,
						lon: 2.15,
						version: 3,
						tags: { door: "yes" },
					},
					{ type: "way", id: 2, version: 1, nodes: [1], tags: {} },
				],
			}),
		);
		const overpass = new Overpass({
			baseUrl: "https://overpass.example/api/",
			fetch,
		});
		const entities = await overpass.loadMap(BBOX);
		expect(urls).toEqual(["https://overpass.example/api/interpreter"]);
		expect(new URLSearchParams(bodies[0]).get("data")).toBe(indoorQuery(BBOX));
		expect(entities).toEqual([
			{
				type: "node",
				id: "n1",
				version: 3,
				tags: { door: "yes" },
				loc: [2.15, 48.15],
			},
			{ type: "way", id: "w2", version: 1, tags: {}, nodes: ["n1"] },
		]);
	});

	it("loads a relation with its members", async () => {
		const { fetch, bodies } = fakeFetch(() => Response.json({ elements: [] }));
		await new Overpass({ fetch }).loadRelation("r42");
		expect(new URLSearchParams(bodies[0]).get("data")).toBe(
			"[out:json][timeout:25];rel(42);(._;>;);out meta;",
		);
	});

	it("fails on an error status, and on a query that ran out of time", async () => {
		const busy = new Overpass({
			fetch: fakeFetch(() => new Response("busy", { status: 429 })).fetch,
		});
		await expect(busy.loadMap(BBOX)).rejects.toMatchObject({
			kind: "rate-limit",
			status: 429,
		});
		const timedOut = new Overpass({
			fetch: fakeFetch(() =>
				Response.json({
					elements: [],
					remark: 'runtime error: Query timed out in "query"',
				}),
			).fetch,
		});
		await expect(timedOut.loadMap(BBOX)).rejects.toBeInstanceOf(OsmApiError);
	});

	it("never uploads", async () => {
		await expect(new Overpass().upload()).rejects.toBeInstanceOf(OsmApiError);
	});
});

describe("Overpass: indoor centres", () => {
	it("asks for the centres of rooms, areas and corridors, and reads them", async () => {
		const { fetch, bodies } = fakeFetch(() =>
			Response.json({
				elements: [
					{ type: "way", id: 5, center: { lat: 48.15, lon: 2.15 } },
					{ type: "relation", id: 6, center: { lat: 48.16, lon: 2.16 } },
					{ type: "way", id: 7 },
				],
			}),
		);
		const centres = await new Overpass({ fetch }).indoorCentres(BBOX);
		expect(new URLSearchParams(bodies[0]).get("data")).toBe(
			'[out:json][timeout:25][bbox:48.1,2.1,48.2,2.2];wr["indoor"~"^(room|area|corridor)$"];out ids center qt;',
		);
		expect(centres).toEqual([
			{ id: "w5", loc: [2.15, 48.15] },
			{ id: "r6", loc: [2.16, 48.16] },
		]);
	});
});
