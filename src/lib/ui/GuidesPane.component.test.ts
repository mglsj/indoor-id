import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { Guides } from "#lib/state/guides.svelte.ts";
import GuidesPane from "./GuidesPane.svelte";

function setup() {
	const guides = new Guides();
	const first = guides.add({ origin: [1, 2], angle: 30 }, 0);
	guides.add({ origin: [1, 2], angle: -45 }, 0);
	guides.add({ origin: [1, 2], angle: 0 }, 2);
	const calls = {
		place: 0,
		levels: [] as number[],
		highlights: [] as (string | null)[],
		located: [] as string[],
	};
	render(GuidesPane, {
		guides,
		level: 0,
		toolKey: "M",
		onplace: () => calls.place++,
		onlevel: (level) => calls.levels.push(level),
		onhighlight: (id) => calls.highlights.push(id),
		onlocate: (guide) => calls.located.push(guide.id),
		onclose: () => {},
	});
	return { guides, first, calls };
}

const rows = () => page.getByTestId("guides-list").getByRole("listitem");

describe("GuidesPane", () => {
	it("lists the level's guides with their direction, and the other levels", async () => {
		setup();
		await expect.element(rows().first()).toBeInTheDocument();
		expect(
			rows()
				.elements()
				.map((r) => r.textContent?.replace(/\s+/g, " ").trim()),
		).toEqual(["Guide 1 30° from east", "Guide 2 135° from east"]);
		await expect
			.element(page.getByRole("button", { name: /^Level 2/ }))
			.toHaveTextContent("Level 2 1");
	});

	it("hides, recolours and deletes one guide", async () => {
		const { guides, first } = setup();
		await userEvent.click(page.getByRole("button", { name: "Hide guide 1" }));
		expect(guides.on(0)).toHaveLength(1);
		await expect
			.element(page.getByRole("button", { name: "Show guide 1" }))
			.toHaveAttribute("aria-pressed", "true");

		const colour = page
			.getByLabelText("Colour of guide 2")
			.element() as HTMLInputElement;
		colour.value = "#22c55e";
		colour.dispatchEvent(new Event("input", { bubbles: true }));
		expect(guides.listOn(0)[1]?.color).toBe("#22c55e");

		await userEvent.click(page.getByRole("button", { name: "Delete guide 1" }));
		expect(guides.listOn(0).map((g) => g.id)).not.toContain(first.id);
		await expect.poll(() => rows().elements().length).toBe(1);
	});

	it("points at a guide, finds it on the map, and places new ones", async () => {
		const { first, calls } = setup();
		await userEvent.hover(page.getByText("Guide 1"));
		expect(calls.highlights.at(-1)).toBe(first.id);
		await userEvent.click(page.getByText("Guide 1"));
		expect(calls.located).toEqual([first.id]);
		await userEvent.click(page.getByRole("button", { name: /Place a guide/ }));
		expect(calls.place).toBe(1);
		await userEvent.click(page.getByRole("button", { name: /^Level 2/ }));
		expect(calls.levels).toEqual([2]);
	});

	it("says how to place one when the level has none", async () => {
		const guides = new Guides();
		render(GuidesPane, {
			guides,
			level: 0,
			toolKey: "M",
			onplace: () => {},
			onlevel: () => {},
			onhighlight: () => {},
			onlocate: () => {},
			onclose: () => {},
		});
		await expect
			.element(page.getByText(/No guides on this level yet/))
			.toBeInTheDocument();
	});
});
