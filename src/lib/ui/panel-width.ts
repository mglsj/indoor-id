/**
 * The side panel's width, set by dragging its edge: kept between a readable minimum and a
 * share of the window that leaves the map usable, and remembered in this browser.
 */

/** The width the panel opens at (22rem). */
export const DEFAULT_WIDTH = 352;
/** Narrower than this, fields and the tag table no longer fit. */
export const MIN_WIDTH = 280;
/** The share of the window the panel may take at most. */
export const MAX_SHARE = 0.6;
/** The map kept visible beside the panel on a narrow screen (2rem). */
const MAP_MARGIN = 32;
/** How far an arrow key moves the edge. */
export const KEY_STEP = 16;

const STORAGE_KEY = "indoorid.side-panel-width";

export interface WidthBounds {
	readonly min: number;
	readonly max: number;
}

/** The widths the panel may take in a window `viewport` pixels wide. */
export function widthBounds(viewport: number): WidthBounds {
	// On a narrow screen the panel takes what it can, leaving a strip of map.
	const limit = Math.max(0, viewport - MAP_MARGIN);
	return {
		min: Math.min(MIN_WIDTH, limit),
		max: Math.min(limit, Math.max(MIN_WIDTH, Math.round(viewport * MAX_SHARE))),
	};
}

/** `width` kept within the bounds, in whole pixels. */
export function clampWidth(width: number, bounds: WidthBounds): number {
	return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
}

/** The width a key gives, as a window splitter's: arrows step, Home and End go to the ends. */
export function widthForKey(
	key: string,
	width: number,
	bounds: WidthBounds,
): number | undefined {
	switch (key) {
		case "ArrowLeft":
			return clampWidth(width - KEY_STEP, bounds);
		case "ArrowRight":
			return clampWidth(width + KEY_STEP, bounds);
		case "Home":
			return bounds.min;
		case "End":
			return bounds.max;
		default:
			return undefined;
	}
}

/** The width chosen last time, or the default. */
export function rememberedWidth(storage: Pick<Storage, "getItem">): number {
	try {
		const width = Number(storage.getItem(STORAGE_KEY));
		return Number.isFinite(width) && width > 0 ? width : DEFAULT_WIDTH;
	} catch {
		return DEFAULT_WIDTH;
	}
}

/** Remembers `width`; the default is forgotten, so a later default applies. */
export function rememberWidth(
	storage: Pick<Storage, "setItem" | "removeItem">,
	width: number,
): void {
	try {
		if (width === DEFAULT_WIDTH) storage.removeItem(STORAGE_KEY);
		else storage.setItem(STORAGE_KEY, String(width));
	} catch {
		// Not remembered, but still resized.
	}
}
