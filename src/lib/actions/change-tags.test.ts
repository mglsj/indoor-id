import { describe, expect, it } from "vitest";
import { node } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { changeTags } from "./change-tags.ts";

describe("changeTags", () => {
	const graph = Graph.fromEntities([node("n1", { amenity: "bench" })]);

	it("replaces the tags of an entity", () => {
		const after = changeTags("n1", { amenity: "toilets", level: "0" })(graph);
		expect(after.entity("n1")?.tags).toEqual({
			amenity: "toilets",
			level: "0",
		});
	});

	it("drops empty keys and values, and trims whitespace", () => {
		const after = changeTags("n1", {
			" name ": " Room 101 ",
			"": "orphan value",
			ref: "",
			level: "   ",
		})(graph);
		expect(after.entity("n1")?.tags).toEqual({ name: "Room 101" });
	});

	it("keeps text as typed while the user types (cleaned once they leave the field)", () => {
		const after = changeTags(
			"n1",
			{ name: "Room ", ref: "" },
			{ clean: false },
		)(graph);
		expect(after.entity("n1")?.tags).toEqual({ name: "Room " });
	});

	it("never touches tags the caller didn't pass, like level", () => {
		const tagged = Graph.fromEntities([
			node("n1", { level: "G", amenity: "bench" }),
		]);
		const after = changeTags("n1", {
			level: "G",
			amenity: "bench",
			name: "Bench",
		})(tagged);
		expect(after.entity("n1")?.tags.level).toBe("G");
	});

	it("leaves the original graph unchanged", () => {
		changeTags("n1", { amenity: "toilets" })(graph);
		expect(graph.entity("n1")?.tags).toEqual({ amenity: "bench" });
	});

	it("fails on an unknown entity", () => {
		expect(() => changeTags("n9", {})(graph)).toThrow("n9");
	});
});
