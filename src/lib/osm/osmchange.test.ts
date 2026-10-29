import { describe, expect, it } from "vitest";
import { connectNodes } from "#lib/actions/connect.ts";
import { deleteEntities } from "#lib/actions/delete.ts";
import { splitAreas } from "#lib/actions/split-areas.ts";
import { node, relation, way } from "./fixtures.ts";
import { Graph } from "./graph.ts";
import { applyDiffResult, buildOsmChange } from "./osmchange.ts";

/** Strips the indentation of expected XML written over several lines. */
const xml = (s: string) =>
	s
		.trim()
		.split("\n")
		.map((line) => line.trim())
		.join("");

describe("buildOsmChange", () => {
	const base = Graph.fromEntities([
		node("n1", {}, [2.35, 48.85]),
		node("n2", {}, [2.36, 48.85]),
		node("n3", {}, [2.36, 48.86]),
		{ ...way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room" }), version: 4 },
		node("n4", {}, [2.4, 48.9]),
		node("n5", {}, [2.41, 48.9]),
		way("w2", ["n4", "n5"], { indoor: "wall" }),
	]);

	it("lists nothing when there is no change", () => {
		expect(buildOsmChange(base, 42)).toBe(
			'<osmChange version="0.6" generator="IndoorID"></osmChange>',
		);
	});

	it("writes creations, then modifications, then deletions, each in dependency order", () => {
		const edited = base
			.replace({
				type: "node",
				id: "n-1",
				tags: { door: "hinged" },
				loc: [2.355, 48.85],
			})
			.replace({
				...way("w1", ["n1", "n-1", "n2", "n3", "n1"], {
					indoor: "room",
					ref: "101",
				}),
				version: 4,
			})
			.replace(node("n3", {}, [2.361, 48.861]))
			.remove("w2")
			.remove("n4")
			.remove("n5");

		expect(buildOsmChange(edited, 42)).toBe(
			xml(`
				<osmChange version="0.6" generator="IndoorID">
					<create>
						<node id="-1" changeset="42" lat="48.85" lon="2.355"><tag k="door" v="hinged"/></node>
					</create>
					<modify>
						<node id="3" changeset="42" version="1" lat="48.861" lon="2.361"></node>
						<way id="1" changeset="42" version="4">
							<nd ref="1"/><nd ref="-1"/><nd ref="2"/><nd ref="3"/><nd ref="1"/>
							<tag k="indoor" v="room"/><tag k="ref" v="101"/>
						</way>
					</modify>
					<delete if-unused="true">
						<way id="2" changeset="42" version="1"/>
						<node id="4" changeset="42" version="1"/>
						<node id="5" changeset="42" version="1"/>
					</delete>
				</osmChange>
			`),
		);
	});

	it("modifies a relation before deleting one of its members (1.x failed with HTTP 412)", () => {
		const graph = Graph.fromEntities([
			node("n1"),
			node("n2"),
			way("w1", ["n1", "n2"]),
			way("w2", ["n2", "n1"]),
			relation("r1", [
				{ ref: "w1", role: "outer" },
				{ ref: "w2", role: "inner" },
			]),
		]);
		const edited = graph
			.replace(relation("r1", [{ ref: "w1", role: "outer" }]))
			.remove("w2");

		const change = buildOsmChange(edited, 7);
		expect(change.indexOf("<modify>")).toBeLessThan(change.indexOf("<delete"));
		expect(change).toContain(
			'<relation id="1" changeset="7" version="1"><member type="way" ref="1" role="outer"/><tag k="type" v="multipolygon"/></relation>',
		);
	});

	it("creates relations after the relations they contain", () => {
		const edited = Graph.fromEntities([node("n1")])
			.replace({
				type: "relation",
				id: "r-1",
				tags: { type: "site" },
				members: [{ ref: "r-2", role: "" }],
			})
			.replace({
				type: "relation",
				id: "r-2",
				tags: { type: "level" },
				members: [{ ref: "n1", role: "" }],
			});

		const change = buildOsmChange(edited, 1);
		expect(change.indexOf('<relation id="-2"')).toBeLessThan(
			change.indexOf('<relation id="-1"'),
		);
	});

	it("deletes relations before the relations they contain", () => {
		const graph = Graph.fromEntities([
			relation("r1", [{ ref: "n9", role: "" }], { type: "level" }),
			relation("r2", [{ ref: "r1", role: "" }], { type: "site" }),
		]);
		const change = buildOsmChange(graph.remove("r1").remove("r2"), 1);
		expect(change.indexOf('<relation id="2"')).toBeLessThan(
			change.indexOf('<relation id="1"'),
		);
	});

	it("escapes special characters in tags", () => {
		const edited = base.replace(
			node("n1", { name: 'Café "Tom & Jerry" <1>\nNext' }, [2.35, 48.85]),
		);
		expect(buildOsmChange(edited, 1)).toContain(
			'<tag k="name" v="Café &quot;Tom &amp; Jerry&quot; &lt;1&gt;&#10;Next"/>',
		);
	});

	it("writes small coordinates without exponents", () => {
		const edited = base.replace(node("n1", {}, [0.0000001, -0.0000002]));
		expect(buildOsmChange(edited, 1)).toContain(
			'lat="-0.0000002" lon="0.0000001"',
		);
	});
});

describe("applyDiffResult", () => {
	const base = Graph.fromEntities([
		node("n1"),
		{ ...node("n2"), version: 9 },
		node("n3"),
		way("w1", ["n1", "n2"]),
	]);
	const edited = base
		.replace({ type: "node", id: "n-1", tags: {}, loc: [1, 1] })
		.replace({
			type: "way",
			id: "w-2",
			tags: { indoor: "wall" },
			nodes: ["n1", "n-1"],
		})
		.replace({ ...node("n2", { door: "yes" }), version: 9 })
		.remove("n3");

	const result = xml(`
		<?xml version="1.0" encoding="UTF-8"?>
		<diffResult version="0.6" generator="OpenStreetMap server">
			<node old_id="-1" new_id="1001" new_version="1"/>
			<way old_id="-2" new_id="2001" new_version="1"/>
			<node old_id="2" new_id="2" new_version="10"/>
			<node old_id="3"/>
		</diffResult>
	`);

	it("gives created entities their real ids, everywhere they are referenced", () => {
		const { graph } = applyDiffResult(edited, result);
		expect(graph.entity("n1001")).toMatchObject({ loc: [1, 1], version: 1 });
		expect(graph.entity("w2001")).toMatchObject({
			nodes: ["n1", "n1001"],
			version: 1,
		});
		expect(graph.entity("n-1")).toBeUndefined();
	});

	it("updates versions as numbers", () => {
		const { graph } = applyDiffResult(edited, result);
		expect(graph.entity("n2")).toMatchObject({
			tags: { door: "yes" },
			version: 10,
		});
	});

	it("drops deleted entities and leaves no local change behind", () => {
		const { graph } = applyDiffResult(edited, result);
		expect(graph.entity("n3")).toBeUndefined();
		expect(graph.hasChanges()).toBe(false);
	});

	it("keeps entities the server didn't delete because they are still used", () => {
		const kept = result.replace(
			'<node old_id="3"/>',
			'<node old_id="3" new_id="3" new_version="1"/>',
		);
		const { graph, notDeleted } = applyDiffResult(edited, kept);
		expect(graph.entity("n3")).toMatchObject({ version: 1 });
		expect(notDeleted).toEqual(["n3"]);
	});

	it("fails when the server didn't acknowledge every change", () => {
		const partial = result.replace('<node old_id="3"/>', "");
		expect(() => applyDiffResult(edited, partial)).toThrow("n3");
	});
});

/** Bugs osm-simple3d-editor hit uploading floor plan edits (see plan.md, P5.3). */
describe("buildOsmChange: floor plan edits", () => {
	const M = 1e-5;

	it("creates the pieces of a room drawn and split in the session, nothing else", () => {
		const drawn = Graph.fromEntities([]).update((g) =>
			[
				node("n-1", {}, [0, 0]),
				node("n-2", {}, [4 * M, 0]),
				node("n-3", {}, [4 * M, 4 * M]),
				node("n-4", {}, [0, 4 * M]),
				way("w-1", ["n-1", "n-2", "n-3", "n-4", "n-1"], {
					indoor: "room",
					level: "0",
				}),
			].reduce((graph, e) => graph.replace(e), g),
		);
		const split = splitAreas(
			[
				[2 * M, -M],
				[2 * M, 5 * M],
			],
			["w-1"],
		)(drawn);
		const change = buildOsmChange(split, 1);
		expect(change).not.toContain("<modify>");
		expect(change).not.toContain("<delete");
		expect(change.match(/<way id="-\d+"/g)).toHaveLength(2);
	});

	it("takes a deleted member out of its relation, before deleting it", () => {
		const graph = Graph.fromEntities([
			node("n1", {}, [0, 0]),
			node("n2", {}, [M, 0]),
			node("n3", {}, [M, M]),
			way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room", level: "0" }),
			way("w2", ["n1", "n3"], { indoor: "wall", level: "0" }),
			relation(
				"r1",
				[
					{ ref: "w1", role: "" },
					{ ref: "w2", role: "" },
				],
				{ type: "level", level: "0" },
			),
		]);
		const change = buildOsmChange(deleteEntities(["w2"])(graph), 1);
		expect(change).toContain(
			'<relation id="1" changeset="1" version="1"><member type="way" ref="1" role=""/>',
		);
		expect(change.indexOf("<modify>")).toBeLessThan(change.indexOf("<delete"));
		expect(change).toContain('<way id="2" changeset="1" version="1"/>');
	});

	it("deletes a node merged into another, if no one else uses it", () => {
		const graph = Graph.fromEntities([
			node("n1", {}, [0, 0]),
			node("n2", {}, [M, 0]),
			node("n3", {}, [M, M]),
			node("n4", {}, [M + 1e-8, M]),
			way("w1", ["n1", "n2", "n3", "n1"], { indoor: "room" }),
			way("w2", ["n4", "n2"], { indoor: "wall" }),
		]);
		const change = buildOsmChange(connectNodes("n4", "n3")(graph), 1);
		expect(change).toContain(
			'<delete if-unused="true"><node id="4" changeset="1" version="1"/></delete>',
		);
		expect(change).toContain('<nd ref="3"/><nd ref="2"/>');
	});
});
