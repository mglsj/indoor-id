import { describe, expect, it } from "vitest";
import type { GuideStore, StoredGuide } from "#lib/persist/plan-store.ts";
import { Guides } from "./guides.svelte.ts";

function store(): GuideStore & { saved: Map<string, StoredGuide> } {
	const saved = new Map<string, StoredGuide>();
	return {
		saved,
		loadGuides: async () => [...saved.values()],
		saveGuides: async (guides) => {
			for (const g of guides) saved.set(g.id, g);
		},
		deleteGuides: async (ids) => {
			for (const id of ids) saved.delete(id);
		},
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe("Guides", () => {
	it("keeps guides per level, saved at once", async () => {
		const kept = store();
		const guides = new Guides(kept);
		const a = guides.add({ origin: [1, 2], angle: 30 }, 0, "w1");
		guides.add({ origin: [3, 4], angle: 0 }, 1);
		expect(guides.on(0)).toEqual([a]);
		expect(guides.countOn(1)).toBe(1);
		await settle();
		expect(kept.saved.get(a.id)).toEqual({
			id: a.id,
			origin: [1, 2],
			angle: 30,
			level: 0,
			building: "w1",
		});

		const again = new Guides(kept);
		await again.load();
		expect(again.all).toHaveLength(2);
	});

	it("hides guides without forgetting them", () => {
		const guides = new Guides();
		guides.add({ origin: [1, 2], angle: 30 }, 0);
		guides.shown = false;
		expect(guides.on(0)).toEqual([]);
		expect(guides.countOn(0)).toBe(1);
	});

	it("removes one, or clears a level's", async () => {
		const kept = store();
		const guides = new Guides(kept);
		const a = guides.add({ origin: [1, 2], angle: 30 }, 0);
		guides.add({ origin: [1, 2], angle: 60 }, 0);
		const other = guides.add({ origin: [1, 2], angle: 90 }, 2);
		guides.remove(a.id);
		expect(guides.countOn(0)).toBe(1);
		guides.clear(0);
		await settle();
		expect(guides.all).toEqual([other]);
		expect([...kept.saved.keys()]).toEqual([other.id]);
	});

	it("hides one guide, or recolours it, saved at once", async () => {
		const kept = store();
		const guides = new Guides(kept);
		const a = guides.add({ origin: [1, 2], angle: 30 }, 0);
		const b = guides.add({ origin: [1, 2], angle: 60 }, 0);
		guides.update(a.id, { hidden: true });
		guides.update(b.id, { color: "#22c55e" });
		expect(guides.on(0).map((g) => g.id)).toEqual([b.id]);
		expect(guides.countOn(0)).toBe(2);
		expect(guides.on(0)[0]?.color).toBe("#22c55e");
		guides.update(a.id, { hidden: false });
		expect(guides.on(0)).toHaveLength(2);
		await settle();
		expect(kept.saved.get(b.id)?.color).toBe("#22c55e");
		expect(kept.saved.get(a.id)?.hidden).toBe(false);
	});

	it("lists the levels that have guides, with how many", () => {
		const guides = new Guides();
		guides.add({ origin: [1, 2], angle: 0 }, 2);
		guides.add({ origin: [1, 2], angle: 0 }, -1);
		guides.add({ origin: [1, 2], angle: 0 }, 2);
		expect(guides.levels()).toEqual([
			{ level: 2, count: 2 },
			{ level: -1, count: 1 },
		]);
	});

	it("adds a plan file's guides with new ids, and shows them", () => {
		const guides = new Guides();
		guides.shown = false;
		guides.addAll([{ origin: [1, 2], angle: 45, level: 0 }]);
		expect(guides.shown).toBe(true);
		expect(guides.on(0)[0]?.id).toEqual(expect.any(String));
	});
});
