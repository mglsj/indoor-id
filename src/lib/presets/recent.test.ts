import { describe, expect, it } from "vitest";
import { RecentPresets } from "./recent.ts";

/** A Storage stand-in kept in memory. */
function memory() {
	const items = new Map<string, string>();
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
	};
}

describe("RecentPresets", () => {
	it("lists the presets chosen for a geometry, the last one first, each once", () => {
		const recent = new RecentPresets(memory());
		recent.add("indoor/room", "area");
		recent.add("amenity/toilets", "area");
		recent.add("indoor/room", "area");
		recent.add("amenity/toilets", "point");

		expect(recent.list("area")).toEqual(["indoor/room", "amenity/toilets"]);
		expect(recent.list("point")).toEqual(["amenity/toilets"]);
	});

	it("shows 8 and keeps 30", () => {
		const recent = new RecentPresets(memory());
		for (let i = 0; i < 40; i++) recent.add(`p${i}`, "area");

		expect(recent.list("area")).toEqual(
			[39, 38, 37, 36, 35, 34, 33, 32].map((i) => `p${i}`),
		);
		const kept = recent.list("area", 100);
		expect(kept).toHaveLength(30);
		expect(kept.at(-1)).toBe("p10");
	});

	it("remembers them in the browser", () => {
		const storage = memory();
		new RecentPresets(storage).add("indoor/room", "area");
		expect(new RecentPresets(storage).list("area")).toEqual(["indoor/room"]);
	});

	it("still works when the browser's storage doesn't", () => {
		const broken = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
		};
		const recent = new RecentPresets(broken);
		recent.add("indoor/room", "area");
		expect(recent.list("area")).toEqual(["indoor/room"]);
	});
});
