/**
 * The viewer's mode (V.2): browsing (a click selects, the pointer hovers, Escape clears), with
 * discovery bubbles first: a click on one opens it (zooms in) instead of selecting.
 */
import type { MapPoint, Mode } from "../mode.ts";
import { type BrowseOptions, browseMode } from "./browse.ts";

export interface ViewOptions<B>
	extends Pick<BrowseOptions, "hitTest" | "select" | "hover"> {
	/** The discovery bubble at a screen point, if any. */
	readonly bubbleAt: (point: { x: number; y: number }) => B | null;
	readonly openBubble: (bubble: B) => void;
}

export function viewMode<B>({
	bubbleAt,
	openBubble,
	...browse
}: ViewOptions<B>): Mode {
	const base = browseMode(browse);
	return {
		...base,
		name: "view",
		hover(at: MapPoint) {
			if (bubbleAt(at.point)) {
				browse.hover(null);
				return "pointer";
			}
			return base.hover?.(at) ?? "";
		},
		click(at: MapPoint) {
			const bubble = bubbleAt(at.point);
			if (bubble) openBubble(bubble);
			else base.click?.(at);
		},
	};
}
