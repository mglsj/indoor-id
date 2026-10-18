import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { PdfDocument } from "#lib/floorplans/import.ts";
import PdfPageDialog from "./PdfPageDialog.svelte";

const pdf: PdfDocument = {
	pageCount: 2,
	pageSize: async () => ({ width: 4, height: 3 }),
	thumbnail: async () => "",
	render: async () => {
		throw new Error("not used");
	},
	vector: async () => {
		throw new Error("not used");
	},
	pageMode: async () => "vector",
	close: () => {},
};

function renderDialog() {
	const onimport = vi.fn(async () => {});
	render(PdfPageDialog, { props: { pdf, onimport, onclose: () => {} } });
	return { onimport };
}

describe("PdfPageDialog", () => {
	it("imports the chosen pages as Auto finds best, at first", async () => {
		const { onimport } = renderDialog();
		await expect
			.element(page.getByRole("radio", { name: "Auto" }))
			.toBeChecked();
		await page.getByRole("button", { name: "Import" }).click();
		expect(onimport).toHaveBeenCalledWith([1], 150, "auto");
	});

	it("imports pages from their paths, or as images at the resolution chosen", async () => {
		const { onimport } = renderDialog();
		const dpi = page.getByRole("spinbutton", { name: "Resolution (DPI)" });
		await page.getByRole("radio", { name: "Vector" }).click();
		// Paths have no resolution.
		await expect.element(dpi).toBeDisabled();
		await page.getByRole("radio", { name: "Image" }).click();
		await expect.element(dpi).toBeEnabled();
		await dpi.fill("300");
		await page.getByRole("checkbox", { name: /Page 2/ }).click();
		await page.getByRole("button", { name: "Import 2 pages" }).click();
		expect(onimport).toHaveBeenCalledWith([1, 2], 300, "image");
	});
});
