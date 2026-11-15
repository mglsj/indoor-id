import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import BuildingPanel from "./BuildingPanel.svelte";

function setup(levels = [{ level: 0 }, { level: 1, ref: "OG" }]) {
	const calls = {
		onshowlevel: vi.fn(),
		onsurroundings: vi.fn(),
		onoutline: vi.fn(),
		ondone: vi.fn(),
	};
	render(BuildingPanel, {
		name: "Town hall",
		kind: "building",
		levels,
		level: 0,
		surroundings: true,
		outlineLocked: true,
		...calls,
	});
	return calls;
}

describe("BuildingPanel", () => {
	it("names the building and lists its levels, top first, showing one on a click", async () => {
		const { onshowlevel } = setup();
		const panel = page.getByTestId("building-panel");
		await expect.element(panel).toHaveAccessibleName("Town hall");
		await expect
			.element(panel.getByText("Building", { exact: true }))
			.toBeVisible();
		const levels = page.getByRole("listitem");
		expect(levels.elements().map((e) => e.textContent?.trim())).toEqual([
			"OG · level 1",
			"Level 0",
		]);
		await expect
			.element(page.getByRole("button", { name: "Level 0" }))
			.toHaveAttribute("aria-pressed", "true");
		await userEvent.click(page.getByRole("button", { name: "OG · level 1" }));
		expect(onshowlevel).toHaveBeenCalledWith(1);
	});

	it("says when no level is mapped yet", async () => {
		setup([]);
		await expect
			.element(page.getByText("No levels mapped here yet."))
			.toBeInTheDocument();
	});

	it("turns the surroundings off, and leaves with its close button", async () => {
		const { onsurroundings, ondone } = setup();
		const surroundings = page.getByRole("checkbox", {
			name: "Show surroundings",
		});
		await expect.element(surroundings).toBeChecked();
		await userEvent.click(surroundings);
		expect(onsurroundings).toHaveBeenCalledWith(false);
		await userEvent.click(
			page.getByRole("button", { name: "Back to the map (Escape)" }),
		);
		expect(ondone).toHaveBeenCalledOnce();
	});

	it("unlocks the outline for this visit (B.4)", async () => {
		const { onoutline } = setup();
		const edit = page.getByRole("checkbox", { name: "Edit outline" });
		await expect.element(edit).not.toBeChecked();
		await userEvent.click(edit);
		expect(onoutline).toHaveBeenCalledWith(false);
	});
});
