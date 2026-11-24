import { describe, expect, it } from "vitest";
import { KEY_GROUPS, MAP_KEYS, mapKeyFor } from "./keymap.ts";
import { matches } from "./keys.ts";
import { OPERATIONS } from "./operations.ts";

const press = (key: string, more: Partial<KeyboardEvent> = {}) =>
	({
		key,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		...more,
	}) as KeyboardEvent;

describe("keymap (P6: the shortcuts help)", () => {
	it("finds the map key a press is, by its combo or another", () => {
		const find = (event: KeyboardEvent) =>
			mapKeyFor((combo) => matches(event, combo, false))?.action;
		expect(find(press("2"))).toBe("draw-line");
		expect(find(press("y", { ctrlKey: true }))).toBe("redo");
		expect(find(press("?", { shiftKey: true }))).toBe("help");
		expect(find(press("q"))).toBeUndefined();
	});

	it("lists every operation and every map key, and no key twice in a group", () => {
		const listed = KEY_GROUPS.flatMap((g) => g.keys.map((k) => k.action));
		for (const operation of OPERATIONS) expect(listed).toContain(operation.id);
		for (const key of MAP_KEYS) expect(listed).toContain(key.action);
		for (const group of KEY_GROUPS) {
			const combos = group.keys.map((k) => k.combo);
			expect(new Set(combos).size).toBe(combos.length);
		}
	});

	it("gives the map keys no combo an operation has", () => {
		const taken = new Set(OPERATIONS.flatMap((o) => o.keys));
		for (const key of MAP_KEYS) expect(taken.has(key.combo)).toBe(false);
	});
});
