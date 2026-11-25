import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
	groupOperations,
	OPERATIONS,
	type Operation,
} from "#lib/edit/operations.ts";
import { msg } from "#lib/i18n/messages.ts";
import SelectionBar from "./SelectionBar.svelte";
import { renderWithTooltips } from "./testing/render.ts";

const byId = (id: Operation["id"]) =>
	OPERATIONS.find((o) => o.id === id) as Operation;

function setup() {
	const calls: string[] = [];
	const entries = [
		{ operation: byId("delete"), disabled: null },
		{ operation: byId("square"), disabled: msg("operation_square") },
		{ operation: byId("disconnect"), disabled: null },
		{ operation: byId("move"), disabled: null },
	];
	renderWithTooltips(SelectionBar, {
		grouped: groupOperations(
			entries.map((e) => ({ ...e, id: e.operation.id })),
		),
		keyOf: (operation: Operation) => (operation.id === "delete" ? "Del" : ""),
		onrun: (operation: Operation) => calls.push(operation.id),
		onzoom: () => calls.push("zoom"),
	});
	return calls;
}

describe("SelectionBar", () => {
	it("runs a main operation, and says why one is disabled", async () => {
		const calls = setup();
		await userEvent.click(page.getByRole("button", { name: "Delete" }));
		expect(calls).toEqual(["delete"]);
		const square = page.getByRole("button", { name: "Square the corners" });
		await expect.element(square).toHaveAttribute("aria-disabled", "true");
		await expect.element(square).toHaveAccessibleDescription(/.+/);
	});

	it("lists the others in More and Transform, and zooms to the selection", async () => {
		const calls = setup();
		await userEvent.click(page.getByRole("button", { name: "More" }));
		await userEvent.click(page.getByRole("menuitem", { name: /Disconnect/ }));
		await userEvent.click(page.getByRole("button", { name: "Transform" }));
		await expect
			.element(page.getByRole("menuitem", { name: /Move/ }))
			.toBeInTheDocument();
		await userEvent.keyboard("{Escape}");
		await userEvent.click(
			page.getByRole("button", { name: "Zoom to selection" }),
		);
		expect(calls).toEqual(["disconnect", "zoom"]);
	});
});
