import { afterEach, describe, expect, it, vi } from "vitest";
import { browserStorage } from "./storage.ts";

afterEach(() => vi.unstubAllGlobals());

/** What a browser blocking site data does: reading `localStorage` itself throws. */
function blockStorage() {
	const blocked = {
		get() {
			throw new DOMException("The operation is insecure.", "SecurityError");
		},
	};
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		...blocked,
	});
	Object.defineProperty(globalThis, "sessionStorage", {
		configurable: true,
		...blocked,
	});
}

describe("browserStorage", () => {
	it("gives the browser's storage", () => {
		const local = { getItem: () => "x" } as unknown as Storage;
		vi.stubGlobal("localStorage", local);
		expect(browserStorage()).toBe(local);
	});

	it("gives none when the browser blocks site data", () => {
		blockStorage();
		expect(browserStorage("local")).toBeUndefined();
		expect(browserStorage("session")).toBeUndefined();
		delete (globalThis as Record<string, unknown>).localStorage;
		delete (globalThis as Record<string, unknown>).sessionStorage;
	});
});
