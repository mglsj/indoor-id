import { describe, expect, it } from "vitest";
import { changeSummary } from "./change-summary.ts";
import { node, way } from "./fixtures.ts";
import { Graph } from "./graph.ts";

/** A room n1–n4 with a door n5 on its side, and a lone toilet point n6. */
const base = Graph.fromEntities([
	node("n1", {}, [0, 0]),
	node("n2", {}, [0.0001, 0]),
	node("n3", {}, [0.0001, 0.0001]),
	node("n4", {}, [0, 0.0001]),
	node("n5", { door: "yes" }, [0.00005, 0]),
	node("n6", { amenity: "toilets" }, [0.00005, 0.00005]),
	way("w1", ["n1", "n5", "n2", "n3", "n4", "n1"], {
		indoor: "room",
		level: "0",
	}),
]);

const ofKind = (graph: Graph) =>
	changeSummary(graph).map((c) => [c.kind, c.entity.id]);

describe("changeSummary: the features an upload changes, as iD's save panel lists them", () => {
	it("lists nothing without edits", () => {
		expect(changeSummary(base)).toEqual([]);
	});

	it("names the way when only an untagged vertex moved", () => {
		const edited = base.replace(node("n2", {}, [0.0002, 0]));
		expect(ofKind(edited)).toEqual([["modified", "w1"]]);
	});

	it("names a tagged vertex that moved, with its way", () => {
		const edited = base.replace(node("n5", { door: "yes" }, [0.00006, 0]));
		expect(ofKind(edited)).toEqual(
			expect.arrayContaining([
				["modified", "w1"],
				["modified", "n5"],
			]),
		);
		expect(ofKind(edited)).toHaveLength(2);
	});

	it("names a vertex retagged in place, not its way", () => {
		const edited = base.replace(node("n5", { door: "hinged" }, [0.00005, 0]));
		expect(ofKind(edited)).toEqual([["modified", "n5"]]);
	});

	it("names a new way, not its new untagged nodes", () => {
		const edited = base
			.replace(node("n-1", {}, [1, 1]))
			.replace(node("n-2", {}, [1, 2]))
			.replace(way("w-1", ["n-1", "n-2"], { indoor: "wall", level: "0" }));
		expect(ofKind(edited)).toEqual([["created", "w-1"]]);
	});

	it("names a deleted point and a deleted way with their old versions", () => {
		const edited = base
			.remove("n6")
			.remove("w1")
			.remove("n1")
			.remove("n2")
			.remove("n3")
			.remove("n4");
		const summary = changeSummary(edited);
		expect(summary.map((c) => [c.kind, c.entity.id])).toEqual(
			expect.arrayContaining([
				["deleted", "n6"],
				["deleted", "w1"],
			]),
		);
		expect(summary).toHaveLength(2);
		expect(summary.find((c) => c.entity.id === "n6")?.entity.tags).toEqual({
			amenity: "toilets",
		});
	});

	it("lists a way once when several of its vertices moved", () => {
		const edited = base
			.replace(node("n2", {}, [0.0002, 0]))
			.replace(node("n3", {}, [0.0002, 0.0001]));
		expect(ofKind(edited)).toEqual([["modified", "w1"]]);
	});

	it("lists created, then modified, then deleted features", () => {
		const edited = base
			.remove("n6")
			.replace(node("n-1", { amenity: "toilets" }, [1, 1]))
			.replace(node("n2", {}, [0.0002, 0]));
		expect(ofKind(edited)).toEqual([
			["created", "n-1"],
			["modified", "w1"],
			["deleted", "n6"],
		]);
	});
});
