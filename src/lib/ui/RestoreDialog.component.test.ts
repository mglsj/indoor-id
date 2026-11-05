import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import RestoreDialog from "./RestoreDialog.svelte";

const SAVED = new Date(2026, 10, 5, 9, 30).getTime();

function renderDialog() {
	const onrestore = vi.fn();
	const ondiscard = vi.fn();
	render(RestoreDialog, {
		offer: { count: 12, saved: SAVED },
		onrestore,
		ondiscard,
	});
	const dialog = page.getByRole("alertdialog", {
		name: "Restore your unsaved edits?",
	});
	return { dialog, onrestore, ondiscard };
}

describe("RestoreDialog", () => {
	it("says how many features the saved edits change, and when they were saved", async () => {
		const { dialog } = renderDialog();

		const text = dialog.getByText(/^12 features changed, saved /);
		await expect.element(text).toBeVisible();
		expect(text.element().textContent).toContain(
			new Date(SAVED).toLocaleString(),
		);
	});

	it("restores them", async () => {
		const { dialog, onrestore, ondiscard } = renderDialog();

		await dialog.getByRole("button", { name: "Restore" }).click();

		expect(onrestore).toHaveBeenCalledOnce();
		expect(ondiscard).not.toHaveBeenCalled();
	});

	it("discards them", async () => {
		const { dialog, onrestore, ondiscard } = renderDialog();

		await dialog.getByRole("button", { name: "Discard" }).click();

		expect(ondiscard).toHaveBeenCalledOnce();
		expect(onrestore).not.toHaveBeenCalled();
	});

	it("isn't shown without saved edits", async () => {
		render(RestoreDialog, {
			offer: null,
			onrestore: () => {},
			ondiscard: () => {},
		});

		await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
	});
});
