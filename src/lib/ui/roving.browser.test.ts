import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { roving } from "./roving.ts";

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	document.body.innerHTML = "";
});

/** A field, then a toolbar of `labels` (a `-` prefix: disabled), then another field. */
function toolbar(labels: string[]) {
	document.body.innerHTML = `<input aria-label="before"><div role="toolbar">${labels
		.map((l) =>
			l.startsWith("-")
				? `<button disabled>${l.slice(1)}</button>`
				: `<button>${l}</button>`,
		)
		.join("")}</div><input aria-label="after">`;
	const root = document.querySelector<HTMLElement>("[role=toolbar]");
	if (!root) throw new Error("no toolbar");
	cleanup = roving()(root) as () => void;
	const button = (name: string) =>
		[...root.querySelectorAll("button")].find((b) => b.textContent === name);
	return { root, button };
}

describe("roving (A.6)", () => {
	it("makes the toolbar one Tab stop, its buttons reached with the arrows", async () => {
		const { button } = toolbar(["Point", "Line", "-Area", "Rectangle"]);
		document.querySelector<HTMLInputElement>("[aria-label=before]")?.focus();
		await userEvent.keyboard("{Tab}");
		expect(document.activeElement).toBe(button("Point"));
		await userEvent.keyboard("{ArrowRight}");
		expect(document.activeElement).toBe(button("Line"));
		// The disabled one is skipped.
		await userEvent.keyboard("{ArrowRight}");
		expect(document.activeElement).toBe(button("Rectangle"));
		await userEvent.keyboard("{ArrowRight}");
		expect(document.activeElement).toBe(button("Point"));
		await userEvent.keyboard("{End}");
		expect(document.activeElement).toBe(button("Rectangle"));
		await userEvent.keyboard("{Tab}");
		expect(document.activeElement?.getAttribute("aria-label")).toBe("after");
		// Back in: on the button last focused.
		await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
		expect(document.activeElement).toBe(button("Rectangle"));
	});

	it("moves the stop when its button is disabled", async () => {
		const { button } = toolbar(["Undo", "Redo"]);
		button("Redo")?.focus();
		button("Redo")?.setAttribute("disabled", "");
		await expect.poll(() => button("Undo")?.tabIndex).toBe(0);
	});
});
