import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Combobox } from "./combobox.svelte.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A search whose answers the test sends, in any order. */
function manualSearch() {
	const calls: {
		query: string;
		resolve: (r: string[]) => void;
		reject: () => void;
	}[] = [];
	const search = (query: string) =>
		new Promise<string[]>((resolve, reject) =>
			calls.push({ query, resolve, reject: () => reject(new Error("down")) }),
		);
	return { calls, search };
}

describe("Combobox: search", () => {
	it("searches at once for nothing typed, after a 300 ms pause while typing", async () => {
		const search = vi.fn((query: string) => [`${query}!`]);
		const combo = new Combobox({ search });
		combo.find("");
		await vi.advanceTimersByTimeAsync(0);
		expect(combo.result).toEqual(["!"]);

		combo.find("a");
		combo.find("ab");
		await vi.advanceTimersByTimeAsync(299);
		expect(search).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(search).toHaveBeenLastCalledWith("ab");
		expect(search).toHaveBeenCalledTimes(2);
		expect(combo.result).toEqual(["ab!"]);
	});

	it("drops an answer to an older query", async () => {
		const { calls, search } = manualSearch();
		const results: string[] = [];
		const combo = new Combobox({
			search,
			onresult: (_, query) => results.push(query),
		});
		combo.find("", { wait: false });
		combo.find("b", { wait: false });
		calls[1]?.resolve(["bar"]);
		calls[0]?.resolve(["all"]);
		await vi.advanceTimersByTimeAsync(0);
		expect(combo.result).toEqual(["bar"]);
		expect(results).toEqual(["b"]);
	});

	it("keeps the last answer when a search fails, or takes the fallback given", async () => {
		const { calls, search } = manualSearch();
		const keeping = new Combobox({ search });
		keeping.find("");
		calls[0]?.resolve(["kept"]);
		await vi.advanceTimersByTimeAsync(0);
		keeping.find("");
		calls[1]?.reject();
		await vi.advanceTimersByTimeAsync(0);
		expect(keeping.result).toEqual(["kept"]);

		const emptying = new Combobox<string[]>({ search, failed: [] });
		emptying.find("");
		calls[2]?.reject();
		await vi.advanceTimersByTimeAsync(0);
		expect(emptying.result).toEqual([]);
	});

	it("settles: searches at once a query still waiting, and gives its answer", async () => {
		const { calls, search } = manualSearch();
		const combo = new Combobox({ search });
		combo.find("ren");
		const settled = combo.settle();
		expect(calls.map((c) => c.query)).toEqual(["ren"]);
		calls[0]?.resolve(["Rennes"]);
		await expect(settled).resolves.toEqual(["Rennes"]);
		// Nothing searched again after the pause.
		await vi.advanceTimersByTimeAsync(1000);
		expect(calls).toHaveLength(1);
	});

	it("settles to null when another query was asked meanwhile", async () => {
		const { calls, search } = manualSearch();
		const combo = new Combobox({ search });
		combo.find("a", { wait: false });
		const settled = combo.settle();
		combo.find("b", { wait: false });
		calls[0]?.resolve(["a"]);
		await expect(settled).resolves.toBeNull();
	});

	it("stops a search still waiting when disposed", async () => {
		const search = vi.fn(() => ["x"]);
		const combo = new Combobox({ search });
		combo.find("x");
		combo.dispose();
		await vi.advanceTimersByTimeAsync(1000);
		expect(search).not.toHaveBeenCalled();
	});
});

describe("Combobox: list", () => {
	it("moves the highlight within the list, opening it", () => {
		const combo = new Combobox({ search: () => [] });
		expect(combo.move(1, 3)).toBe(0);
		expect(combo.open).toBe(true);
		expect(combo.move(1, 3)).toBe(1);
		expect(combo.move(5, 3)).toBe(2);
		expect(combo.move(-9, 3)).toBe(0);
		// From where the value stands in the list.
		expect(combo.move(1, 3, 1)).toBe(2);
	});

	it("highlights nothing in an empty list", () => {
		const combo = new Combobox({ search: () => [] });
		expect(combo.move(1, 0)).toBe(-1);
		expect(combo.open).toBe(true);
	});

	it("closes an open list on Escape, and leaves the key alone otherwise", () => {
		const combo = new Combobox({ search: () => [] });
		expect(combo.escape()).toBe(false);
		combo.open = true;
		expect(combo.escape()).toBe(true);
		expect(combo.open).toBe(false);
	});
});
