/**
 * How the editor draws its working marks (A.4, the Map data pane): the grid's colour and
 * opacity, the colour of new construction guides, the selection's colour and the palette of
 * "Highlight changes", kept in this browser as the background settings are. The defaults are
 * visible on the light map (3:1 or more) and tell edit kinds apart by line style, not hue
 * alone; iD's palette stays available.
 */
import { INDOOR_COLORS } from "#lib/map/style/colors.ts";
import type { EditPalette } from "#lib/map/style/layers.ts";

const KEY = "indoorid.appearance";

export interface Appearance {
	/** The grid's lines, `#rrggbb`, and their opacities (0 to 1). */
	readonly gridColor: string;
	readonly gridMinorOpacity: number;
	readonly gridMajorOpacity: number;
	/** The colour new construction guides get. */
	readonly guideColor: string;
	/** The selection's core; its casing is white. */
	readonly selectionColor: string;
	/** The colours and line styles of "Highlight changes". */
	readonly editPalette: EditPalette;
}

export const DEFAULT_APPEARANCE: Appearance = {
	// Slate: no longer the guides' magenta. Minor lines 3.3:1, major 6.6:1 on the light map.
	gridColor: "#475569",
	gridMinorOpacity: 0.7,
	gridMajorOpacity: 1,
	guideColor: INDOOR_COLORS.guide,
	// Blue, 5.8:1 on the light map, over a white casing.
	selectionColor: INDOOR_COLORS.selection,
	editPalette: "indoorid",
};

const PALETTES: readonly EditPalette[] = ["indoorid", "id"];

export class AppearanceSettings {
	gridColor = $state(DEFAULT_APPEARANCE.gridColor);
	gridMinorOpacity = $state(DEFAULT_APPEARANCE.gridMinorOpacity);
	gridMajorOpacity = $state(DEFAULT_APPEARANCE.gridMajorOpacity);
	guideColor = $state(DEFAULT_APPEARANCE.guideColor);
	selectionColor = $state(DEFAULT_APPEARANCE.selectionColor);
	editPalette = $state<EditPalette>(DEFAULT_APPEARANCE.editPalette);
	readonly #storage: Storage | undefined;

	constructor(storage: Storage | undefined) {
		this.#storage = storage;
		const saved = read(storage);
		this.gridColor = saved.gridColor;
		this.gridMinorOpacity = saved.gridMinorOpacity;
		this.gridMajorOpacity = saved.gridMajorOpacity;
		this.guideColor = saved.guideColor;
		this.selectionColor = saved.selectionColor;
		this.editPalette = saved.editPalette;
	}

	/** Changes some settings, ignoring values that aren't valid, and saves them. */
	set(change: Partial<Appearance>): void {
		const next = valid({ ...this.current, ...change }, this.current);
		this.gridColor = next.gridColor;
		this.gridMinorOpacity = next.gridMinorOpacity;
		this.gridMajorOpacity = next.gridMajorOpacity;
		this.guideColor = next.guideColor;
		this.selectionColor = next.selectionColor;
		this.editPalette = next.editPalette;
		try {
			this.#storage?.setItem(KEY, JSON.stringify(next));
		} catch {
			// Storage full or blocked: the settings hold for this page.
		}
	}

	/** Back to the defaults. */
	reset(): void {
		this.set(DEFAULT_APPEARANCE);
	}

	get current(): Appearance {
		return {
			gridColor: this.gridColor,
			gridMinorOpacity: this.gridMinorOpacity,
			gridMajorOpacity: this.gridMajorOpacity,
			guideColor: this.guideColor,
			selectionColor: this.selectionColor,
			editPalette: this.editPalette,
		};
	}
}

const isColor = (value: unknown): value is string =>
	typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

const isOpacity = (value: unknown): value is number =>
	typeof value === "number" && value >= 0 && value <= 1;

/** `appearance` with each invalid value replaced by `fallback`'s. */
function valid(
	appearance: Partial<Appearance>,
	fallback: Appearance,
): Appearance {
	return {
		gridColor: isColor(appearance.gridColor)
			? appearance.gridColor.toLowerCase()
			: fallback.gridColor,
		gridMinorOpacity: isOpacity(appearance.gridMinorOpacity)
			? appearance.gridMinorOpacity
			: fallback.gridMinorOpacity,
		gridMajorOpacity: isOpacity(appearance.gridMajorOpacity)
			? appearance.gridMajorOpacity
			: fallback.gridMajorOpacity,
		guideColor: isColor(appearance.guideColor)
			? appearance.guideColor.toLowerCase()
			: fallback.guideColor,
		selectionColor: isColor(appearance.selectionColor)
			? appearance.selectionColor.toLowerCase()
			: fallback.selectionColor,
		editPalette: PALETTES.includes(appearance.editPalette as EditPalette)
			? (appearance.editPalette as EditPalette)
			: fallback.editPalette,
	};
}

function read(storage: Storage | undefined): Appearance {
	try {
		const raw = storage?.getItem(KEY);
		if (!raw) return DEFAULT_APPEARANCE;
		return valid(JSON.parse(raw) as Partial<Appearance>, DEFAULT_APPEARANCE);
	} catch {
		return DEFAULT_APPEARANCE;
	}
}
