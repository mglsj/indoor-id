import { describe, expect, it } from "vitest";
import { node } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { buildOsmChange } from "#lib/osm/osmchange.ts";
import { OsmApi, OsmApiError } from "./osm-api.ts";

interface Request {
	method: string;
	url: string;
	authorization: string | null;
	body: string | null;
}

type Responder = (request: Request) => Response | Promise<Response>;

/** A fetch that records every request and answers with the first matching route. */
function fakeFetch(routes: Record<string, Responder>) {
	const requests: Request[] = [];
	const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const request: Request = {
			method: init?.method ?? "GET",
			url: String(input),
			authorization: new Headers(init?.headers).get("Authorization"),
			body: typeof init?.body === "string" ? init.body : null,
		};
		requests.push(request);
		const key = `${request.method} ${new URL(request.url).pathname}`;
		const route = routes[key];
		if (!route) return new Response("Not found", { status: 404 });
		return route(request);
	};
	return { fetch: fetch as typeof globalThis.fetch, requests };
}

const BASE = "https://api.example.org/";

function api(fetch: typeof globalThis.fetch, token: string | null = "secret") {
	return new OsmApi({
		baseUrl: BASE,
		fetch,
		getToken: () => token,
		createdBy: "IndoorID test",
	});
}

describe("loadRelation", () => {
	it("downloads a relation with its members, as iD's download button", async () => {
		const { fetch, requests } = fakeFetch({
			"GET /api/0.6/relation/7/full.json": () =>
				Response.json({
					version: "0.6",
					elements: [
						{ type: "node", id: 1, lat: 48.85, lon: 2.35, version: 1 },
						{
							type: "relation",
							id: 7,
							version: 4,
							members: [{ type: "node", ref: 1, role: "label" }],
							tags: { type: "site" },
						},
					],
				}),
		});
		const entities = await api(fetch).loadRelation("r7");
		expect(requests.map((r) => r.url)).toEqual([
			"https://api.example.org/api/0.6/relation/7/full.json",
		]);
		expect(entities.map((e) => e.id)).toEqual(["n1", "r7"]);
		expect(entities[1]).toMatchObject({
			members: [{ ref: "n1", role: "label" }],
		});
	});
});

describe("loadMap", () => {
	it("keeps who last edited each element, and when", async () => {
		const { fetch } = fakeFetch({
			"GET /api/0.6/map.json": () =>
				Response.json({
					version: "0.6",
					elements: [
						{
							type: "node",
							id: 1,
							lat: 48.85,
							lon: 2.35,
							version: 3,
							user: "Alice",
							timestamp: "2024-05-01T10:00:00Z",
						},
					],
				}),
		});

		const [node] = await api(fetch).loadMap({
			west: 2.3,
			south: 48.8,
			east: 2.4,
			north: 48.9,
		});

		expect(node).toMatchObject({
			user: "Alice",
			timestamp: "2024-05-01T10:00:00Z",
		});
	});

	it("downloads an area and returns its entities", async () => {
		const { fetch, requests } = fakeFetch({
			"GET /api/0.6/map.json": () =>
				Response.json({
					version: "0.6",
					elements: [
						{
							type: "node",
							id: 1,
							lat: 48.85,
							lon: 2.35,
							version: 3,
							tags: { door: "yes" },
						},
						{ type: "node", id: 2, lat: 48.86, lon: 2.36, version: 1 },
						{
							type: "way",
							id: 10,
							nodes: [1, 2],
							version: 2,
							tags: { indoor: "wall" },
						},
						{
							type: "relation",
							id: 20,
							version: 1,
							members: [{ type: "way", ref: 10, role: "outer" }],
							tags: { type: "multipolygon" },
						},
					],
				}),
		});

		const entities = await api(fetch).loadMap({
			west: 2.3,
			south: 48.8,
			east: 2.4,
			north: 48.9,
		});

		expect(requests.map((r) => r.url)).toEqual([
			"https://api.example.org/api/0.6/map.json?bbox=2.3,48.8,2.4,48.9",
		]);
		expect(entities).toEqual([
			{
				type: "node",
				id: "n1",
				version: 3,
				loc: [2.35, 48.85],
				tags: { door: "yes" },
			},
			{ type: "node", id: "n2", version: 1, loc: [2.36, 48.86], tags: {} },
			{
				type: "way",
				id: "w10",
				version: 2,
				nodes: ["n1", "n2"],
				tags: { indoor: "wall" },
			},
			{
				type: "relation",
				id: "r20",
				version: 1,
				members: [{ ref: "w10", role: "outer" }],
				tags: { type: "multipolygon" },
			},
		]);
	});

	it("reports the server's explanation when the area is refused", async () => {
		const { fetch } = fakeFetch({
			"GET /api/0.6/map.json": () =>
				new Response("You requested too many nodes (limit is 50000).", {
					status: 400,
				}),
		});
		const error = await api(fetch)
			.loadMap({ west: 0, south: 0, east: 1, north: 1 })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(OsmApiError);
		expect(error).toMatchObject({ status: 400, kind: "bad-request" });
		expect((error as Error).message).toContain("too many nodes");
	});

	it("reports network failures", async () => {
		const fetch = (async () => {
			throw new TypeError("fetch failed");
		}) as typeof globalThis.fetch;
		await expect(
			api(fetch).loadMap({ west: 0, south: 0, east: 1, north: 1 }),
		).rejects.toMatchObject({ kind: "network" });
	});
});

describe("upload", () => {
	const base = Graph.fromEntities([node("n1", {}, [2.35, 48.85])]);
	const edited = base
		.replace(node("n1", { amenity: "toilets" }, [2.35, 48.85]))
		.replace({
			type: "node",
			id: "n-1",
			tags: { door: "yes" },
			loc: [2.36, 48.86],
		});

	const diffResult = `<diffResult version="0.6">
		<node old_id="1" new_id="1" new_version="2"/>
		<node old_id="-1" new_id="500" new_version="1"/>
	</diffResult>`;

	const routes = (overrides: Record<string, Responder> = {}) => ({
		"PUT /api/0.6/changeset/create": () => new Response("42"),
		"POST /api/0.6/changeset/42/upload": () => new Response(diffResult),
		"PUT /api/0.6/changeset/42/close": () => new Response(""),
		...overrides,
	});

	it("opens a changeset, uploads every change in one request, then closes it", async () => {
		const { fetch, requests } = fakeFetch(routes());
		const result = await api(fetch).upload(edited, {
			comment: 'Added "toilets" & a door',
		});

		expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
			"PUT https://api.example.org/api/0.6/changeset/create",
			"POST https://api.example.org/api/0.6/changeset/42/upload",
			"PUT https://api.example.org/api/0.6/changeset/42/close",
		]);
		expect(requests.every((r) => r.authorization === "Bearer secret")).toBe(
			true,
		);
		expect(requests[0]?.body).toBe(
			'<osm><changeset><tag k="created_by" v="IndoorID test"/><tag k="comment" v="Added &quot;toilets&quot; &amp; a door"/></changeset></osm>',
		);
		expect(requests[1]?.body).toBe(buildOsmChange(edited, 42));
		expect(result.changesetId).toBe(42);
		expect(result.graph.entity("n500")).toMatchObject({
			tags: { door: "yes" },
		});
	});

	it.each([
		[409, "conflict", "Version mismatch: Provided 1, server had: 2 of Node 1"],
		[
			412,
			"precondition",
			"Way 10 requires the nodes with id in (5), which either do not exist, or are not visible.",
		],
	] as const)(
		"on HTTP %i, fails with kind %j, still closes the changeset and uploads only once",
		async (status, kind, message) => {
			const { fetch, requests } = fakeFetch(
				routes({
					"POST /api/0.6/changeset/42/upload": () =>
						new Response(message, { status }),
				}),
			);
			const error = await api(fetch)
				.upload(edited, { comment: "test" })
				.catch((e: unknown) => e);

			expect(error).toMatchObject({ status, kind, changesetId: 42 });
			expect((error as Error).message).toContain(message);
			expect(requests.filter((r) => r.url.endsWith("/upload"))).toHaveLength(1);
			expect(requests.at(-1)?.url).toBe(
				"https://api.example.org/api/0.6/changeset/42/close",
			);
		},
	);

	it("returns the result even if closing the changeset fails (it closes itself later)", async () => {
		const { fetch } = fakeFetch(
			routes({
				"PUT /api/0.6/changeset/42/close": () =>
					new Response("Server error", { status: 500 }),
			}),
		);
		const result = await api(fetch).upload(edited, { comment: "test" });
		expect(result.graph.hasChanges()).toBe(false);
	});

	it("doesn't send anything without a login", async () => {
		const { fetch, requests } = fakeFetch(routes());
		await expect(
			api(fetch, null).upload(edited, { comment: "test" }),
		).rejects.toMatchObject({
			kind: "auth",
		});
		expect(requests).toEqual([]);
	});

	it("doesn't open a changeset when there is nothing to upload", async () => {
		const { fetch, requests } = fakeFetch(routes());
		await expect(api(fetch).upload(base, { comment: "test" })).rejects.toThrow(
			"Nothing to upload",
		);
		expect(requests).toEqual([]);
	});

	it("reports a rejected login", async () => {
		const { fetch } = fakeFetch(
			routes({
				"PUT /api/0.6/changeset/create": () =>
					new Response("Unauthorized", { status: 401 }),
			}),
		);
		await expect(
			api(fetch).upload(edited, { comment: "test" }),
		).rejects.toMatchObject({
			kind: "auth",
			status: 401,
		});
	});
});
