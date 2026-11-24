import { describe, expect, it } from "vitest";
import { changeTags } from "#lib/actions/change-tags.ts";
import { deleteEntities } from "#lib/actions/delete.ts";
import { node, relation, way } from "./fixtures.ts";
import { Graph } from "./graph.ts";
import { buildOsmChange } from "./osmchange.ts";
import { uploadProblems } from "./upload-check.ts";

/** Two rooms sharing the side n2–n3, and a wall line. */
const base = Graph.fromEntities([
	node("n1", {}, [0, 0]),
	node("n2", {}, [0.0001, 0]),
	node("n3", {}, [0.0001, 0.0001]),
	node("n4", {}, [0, 0.0001]),
	node("n5", {}, [0.0002, 0]),
	node("n6", {}, [0.0002, 0.0001]),
	way("w1", ["n1", "n2", "n3", "n4", "n1"], { indoor: "room", level: "0" }),
	way("w2", ["n2", "n5", "n6", "n3", "n2"], { indoor: "room", level: "0" }),
]);

describe("uploadProblems: what is refused before a changeset is opened", () => {
	it("lets ordinary edits through", () => {
		const edited = base
			.replace({ type: "node", id: "n-1", tags: {}, loc: [0, 0.0002] })
			.replace({ type: "node", id: "n-2", tags: {}, loc: [0.0001, 0.0002] })
			.replace({
				type: "way",
				id: "w-1",
				tags: { indoor: "wall", level: "0" },
				nodes: ["n-1", "n-2"],
			});
		expect(uploadProblems(edited)).toEqual([]);
	});

	it("refuses a way under two nodes and a node twice in a row", () => {
		const w1 = base.entity("w1");
		if (w1?.type !== "way") throw new Error("w1");
		const edited = base
			.replace({ ...w1, nodes: ["n1", "n2", "n2", "n3", "n4", "n1"] })
			.replace({
				type: "way",
				id: "w-1",
				tags: { indoor: "wall" },
				nodes: ["n4"],
			});
		expect(uploadProblems(edited)).toEqual(
			expect.arrayContaining([
				{ kind: "repeated-node", id: "w1", other: "n2" },
				{ kind: "short-way", id: "w-1" },
			]),
		);
	});

	it("refuses a way using a deleted node or a new one never created", () => {
		const w1 = base.entity("w1");
		if (w1?.type !== "way") throw new Error("w1");
		const edited = base
			.replace({ ...w1, nodes: ["n1", "n2", "n3", "n-9", "n1"] })
			.remove("n4");
		// n4 is still used by nobody, w1 refers to n-9 that doesn't exist.
		expect(uploadProblems(edited)).toEqual([
			{ kind: "refers-to-missing", id: "w1", other: "n-9" },
		]);
		const w2 = base.entity("w2");
		if (w2?.type !== "way") throw new Error("w2");
		const broken = base
			.replace({ ...w2, tags: { ...w2.tags, name: "B" } })
			.remove("n5");
		expect(uploadProblems(broken)).toEqual([
			{ kind: "refers-to-deleted", id: "w2", other: "n5" },
		]);
	});

	it("refuses deleting a node a way nobody edited still uses", () => {
		expect(uploadProblems(base.remove("n2"))).toEqual(
			expect.arrayContaining([
				{ kind: "still-used", id: "n2", other: "w1" },
				{ kind: "still-used", id: "n2", other: "w2" },
			]),
		);
	});

	it("refuses a relation with a member that is deleted or never created", () => {
		const withRelation = Graph.fromEntities([
			...base.entities(),
			relation("r1", [{ ref: "w1", role: "outer" }], {
				type: "multipolygon",
				indoor: "room",
			}),
		]);
		const edited = withRelation.replace(
			relation(
				"r1",
				[
					{ ref: "w1", role: "outer" },
					{ ref: "w-5", role: "inner" },
				],
				{ type: "multipolygon", indoor: "room" },
			),
		);
		expect(uploadProblems(edited)).toEqual([
			{ kind: "refers-to-missing", id: "r1", other: "w-5" },
		]);
	});

	it("never uploads a new untagged way that no relation holds (osm-simple3d-editor 43c1025)", () => {
		const leftover = base
			.replace({ type: "node", id: "n-1", tags: {}, loc: [0, 0.0002] })
			.replace({
				type: "way",
				id: "w-1",
				tags: { level: "0" },
				nodes: ["n-1", "n4"],
			});
		expect(uploadProblems(leftover)).toEqual([
			{ kind: "untagged-way", id: "w-1" },
		]);
		// The same way as a multipolygon's member is fine.
		const member = leftover.replace({
			type: "relation",
			id: "r-1",
			tags: { type: "multipolygon", indoor: "room" },
			members: [{ ref: "w-1", role: "outer" }],
		});
		expect(uploadProblems(member)).toEqual([]);
	});
});

describe("a deleted way's node shared with a neighbour edited only in its tags (osm-simple3d-editor #86, #87)", () => {
	const edited = changeTags("w2", { indoor: "room", level: "0", name: "B" })(
		deleteEntities(["w1"])(base),
	);

	it("keeps the shared nodes", () => {
		expect(edited.entity("n2")).toBeDefined();
		expect(edited.entity("n3")).toBeDefined();
		expect(edited.entity("n1")).toBeUndefined();
	});

	it("uploads without deleting them", () => {
		expect(uploadProblems(edited)).toEqual([]);
		const change = buildOsmChange(edited, 1);
		expect(change).not.toMatch(/<node id="2"/);
		expect(change).not.toMatch(/<node id="3"/);
		expect(change).toMatch(/<delete[^>]*>.*<node id="1"/);
	});
});
