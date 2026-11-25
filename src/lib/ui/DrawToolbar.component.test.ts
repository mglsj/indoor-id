import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { DrawTool } from "#lib/edit/scope-tools.ts";
import { toolsFor } from "#lib/edit/scope-tools.ts";
import DrawToolbar from "./DrawToolbar.svelte";
import { renderWithTooltips } from "./testing/render.ts";

function setup(scope: "map" | "building", drawing: DrawTool | null = null) {
	const calls: string[] = [];
	renderWithTooltips(DrawToolbar, {
		offered: toolsFor(scope),
		drawing,
		measureVariant: "measure",
		locked: false,
		ondraw: (kind: DrawTool) => calls.push(`draw ${kind}`),
		onplaceguides: () => calls.push("guides"),
		onmeasure: () => calls.push("measure"),
	});
	return calls;
}

describe("DrawToolbar", () => {
	it("starts a tool on a click, and marks the one on", async () => {
		const calls = setup("building", "line");
		await userEvent.click(page.getByRole("button", { name: "Draw point" }));
		expect(calls).toEqual(["draw point"]);
		await expect
			.element(page.getByRole("button", { name: "Draw line" }))
			.toHaveAttribute("aria-pressed", "true");
	});

	it("shows building mode's tools on the map, disabled for screen readers too", async () => {
		setup("map");
		await expect
			.element(page.getByRole("button", { name: "Draw rectangle" }))
			.toHaveAttribute("aria-disabled", "true");
		await expect
			.element(page.getByRole("button", { name: "Draw point" }))
			.not.toHaveAttribute("aria-disabled");
	});

	it("places guides from the measure button's menu", async () => {
		const calls = setup("building");
		await userEvent.click(page.getByTestId("measure-mode"));
		await userEvent.click(page.getByRole("menuitemradio", { name: "Guide" }));
		expect(calls).toEqual(["guides"]);
	});
});
