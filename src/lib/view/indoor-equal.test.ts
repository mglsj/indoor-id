import { describe, expect, it } from "vitest";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import {
	INDOOR_EQUAL_ORIGIN,
	type PreviewHost,
	previewFeatures,
	previewInIndoorEqual,
} from "./indoor-equal.ts";

const graph = Graph.fromEntities([
	node("n1", {}, [0, 0]),
	node("n2", {}, [1, 0]),
	node("n3", {}, [1, 1]),
	way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room", level: "1" }),
	node("n-1", { amenity: "toilets", level: "1" }, [0.5, 0.5]),
]);

describe("previewFeatures (P6: preview in indoor=)", () => {
	it("gives the features' OSM tags and ids, without IndoorID's own properties", () => {
		const { features } = previewFeatures(graph, ["w1", "n-1", "n1"]);
		expect(features.map((f) => f.properties)).toEqual([
			{ indoor: "room", level: "1", id: "way/1" },
			{ amenity: "toilets", level: "1", id: "node/-1" },
		]);
		expect(features[0]?.geometry.type).toBe("Polygon");
	});
});

/** A tab and the messages heard, driven by hand. */
function fakeHost() {
	const sent: { message: unknown; origin: string }[] = [];
	const tab = {
		postMessage: (message: unknown, origin: string) =>
			sent.push({ message, origin }),
	};
	let listener: ((event: MessageEvent) => void) | null = null;
	const host: PreviewHost = {
		open: () => tab as unknown as Window,
		listen: (l) => {
			listener = l;
			return () => {
				listener = null;
			};
		},
	};
	const hear = (data: unknown, origin: string, source: unknown = tab) =>
		listener?.({ data, origin, source } as MessageEvent);
	return { host, sent, hear, listening: () => listener !== null };
}

describe("previewInIndoorEqual", () => {
	const view = {
		level: 1,
		bbox: { west: 0, south: 0, east: 1, north: 1 },
	};
	const data = previewFeatures(graph, ["w1"]);

	it("sends the file, the level and the place once indoor= says it is ready", () => {
		const fake = fakeHost();
		expect(previewInIndoorEqual(data, view, fake.host)).toBe(true);
		expect(fake.sent).toEqual([]);
		fake.hear({ event: "ready" }, INDOOR_EQUAL_ORIGIN);
		expect(
			fake.sent.map((s) => (s.message as { command: string }).command),
		).toEqual(["preview", "level", "coordinates"]);
		expect(fake.sent.every((s) => s.origin === INDOOR_EQUAL_ORIGIN)).toBe(true);
		expect(fake.sent[1]?.message).toEqual({ command: "level", level: "1" });
		expect(fake.listening()).toBe(false);
	});

	it("ignores messages from another origin or another window", () => {
		const fake = fakeHost();
		previewInIndoorEqual(data, view, fake.host);
		fake.hear({ event: "ready" }, "https://evil.example");
		fake.hear({ event: "ready" }, INDOOR_EQUAL_ORIGIN, {});
		fake.hear({ event: "levels" }, INDOOR_EQUAL_ORIGIN);
		expect(fake.sent).toEqual([]);
		expect(fake.listening()).toBe(true);
	});

	it("says so when the tab can't open", () => {
		const host: PreviewHost = { open: () => null, listen: () => () => {} };
		expect(previewInIndoorEqual(data, view, host)).toBe(false);
	});
});
