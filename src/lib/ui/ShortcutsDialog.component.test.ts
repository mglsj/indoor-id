import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ShortcutsDialog from "./ShortcutsDialog.svelte";

describe("ShortcutsDialog", () => {
	it("filters the keys by what they do, or by the key (A.6)", async () => {
		render(ShortcutsDialog, { open: true, mac: false });
		const search = page.getByRole("searchbox", {
			name: "Search the shortcuts",
		});
		await userEvent.fill(search, "level");
		await expect
			.element(page.getByText("Show the level above"))
			.toBeInTheDocument();
		await expect.element(page.getByText("PageUp")).toBeInTheDocument();
		await expect.element(page.getByText("Undo")).not.toBeInTheDocument();

		await userEvent.fill(search, "ctrl+z");
		await expect
			.element(page.getByText("Ctrl+Z", { exact: true }))
			.toBeInTheDocument();
		await expect
			.element(page.getByText("Show the level above"))
			.not.toBeInTheDocument();

		await userEvent.fill(search, "teleport");
		await expect
			.element(page.getByRole("status"))
			.toHaveTextContent("No shortcut for “teleport”");
	});
});
