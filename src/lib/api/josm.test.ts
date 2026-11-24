import { describe, expect, it, vi } from "vitest";
import { MessageError } from "#lib/i18n/messages.ts";
import { Graph } from "#lib/osm/graph.ts";
import { JOSM_URL, JosmSource } from "./josm.ts";

const LAYER = `<osm version='0.6' generator='JOSM'>
  <node id='-1' action='modify' lat='1' lon='2' />
  <node id='-2' action='modify' lat='3' lon='4' />
  <way id='-3' action='modify'><nd ref='-1'/><nd ref='-2'/><tag k='indoor' v='wall'/></way>
</osm>`;

const BBOX = { west: 0, south: 0, east: 5, north: 5 };

function josm(...answers: (Response | Error)[]) {
	const fetch = vi.fn<typeof globalThis.fetch>(async () => {
		const answer = answers.shift() ?? new Response(LAYER);
		if (answer instanceof Error) throw answer;
		return answer;
	});
	return { fetch, source: new JosmSource({ fetch }) };
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
	const error = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(MessageError);
	return (error as MessageError).msg.key;
}

describe("JosmSource", () => {
	it("reads JOSM's active layer from Remote Control's export", async () => {
		const { fetch, source } = josm();
		const entities = await source.load();
		expect(fetch).toHaveBeenCalledWith(`${JOSM_URL}/export`, expect.anything());
		expect(entities.map((e) => e.id)).toEqual(["n-1", "n-2", "w-3"]);
	});

	it("hands the layer to the map once, whatever area it asks for, and reads it once", async () => {
		const { fetch, source } = josm();
		const extent = (await source.load()).length;
		expect(await source.loadMap(BBOX)).toHaveLength(extent);
		expect(await source.loadMap({ ...BBOX, west: 100, east: 101 })).toEqual([]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("tries again after a failure", async () => {
		const { fetch, source } = josm(new TypeError("Failed to fetch"));
		expect(await messageOf(source.loadMap(BBOX))).toBe("josm_unreachable");
		expect(await source.loadMap(BBOX)).toHaveLength(3);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("says when the export permission is off, and when no data layer is active", async () => {
		expect(
			await messageOf(josm(new Response("", { status: 403 })).source.load()),
		).toBe("josm_permission");
		expect(await messageOf(josm(new Response("")).source.load())).toBe(
			"josm_no_layer",
		);
		// JOSM before r19425 has no export command.
		expect(
			await messageOf(josm(new Response("", { status: 400 })).source.load()),
		).toBe("josm_too_old");
	});

	it("never uploads: the edits stay JOSM's to upload", async () => {
		const { source } = josm();
		expect(await messageOf(source.upload(Graph.fromEntities([]), {}))).toBe(
			"josm_read_only",
		);
		// Relations come whole with the layer; nothing is current on a server.
		expect(await source.loadRelation("r1")).toEqual([]);
		expect(await source.loadEntities(["n1"])).toEqual([]);
	});
});
