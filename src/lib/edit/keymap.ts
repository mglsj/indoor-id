/**
 * The editor's keyboard shortcuts in one place (P6): the keys the map listens to
 * (`MAP_KEYS`, run by `EditorView`), the keys of a drawing (`DRAWING_KEYS`, the modes'), and
 * the operations' own (`OPERATIONS`). The shortcuts help (`?`, `ui/ShortcutsDialog.svelte`)
 * lists them from here, so it can't drift from what the keys do. Pure.
 */
import { type Message, msg } from "#lib/i18n/messages.ts";
import { OPERATIONS } from "./operations.ts";

/** What a map key does; `EditorView` runs it. */
export type MapAction =
	| "draw-point"
	| "draw-line"
	| "draw-area"
	| "draw-rectangle"
	| "draw-split"
	| "draw-measure"
	| "toggle-snapping"
	| "toggle-grid"
	| "toggle-wireframe"
	| "zoom-to-selection"
	| "swap-background"
	| "undo"
	| "redo"
	| "help";

export interface KeyEntry<A = string> {
	/** As `matches` reads it: `Mod+Shift+Z`. */
	readonly combo: string;
	/** More combos doing the same, not listed separately in the help. */
	readonly also?: readonly string[];
	readonly action: A;
	readonly label: Message;
}

/** Keys that apply in every mode but floor plan mode. */
export const MAP_KEYS: readonly KeyEntry<MapAction>[] = [
	{ combo: "1", action: "draw-point", label: msg("key_draw_point") },
	{ combo: "2", action: "draw-line", label: msg("key_draw_line") },
	{ combo: "3", action: "draw-area", label: msg("key_draw_area") },
	{ combo: "4", action: "draw-rectangle", label: msg("key_draw_rectangle") },
	{ combo: "X", action: "draw-split", label: msg("key_draw_split") },
	{ combo: "M", action: "draw-measure", label: msg("key_draw_measure") },
	{ combo: "S", action: "toggle-snapping", label: msg("key_snapping") },
	{ combo: "G", action: "toggle-grid", label: msg("key_grid") },
	{ combo: "W", action: "toggle-wireframe", label: msg("key_wireframe") },
	{ combo: "Z", action: "zoom-to-selection", label: msg("key_zoom") },
	{ combo: "Mod+B", action: "swap-background", label: msg("key_background") },
	{ combo: "Mod+Z", action: "undo", label: msg("key_undo") },
	{
		combo: "Mod+Shift+Z",
		also: ["Mod+Y"],
		action: "redo",
		label: msg("key_redo"),
	},
	{ combo: "?", also: ["Shift+?"], action: "help", label: msg("key_help") },
];

/** Keys while drawing a line or an area (`edit/modes/draw.ts`), shown in the help only. */
export const DRAWING_KEYS: readonly KeyEntry[] = [
	{ combo: "Enter", action: "finish", label: msg("key_finish") },
	{ combo: "Backspace", action: "undo-corner", label: msg("key_undo_corner") },
	{ combo: "Escape", action: "stop", label: msg("key_stop") },
	{ combo: "Tab", action: "angle", label: msg("key_angle") },
	{ combo: "Shift", action: "lock", label: msg("key_lock") },
	{ combo: "Alt", action: "no-snap", label: msg("key_no_snap") },
	{ combo: "T", action: "trace", label: msg("key_trace") },
];

/** Keys on the selection: the operations', and moving it with the arrows. */
export const SELECTION_KEYS: readonly KeyEntry[] = [
	// Split has no key of its own: the split tool's X is listed with the map's keys.
	...OPERATIONS.filter((o) => o.keys.length > 0).map((o) => ({
		combo: o.keys[0] ?? "",
		also: o.keys.slice(1),
		action: o.id,
		label: o.label,
	})),
	{ combo: "Arrows", action: "nudge", label: msg("key_nudge") },
	{ combo: "Escape", action: "deselect", label: msg("key_deselect") },
];

export interface KeyGroup {
	readonly title: Message;
	readonly keys: readonly KeyEntry[];
}

/** The help's groups, in order. */
export const KEY_GROUPS: readonly KeyGroup[] = [
	{ title: msg("keys_map"), keys: MAP_KEYS },
	{ title: msg("keys_selection"), keys: SELECTION_KEYS },
	{ title: msg("keys_drawing"), keys: DRAWING_KEYS },
];

/** The map key `combo`s match, if any. */
export function mapKeyFor(
	matchesCombo: (combo: string) => boolean,
): KeyEntry<MapAction> | undefined {
	return MAP_KEYS.find(
		(k) => matchesCombo(k.combo) || (k.also ?? []).some(matchesCombo),
	);
}
