import { describe, expect, it, vi } from "vitest";
import { type Locator, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { PLAN_COLORS } from "#lib/floorplans/colors.ts";
import { rasterContent } from "#lib/floorplans/content.ts";
import { RENNES } from "#lib/floorplans/test-geometry.ts";
import { FloorPlans } from "#lib/state/floorplans.svelte.ts";
import { fakeImage } from "#lib/state/testing/plan-store.ts";
import PlanList from "./PlanList.svelte";

const view = { center: RENNES, heightMetres: 25 };

/** An element's text, spaces collapsed. */
const text = (locator: Locator) =>
	locator.element().textContent?.replace(/\s+/g, " ").trim();

/** Plans "a" on level 0, then "b" on level 1 (in Edit, as just added), listed. */
function renderList() {
	const floorplans = new FloorPlans();
	for (const [name, level] of [
		["a", "0"],
		["b", "1"],
	] as const) {
		floorplans.add(rasterContent(fakeImage()), name, view, level, {
			source: { kind: "raster", file: name },
			file: new Blob(),
		});
	}
	const onshowlevel = vi.fn();
	render(PlanList, { props: { floorplans, level: 1, onshowlevel } });
	const rows = page.getByRole("list", { name: "Layers" }).getByRole("listitem");
	const plan = (name: string) => {
		const found = floorplans.plans.find((p) => p.name === name);
		if (!found) throw new Error(`no plan ${name}`);
		return found;
	};
	return { floorplans, onshowlevel, rows, plan };
}

describe("PlanList", () => {
	it("lists the layers top first: the outlines, then the plans, newest on top", async () => {
		const { rows } = renderList();
		await expect.poll(() => text(rows.nth(0))).toMatch(/^Buildings/);
		// The plan in Edit: its name in a field, its size in pixels while its content is kept.
		await expect.poll(() => text(rows.nth(1))).toBe("400 × 300 px Level 1");
		await expect
			.element(rows.nth(1).getByRole("textbox", { name: "Name" }))
			.toHaveValue("b");
		await expect.poll(() => text(rows.nth(2))).toMatch(/^a .*Level 0$/);
		expect(rows.all()).toHaveLength(3);
		// The plan in Edit is the current row.
		await expect.element(rows.nth(1)).toHaveAttribute("aria-current", "true");
	});

	it("shows and hides a plan", async () => {
		const { plan } = renderList();
		const show = page.getByRole("button", { name: "Show a" });
		await expect.element(show).toHaveAttribute("aria-pressed", "true");
		await show.click();
		expect(plan("a").visible).toBe(false);
		await expect.element(show).toHaveAttribute("aria-pressed", "false");
	});

	it("renames and recolours the plan in Edit", async () => {
		const { plan } = renderList();
		const name = page.getByRole("textbox", { name: "Name" });
		await name.fill("Ground floor");
		await userEvent.keyboard("{Enter}");
		await expect.poll(() => plan("Ground floor").level).toBe("1");

		const color = PLAN_COLORS[3];
		if (!color) throw new Error("no colour");
		await page.getByRole("button", { name: "Colour of Ground floor" }).click();
		await page.getByRole("button", { name: color.name }).click();
		expect(plan("Ground floor").color).toBe(color.value);
	});

	it("moves a layer with Alt and the arrow keys", async () => {
		const { floorplans } = renderList();
		await page.getByRole("button", { name: "Move a" }).click();
		await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
		await expect
			.poll(() =>
				floorplans.layers.map((l) =>
					l.kind === "plan" ? l.plan.name : "buildings",
				),
			)
			// Bottom first: "a" is now above "b".
			.toEqual(["b", "a", "buildings"]);
		await expect
			.element(page.getByRole("button", { name: "Move a" }))
			.toHaveFocus();
	});

	it("opens another plan in Edit, showing its level", async () => {
		const { floorplans, onshowlevel, plan } = renderList();
		await page.getByRole("button", { name: "Edit a" }).click();
		expect(floorplans.editingId).toBe(plan("a").id);
		expect(onshowlevel).toHaveBeenCalledWith(0);
	});

	it("removes a plan once confirmed", async () => {
		const { floorplans, rows } = renderList();
		await page.getByRole("button", { name: "Remove a" }).click();
		await expect
			.poll(() => text(page.getByRole("alertdialog")))
			.toMatch(/Remove a\?/);
		await page.getByRole("button", { name: "Remove", exact: true }).click();
		expect(floorplans.plans.map((p) => p.name)).toEqual(["b"]);
		await expect.poll(() => rows.all()).toHaveLength(2);
	});
});
