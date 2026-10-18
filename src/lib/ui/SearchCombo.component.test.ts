import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import SearchCombo, { type SearchItem } from "./SearchCombo.svelte";

const CITIES: SearchItem[] = [
	{ key: "Q90", label: "Paris", description: "Capital of France" },
	{ key: "Q647", label: "Rennes", description: "City in Brittany" },
];

function renderSearch() {
	const search = vi.fn((query: string) =>
		CITIES.filter((c) => c.label.toLowerCase().startsWith(query.toLowerCase())),
	);
	const onchoose = vi.fn();
	const oncommit = vi.fn();
	render(SearchCombo, {
		id: "city",
		value: "",
		ariaLabel: "City",
		search,
		onchoose,
		oncommit,
	});
	return {
		search,
		onchoose,
		oncommit,
		input: page.getByRole("combobox", { name: "City" }),
	};
}

describe("SearchCombo", () => {
	it("lists the results for what is typed, and takes one chosen with the keys", async () => {
		const { search, onchoose, input } = renderSearch();
		await input.click();
		await userEvent.keyboard("re");
		await expect
			.element(page.getByRole("option", { name: /Rennes/ }))
			.toBeVisible();
		// One search for the whole word, once typing paused.
		expect(search).toHaveBeenCalledTimes(1);
		expect(search).toHaveBeenCalledWith("re");
		await userEvent.keyboard("{ArrowDown}{Enter}");
		expect(onchoose).toHaveBeenCalledWith(CITIES[1]);
	});

	it("opens the list for nothing typed on ↓, and keeps typed text with Enter", async () => {
		const { search, oncommit, input } = renderSearch();
		await input.click();
		await userEvent.keyboard("{ArrowDown}");
		await expect.poll(() => page.getByRole("option").elements().length).toBe(2);
		expect(search).toHaveBeenCalledWith("");
		await userEvent.keyboard("{Escape}");
		await userEvent.keyboard("Lyon{Enter}");
		expect(oncommit).toHaveBeenCalledWith("Lyon");
	});
});
