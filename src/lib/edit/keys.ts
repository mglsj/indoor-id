/**
 * Keyboard shortcuts, as `Mod+Shift+Z`: `Mod` is Ctrl, or ⌘ on a Mac. The map's shortcuts
 * never fire while the user types in a field.
 */

/** The parts of a key press a shortcut is matched against. */
export type KeyPress = Pick<
	KeyboardEvent,
	"key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

interface Combo {
	readonly key: string;
	readonly ctrl: boolean;
	readonly meta: boolean;
	readonly shift: boolean;
	readonly alt: boolean;
}

function parse(combo: string, mac: boolean): Combo {
	const parts = combo.split("+");
	const key = (parts.pop() ?? "").toLowerCase();
	const has = (name: string) => parts.includes(name);
	return {
		key,
		ctrl: has("Ctrl") || (has("Mod") && !mac),
		meta: has("Meta") || (has("Mod") && mac),
		shift: has("Shift"),
		alt: has("Alt"),
	};
}

/** Whether a key press is the shortcut `combo`, with exactly its modifiers. */
export function matches(event: KeyPress, combo: string, mac: boolean): boolean {
	const c = parse(combo, mac);
	return (
		event.key.toLowerCase() === c.key &&
		event.ctrlKey === c.ctrl &&
		event.metaKey === c.meta &&
		event.shiftKey === c.shift &&
		event.altKey === c.alt
	);
}

const MAC_SYMBOLS: Record<string, string> = {
	Ctrl: "⌃",
	Alt: "⌥",
	Shift: "⇧",
	Mod: "⌘",
	Meta: "⌘",
};
const NAMES: Record<string, string> = { Escape: "Esc", Delete: "Del" };

/** A shortcut as shown to the user: `⇧⌘Z` on a Mac, `Ctrl+Shift+Z` elsewhere. */
export function formatCombo(combo: string, mac: boolean): string {
	const parts = combo.split("+");
	const key = parts.pop() ?? "";
	const name = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
	if (mac) {
		// The Mac's order: Control, Option, Shift, Command.
		const order = ["Ctrl", "Alt", "Shift", "Mod", "Meta"];
		const symbols = order
			.filter((m) => parts.includes(m))
			.map((m) => MAC_SYMBOLS[m]);
		return `${symbols.join("")}${name}`;
	}
	return [...parts.map((m) => (m === "Mod" ? "Ctrl" : m)), name].join("+");
}

/** Whether keys typed now go to a text field (its own shortcuts win). */
export function isTyping(target: EventTarget | null): boolean {
	const element = target as Element | null;
	return (
		typeof element?.closest === "function" &&
		element.closest("input, textarea, select, [contenteditable]") !== null
	);
}

/**
 * Whether a key press is left for the map's shortcuts: not handled already (the Escape that
 * closes a popover), not typed in a field, and no modal dialog open (Mod+Z would undo behind
 * it).
 */
export function isForMap(
	event: Pick<KeyboardEvent, "defaultPrevented" | "target">,
	document: Pick<Document, "querySelector"> | undefined = globalThis.document,
): boolean {
	if (event.defaultPrevented || isTyping(event.target)) return false;
	return !document?.querySelector('[aria-modal="true"]');
}

/** Whether this browser runs on a Mac (⌘ instead of Ctrl). */
export function isMac(): boolean {
	return /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");
}
