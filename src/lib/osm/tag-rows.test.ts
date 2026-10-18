import { describe, expect, it } from "vitest";
import { reconcileRows, renameTag } from "./tag-rows.ts";

const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe("reconcileRows: the tag table's rows, as iD orders them", () => {
	it("starts sorted by key, with a blank row to add a tag", () => {
		const rows = reconcileRows([], { name: "A", indoor: "room" });
		expect(keys(rows)).toEqual(["indoor", "name", ""]);
		expect(new Set(rows.map((r) => r.id)).size).toBe(3);
	});

	it("keeps rows where they are: new keys go last, removed ones go", () => {
		const first = reconcileRows([], { name: "A", indoor: "room", level: "0" });
		const next = reconcileRows(first, {
			name: "A",
			indoor: "room",
			amenity: "cafe",
		});
		expect(keys(next)).toEqual(["indoor", "name", "amenity", ""]);
		// The same rows keep their ids.
		expect(next[0]?.id).toBe(first[0]?.id);
	});

	it("keeps the blank row's id once it gets a key, and adds a new blank row", () => {
		const first = reconcileRows([], { indoor: "room" });
		const blank = first.at(-1) as { id: number; key: string };
		const named = first.map((r) =>
			r.id === blank.id ? { ...r, key: "ref" } : r,
		);
		const next = reconcileRows(named, { indoor: "room", ref: "" });
		expect(keys(next)).toEqual(["indoor", "ref", ""]);
		expect(next[1]?.id).toBe(blank.id);
		expect(next[2]?.id).not.toBe(blank.id);
	});
});

describe("renameTag", () => {
	it("moves the value to the new key, in place", () => {
		expect(
			Object.entries(renameTag({ a: "1", b: "2", c: "3" }, "b", "x")),
		).toEqual([
			["a", "1"],
			["x", "2"],
			["c", "3"],
		]);
	});
});
