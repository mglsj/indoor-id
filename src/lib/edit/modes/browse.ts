/**
 * Browsing the map: a click selects the feature under it (or clears the selection), the
 * feature under the pointer is hovered and the cursor shows it can be selected, Escape clears
 * the selection.
 */
import type { Mode } from "../mode.ts";

export interface BrowseOptions {
	/** The feature drawn at a screen point, topmost first, if any. */
	readonly hitTest: (point: { x: number; y: number }) => string | null;
	readonly select: (id: string | null) => void;
	/** The feature under the pointer, or null. */
	readonly hover: (id: string | null) => void;
}

export function browseMode({ hitTest, select, hover }: BrowseOptions): Mode {
	return {
		name: "browse",
		hover(at) {
			const id = hitTest(at.point);
			hover(id);
			return id ? "pointer" : "";
		},
		leave: () => hover(null),
		exit: () => hover(null),
		click: (at) => select(hitTest(at.point)),
		key(event) {
			if (event.key !== "Escape") return false;
			select(null);
			return true;
		},
	};
}
