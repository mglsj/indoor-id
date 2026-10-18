import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import TagEditor from "./TagEditor.svelte";

beforeEach(() => localStorage.clear());

function renderTags(tags: Record<string, string>) {
	const onchange = vi.fn();
	render(TagEditor, { tags, onchange });
	return { onchange, list: page.getByRole("list", { name: "Tags" }) };
}

describe("TagEditor", () => {
	it("lists the tags with an empty row, where a new tag is typed", async () => {
		const { onchange, list } = renderTags({ indoor: "room", level: "0" });
		await expect
			.element(list.getByRole("combobox", { name: "Value of level" }))
			.toHaveValue("0");
		await list.getByRole("combobox", { name: "New tag key" }).click();
		await userEvent.keyboard("name{Tab}");
		await userEvent.keyboard("Library{Tab}");
		expect(onchange).toHaveBeenLastCalledWith({
			indoor: "room",
			level: "0",
			name: "Library",
		});
	});

	it("changes a value, and removes a tag", async () => {
		const { onchange, list } = renderTags({ indoor: "room", level: "0" });
		await list.getByRole("combobox", { name: "Value of level" }).fill("1");
		await userEvent.keyboard("{Enter}");
		expect(onchange).toHaveBeenLastCalledWith({ indoor: "room", level: "1" });
		await list.getByRole("button", { name: "Remove tag indoor" }).click();
		expect(onchange).toHaveBeenLastCalledWith({ level: "0" });
	});

	it("edits the tags as text, one key=value a line", async () => {
		const { onchange } = renderTags({ indoor: "room" });
		await page.getByRole("radio", { name: "Text view" }).click();
		const text = page.getByRole("textbox", { name: "Tags" });
		await expect.element(text).toHaveValue("indoor=room");
		await text.fill("indoor=area\nname=Hall");
		await userEvent.tab();
		expect(onchange).toHaveBeenLastCalledWith({ indoor: "area", name: "Hall" });
	});
});
