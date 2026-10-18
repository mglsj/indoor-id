import { describe, expect, it } from "vitest";
import {
	clampWidth,
	DEFAULT_WIDTH,
	rememberedWidth,
	rememberWidth,
	widthBounds,
	widthForKey,
} from "./panel-width.ts";

/** A Storage stand-in. */
function memory(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		items,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		removeItem: (key: string) => void items.delete(key),
	};
}

describe("widthBounds", () => {
	it("goes from 280 px to 60% of a wide window", () => {
		expect(widthBounds(1280)).toEqual({ min: 280, max: 768 });
		expect(widthBounds(1920)).toEqual({ min: 280, max: 1152 });
	});

	it("lets the panel reach 280 px in a window where 60% is less", () => {
		expect(widthBounds(400)).toEqual({ min: 280, max: 280 });
	});

	it("leaves 32 px of map on a phone", () => {
		expect(widthBounds(300)).toEqual({ min: 268, max: 268 });
	});
});

describe("clampWidth", () => {
	const bounds = { min: 280, max: 768 };
	it("keeps a width within the bounds, in whole pixels", () => {
		expect(clampWidth(500.4, bounds)).toBe(500);
		expect(clampWidth(100, bounds)).toBe(280);
		expect(clampWidth(2000, bounds)).toBe(768);
	});
});

describe("widthForKey, as a window splitter", () => {
	const bounds = { min: 280, max: 768 };
	it("moves the edge 16 px with the arrows", () => {
		expect(widthForKey("ArrowRight", 352, bounds)).toBe(368);
		expect(widthForKey("ArrowLeft", 352, bounds)).toBe(336);
		expect(widthForKey("ArrowLeft", 290, bounds)).toBe(280);
	});

	it("goes to the narrowest with Home and the widest with End", () => {
		expect(widthForKey("Home", 352, bounds)).toBe(280);
		expect(widthForKey("End", 352, bounds)).toBe(768);
	});

	it("leaves other keys alone", () => {
		expect(widthForKey("ArrowUp", 352, bounds)).toBeUndefined();
		expect(widthForKey("a", 352, bounds)).toBeUndefined();
	});
});

describe("remembering the width", () => {
	it("opens at 352 px until a width is chosen", () => {
		expect(DEFAULT_WIDTH).toBe(352);
		expect(rememberedWidth(memory())).toBe(352);
	});

	it("opens at the width chosen last", () => {
		const storage = memory();
		rememberWidth(storage, 500);
		expect(rememberedWidth(storage)).toBe(500);
	});

	it("forgets the width once it is back to the default", () => {
		const storage = memory({ "indoorid.side-panel-width": "500" });
		rememberWidth(storage, 352);
		expect(storage.items.size).toBe(0);
	});

	it("ignores a stored value that isn't a width", () => {
		expect(
			rememberedWidth(memory({ "indoorid.side-panel-width": "wide" })),
		).toBe(352);
		expect(rememberedWidth(memory({ "indoorid.side-panel-width": "-5" }))).toBe(
			352,
		);
	});

	it("works without storage (blocked in private windows)", () => {
		const blocked = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		};
		expect(rememberedWidth(blocked)).toBe(352);
		expect(() => rememberWidth(blocked, 500)).not.toThrow();
	});
});
