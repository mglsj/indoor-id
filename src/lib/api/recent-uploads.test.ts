import { describe, expect, it } from "vitest";
import { node, way } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { applyDiffResult } from "#lib/osm/osmchange.ts";
import {
	KEEP_MS,
	RecentUploads,
	type UploadStorage,
	uploadedChanges,
} from "./recent-uploads.ts";

/** A door retagged (n2, version 1 → 2), a node n3 deleted, a node created (n-1 → n1001). */
function upload() {
	const graph = Graph.fromEntities([
		node("n1", {}, [0, 0]),
		node("n2", { door: "yes" }, [1, 0]),
		node("n3", {}, [2, 0]),
	])
		.replace(node("n-1", { amenity: "toilets" }, [3, 0]))
		.replace(node("n2", { door: "hinged" }, [1, 0]))
		.remove("n3");
	const result = applyDiffResult(
		graph,
		`<diffResult version="0.6">
			<node old_id="-1" new_id="1001" new_version="1"/>
			<node old_id="2" new_id="2" new_version="2"/>
			<node old_id="3"/>
		</diffResult>`,
	);
	return uploadedChanges(graph, result);
}

function memory(): UploadStorage & { value: string | null } {
	return {
		value: null,
		read() {
			return this.value;
		},
		write(value) {
			this.value = value;
		},
	};
}

describe("uploadedChanges", () => {
	it("lists what the server now has, with real ids and versions, and what it deleted", () => {
		const { written, deleted } = upload();
		expect(written).toEqual([
			{ ...node("n1001", { amenity: "toilets" }, [3, 0]), version: 1 },
			{ ...node("n2", { door: "hinged" }, [1, 0]), version: 2 },
		]);
		expect(deleted).toEqual([{ id: "n3", version: 2 }]);
	});
});

describe("RecentUploads", () => {
	/** What Overpass still serves a minute after the upload. */
	const lagging = [
		node("n1", {}, [0, 0]),
		node("n2", { door: "yes" }, [1, 0]),
		node("n3", {}, [2, 0]),
	];

	it("lays the upload over an Overpass answer that hasn't caught up", () => {
		const recent = new RecentUploads({ storage: memory(), now: () => 0 });
		recent.record(upload());
		expect(recent.patch(lagging)).toEqual([
			node("n1", {}, [0, 0]),
			{ ...node("n2", { door: "hinged" }, [1, 0]), version: 2 },
			{ ...node("n1001", { amenity: "toilets" }, [3, 0]), version: 1 },
		]);
	});

	it("keeps Overpass's version once it is as new or newer", () => {
		const recent = new RecentUploads({ storage: memory(), now: () => 0 });
		recent.record(upload());
		const newer = { ...node("n2", { door: "sliding" }, [1, 0]), version: 3 };
		expect(recent.patch([newer])).toContainEqual(newer);
	});

	it("is shared through its storage, and forgets uploads after an hour", () => {
		const storage = memory();
		let now = 1000;
		new RecentUploads({ storage, now: () => now }).record(upload());
		const viewer = new RecentUploads({ storage, now: () => now });
		expect(viewer.patch(lagging)).toHaveLength(3);
		expect(viewer.patch(lagging)[1]?.version).toBe(2);
		now += KEEP_MS;
		expect(viewer.patch(lagging)).toEqual(lagging);
		expect(storage.value).toBe("[]");
	});

	it("reads broken storage as empty", () => {
		const storage = memory();
		storage.value = "{not json";
		expect(new RecentUploads({ storage }).patch([way("w1", [])])).toEqual([
			way("w1", []),
		]);
	});
});
