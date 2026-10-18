import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Field } from "#lib/presets/presets.ts";
import ComboField from "./ComboField.svelte";

const cuisine: Field = {
	id: "cuisine",
	key: "cuisine",
	type: "combo",
	label: "Cuisine",
	options: [
		{ value: "pizza", label: "Pizza" },
		{ value: "burger", label: "Burger" },
		{ value: "sushi", label: "Sushi" },
	],
	terms: [],
	universal: false,
	snakeCase: true,
	caseSensitive: false,
	customValues: true,
	autoSuggestions: false,
	allowDuplicates: false,
};

const context = { deprecated: () => [] };

function renderCombo(props: Partial<{ value: string; mixed: boolean }> = {}) {
	const onchange = vi.fn();
	render(ComboField, {
		// Under `props`: `context` is also a mount option.
		props: {
			field: cuisine,
			value: props.value,
			context,
			locked: false,
			onchange,
			mixed: props.mixed,
		},
	});
	return { onchange, input: page.getByRole("combobox") };
}

describe("ComboField", () => {
	it("shows the value's label, and changes it to an option chosen with the keys", async () => {
		const { onchange, input } = renderCombo({ value: "pizza" });
		await expect.element(input).toHaveValue("Pizza");
		await input.click();
		await userEvent.keyboard("{ArrowDown}");
		await expect
			.element(page.getByRole("option", { name: "Burger" }))
			.toHaveAttribute("aria-selected", "true");
		await userEvent.keyboard("{Enter}");
		expect(onchange).toHaveBeenCalledWith("burger");
	});

	it("filters the options as it is typed, and takes one clicked", async () => {
		const { onchange, input } = renderCombo();
		await input.click();
		await userEvent.keyboard("su");
		await expect.poll(() => page.getByRole("option").elements().length).toBe(1);
		await page.getByRole("option", { name: "Sushi" }).click();
		expect(onchange).toHaveBeenCalledWith("sushi");
	});

	it("says when the features have different values, and changes nothing unless told to", async () => {
		const { onchange, input } = renderCombo({ value: "pizza", mixed: true });
		await expect.element(input).toHaveValue("");
		await expect
			.element(input)
			.toHaveAttribute("placeholder", "Multiple values");
		await input.click();
		await userEvent.tab();
		expect(onchange).not.toHaveBeenCalled();
	});
});
