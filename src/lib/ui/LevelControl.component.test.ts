import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import LevelControl from "./LevelControl.svelte";
import { renderWithTooltips } from "./testing/render.ts";

const radios = () =>
	page.getByRole("group", { name: "Levels" }).getByRole("radio");

describe("LevelControl", () => {
	it("shows each level's level:ref, its number and full name in the tooltip", async () => {
		renderWithTooltips(LevelControl, {
			level: 0,
			levels: [
				{ level: -1, ref: "U1" },
				{ level: 0, ref: "EG", name: "Erdgeschoss" },
				{ level: 1 },
			],
		});
		await expect.element(radios().first()).toBeInTheDocument();
		expect(
			radios()
				.elements()
				.map((r) => r.textContent?.trim()),
		).toEqual(["1", "EG", "U1"]);
		await expect
			.element(
				page.getByRole("radio", {
					name: "Level 0: EG · Erdgeschoss · level 0",
				}),
			)
			.toBeChecked();
		await expect.element(page.getByTestId("level")).toHaveTextContent("EG");

		await userEvent.hover(page.getByRole("radio", { name: /^Level -1/ }));
		await expect
			.element(page.getByText("U1 · level -1").first())
			.toBeInTheDocument();
	});

	it("shortens long names on the buttons", async () => {
		renderWithTooltips(LevelControl, {
			level: 0,
			levels: [
				{ level: 0, ref: "Untere Verkaufsebene" },
				{ level: 1, name: "Obere Verkaufsebene" },
			],
		});
		await expect.element(radios().first()).toHaveTextContent("Obere…");
		await expect.element(radios().last()).toHaveTextContent("Unter…");
	});

	it("steps through the levels listed, skipping those not listed", async () => {
		renderWithTooltips(LevelControl, {
			level: 12,
			levels: [{ level: 12 }, { level: 14 }],
		});
		await userEvent.click(page.getByRole("button", { name: "Level up" }));
		await expect.element(page.getByTestId("level")).toHaveTextContent("14");
		await expect
			.element(page.getByRole("button", { name: "Level up" }))
			.toBeDisabled();
	});

	it("steps by one without levels in view, and shows no list", async () => {
		renderWithTooltips(LevelControl, { level: 0, levels: [] });
		await userEvent.click(page.getByRole("button", { name: "Level up" }));
		await expect.element(page.getByTestId("level")).toHaveTextContent("1");
		await expect
			.element(page.getByRole("group", { name: "Levels" }))
			.not.toBeInTheDocument();
	});
});
