import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { Tags } from "#lib/osm/tags.ts";
import { combineTags } from "#lib/presets/multi.ts";
import type { Field } from "#lib/presets/presets.ts";
import FieldInput from "./FieldInput.svelte";
import type { FieldChange } from "./field-context.ts";

const MULTIPLE = "Multiple values";

const field = (extra: Partial<Field>): Field => ({
	id: extra.key ?? "f",
	type: "text",
	label: "F",
	options: [],
	terms: [],
	universal: false,
	snakeCase: true,
	caseSensitive: false,
	customValues: true,
	autoSuggestions: false,
	allowDuplicates: false,
	...extra,
});

/** A field over features with these tags, as the Inspector shows several. */
function renderOver(f: Field, features: Tags[]) {
	const { tags, mixed } = combineTags(features);
	const onchange = vi.fn<(change: FieldChange, live?: boolean) => void>();
	render(FieldInput, {
		props: {
			field: f,
			tags,
			mixed,
			context: { deprecated: () => [] },
			onchange,
		},
	});
	/** The tags each feature would get from the last change. */
	const applied = () => {
		const change = onchange.mock.lastCall?.[0];
		return features.map((own) => {
			const patch = typeof change === "function" ? change(own) : change;
			const next: Record<string, string> = { ...own };
			for (const [key, value] of Object.entries(patch ?? {})) {
				if (value === undefined) delete next[key];
				else next[key] = value;
			}
			return next;
		});
	};
	return { onchange, applied };
}

describe("FieldInput over features with different values", () => {
	it("a combo says so, and keeps them until a value is chosen", async () => {
		renderOver(field({ key: "cuisine", type: "combo" }), [
			{ cuisine: "pizza" },
			{ cuisine: "sushi" },
		]);
		const input = page.getByRole("combobox");
		await expect.element(input).toHaveValue("");
		await expect.element(input).toHaveAttribute("placeholder", MULTIPLE);
	});

	it("a check shows a dash, and a click sets yes on all", async () => {
		const { applied } = renderOver(
			field({ key: "wheelchair", type: "check" }),
			[{ wheelchair: "yes" }, {}],
		);
		const box = page.getByRole("checkbox");
		await expect.element(box).toHaveAttribute("aria-checked", "mixed");
		await expect.element(page.getByText(MULTIPLE)).toBeVisible();
		await box.click();
		expect(applied()).toEqual([{ wheelchair: "yes" }, { wheelchair: "yes" }]);
	});

	it("a radio has no choice made", async () => {
		renderOver(
			field({
				key: "door",
				type: "radio",
				options: [
					{ value: "hinged", label: "Hinged" },
					{ value: "sliding", label: "Sliding" },
				],
			}),
			[{ door: "hinged" }, { door: "sliding" }],
		);
		for (const name of ["Hinged", "Sliding"]) {
			await expect
				.element(page.getByRole("radio", { name }))
				.toHaveAttribute("aria-checked", "false");
		}
	});

	it("a text field says so, and sets what is typed on all", async () => {
		const { applied } = renderOver(field({ key: "ref" }), [
			{ ref: "1" },
			{ ref: "2" },
		]);
		const input = page.getByRole("textbox");
		await expect.element(input).toHaveValue("");
		await expect.element(input).toHaveAttribute("placeholder", MULTIPLE);
		await input.fill("3");
		await userEvent.tab();
		expect(applied()).toEqual([{ ref: "3" }, { ref: "3" }]);
	});

	it("a textarea says so", async () => {
		renderOver(field({ key: "description", type: "textarea" }), [
			{ description: "a" },
			{},
		]);
		await expect
			.element(page.getByRole("textbox"))
			.toHaveAttribute("placeholder", MULTIPLE);
	});

	it("a list dims the values only some features have, and edits each feature's own list", async () => {
		const { applied } = renderOver(
			field({
				key: "cuisine",
				type: "semiCombo",
				options: [{ value: "pizza", label: "Pizza" }],
			}),
			[{ cuisine: "pizza;burger" }, { cuisine: "burger" }],
		);
		const chips = page.getByRole("list", { name: "F" }).getByRole("listitem");
		await expect
			.element(chips.first())
			.toHaveAttribute("title", expect.stringMatching(/only some/i));
		await expect
			.element(chips.nth(1))
			.not.toHaveAttribute("title", expect.stringMatching(/only some/i));
		await page.getByRole("button", { name: "Remove Pizza" }).click();
		expect(applied()).toEqual([{ cuisine: "burger" }, { cuisine: "burger" }]);
	});

	it("an address says so for the parts that differ", async () => {
		renderOver(
			field({
				key: "addr",
				type: "address",
				placeholders: { street: "Street", housenumber: "123" },
			}),
			[
				{ "addr:street": "Rue A", "addr:housenumber": "1" },
				{ "addr:street": "Rue A", "addr:housenumber": "2" },
			],
		);
		await expect
			// The house number comes first: the field's label names it.
			.element(page.getByRole("combobox", { name: "F", exact: true }))
			.toHaveAttribute("placeholder", MULTIPLE);
		await expect
			.element(page.getByRole("combobox", { name: "Street" }))
			.toHaveValue("Rue A");
	});

	it("access says so for the rows that differ", async () => {
		renderOver(
			field({
				key: "access",
				type: "access",
				keys: ["access", "foot"],
				types: { access: "All", foot: "Foot" },
			}),
			[{ foot: "yes" }, { foot: "no" }],
		);
		await expect
			.element(page.getByRole("combobox", { name: "Foot" }))
			.toHaveAttribute("placeholder", MULTIPLE);
	});

	it("a name says so, and so do translations that differ", async () => {
		renderOver(field({ key: "name", type: "localized", label: "Name" }), [
			{ name: "A", "name:fr": "A" },
			{ name: "B", "name:fr": "B" },
		]);
		await expect
			.element(page.getByRole("textbox", { name: "Name", exact: true }))
			.toHaveAttribute("placeholder", MULTIPLE);
		await expect
			.element(page.getByRole("textbox", { name: "Name in French" }))
			.toHaveAttribute("placeholder", MULTIPLE);
	});

	it("Wikidata says so", async () => {
		renderOver(field({ key: "wikidata", type: "wikidata" }), [
			{ wikidata: "Q1" },
			{ wikidata: "Q2" },
		]);
		await expect
			.element(page.getByRole("combobox", { name: "F" }))
			.toHaveAttribute("placeholder", MULTIPLE);
	});

	it("Wikipedia says so", async () => {
		renderOver(field({ key: "wikipedia", type: "wikipedia" }), [
			{ wikipedia: "en:A" },
			{ wikipedia: "en:B" },
		]);
		await expect
			.element(page.getByRole("combobox", { name: "F" }))
			.toHaveAttribute("placeholder", MULTIPLE);
	});
});
