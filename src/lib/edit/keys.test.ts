import { describe, expect, it } from "vitest";
import { formatCombo, isForMap, isTyping, matches } from "./keys.ts";

const key = (
	k: string,
	mods: Partial<
		Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey">
	> = {},
) => ({
	key: k,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	altKey: false,
	...mods,
});

describe("matches: a key press against a shortcut", () => {
	it("reads Mod as Ctrl, or ⌘ on a Mac", () => {
		expect(matches(key("z", { ctrlKey: true }), "Mod+Z", false)).toBe(true);
		expect(matches(key("z", { metaKey: true }), "Mod+Z", false)).toBe(false);
		expect(matches(key("z", { metaKey: true }), "Mod+Z", true)).toBe(true);
		expect(matches(key("z", { ctrlKey: true }), "Mod+Z", true)).toBe(false);
	});

	it("needs exactly the modifiers named", () => {
		expect(
			matches(key("Z", { ctrlKey: true, shiftKey: true }), "Mod+Z", false),
		).toBe(false);
		expect(
			matches(
				key("Z", { ctrlKey: true, shiftKey: true }),
				"Mod+Shift+Z",
				false,
			),
		).toBe(true);
		expect(matches(key("Escape"), "Escape", false)).toBe(true);
		expect(matches(key("Escape", { altKey: true }), "Escape", false)).toBe(
			false,
		);
	});

	it("ignores the letter's case", () => {
		expect(matches(key("Y", { ctrlKey: true }), "Mod+Y", false)).toBe(true);
	});
});

describe("formatCombo: a shortcut as shown in tooltips and help", () => {
	it("uses the Mac's symbols there, words elsewhere", () => {
		expect(formatCombo("Mod+Shift+Z", true)).toBe("⇧⌘Z");
		expect(formatCombo("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z");
		expect(formatCombo("Escape", false)).toBe("Esc");
	});
});

describe("isTyping: keys going to a text field rather than the map", () => {
	it("is true in inputs, text areas, selects and editable content", () => {
		const element = (tag: string, attributes: Record<string, string> = {}) => ({
			closest: (selector: string) =>
				selector.split(",").some((s) => {
					const t = s.trim();
					if (t === "[contenteditable]") return "contenteditable" in attributes;
					return t === tag;
				})
					? {}
					: null,
		});
		expect(isTyping(element("input") as unknown as EventTarget)).toBe(true);
		expect(isTyping(element("textarea") as unknown as EventTarget)).toBe(true);
		expect(
			isTyping(
				element("div", { contenteditable: "" }) as unknown as EventTarget,
			),
		).toBe(true);
		expect(isTyping(element("button") as unknown as EventTarget)).toBe(false);
		expect(isTyping(null)).toBe(false);
	});
});

describe("isForMap", () => {
	const noModal = { querySelector: () => null };
	const modal = { querySelector: () => ({}) as Element };
	const press = (defaultPrevented = false) => ({
		defaultPrevented,
		target: null,
	});

	it("leaves a key press to the map when nothing else took it", () => {
		expect(isForMap(press(), noModal)).toBe(true);
	});

	it("skips a key press already handled (the Escape that closed a popover)", () => {
		expect(isForMap(press(true), noModal)).toBe(false);
	});

	it("skips key presses while a modal dialog is open", () => {
		expect(isForMap(press(), modal)).toBe(false);
	});
});
