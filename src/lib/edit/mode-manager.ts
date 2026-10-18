/**
 * Hands the map's pointer events and keys to the editing mode in force, as gestures: a click, a
 * hover (the cursor), or a drag the mode takes from a press. A drag starts once the pointer has
 * moved 3 px, moves at most once per frame, ends on release (even off the map) and swallows the
 * click that follows; Escape cancels it. The only listener on the map's pointer events.
 */
import type { Map as MapLibreMap, MapMouseEvent } from "#lib/map/maplibre.ts";
import type { Drag, MapGestures, MapPoint, Mode } from "./mode.ts";

/** How far the pointer moves before a press becomes a drag, in pixels. */
const DRAG_THRESHOLD = 3;

const IDLE: Mode = { name: "idle" };

export interface ModeManagerOptions {
	/** Schedules a callback for the next frame (tests run frames themselves). */
	readonly requestFrame?: (callback: FrameRequestCallback) => unknown;
}

export class ModeManager {
	readonly #map: MapLibreMap;
	readonly #requestFrame: (callback: FrameRequestCallback) => unknown;
	#mode: Mode = IDLE;
	#press: {
		drag: Drag;
		start: { x: number; y: number };
		dragging: boolean;
		last: MapPoint;
		/** A move waiting for the next frame. */
		pending: boolean;
	} | null = null;
	/** The click following a drag's release is the release itself. */
	#swallowClick = false;

	constructor(map: MapLibreMap, options: ModeManagerOptions = {}) {
		this.#map = map;
		this.#requestFrame =
			options.requestFrame ??
			((callback) => globalThis.requestAnimationFrame(callback));
		map.on("click", this.#onClick);
		map.on("mousedown", this.#onDown);
		map.on("mousemove", this.#onMove);
		map.on("mouseup", this.#onUp);
		map.on("mouseout", this.#onLeave);
		// Released anywhere, even off the map.
		globalThis.window?.addEventListener("mouseup", this.#onWindowUp);
	}

	get mode(): Mode {
		return this.#mode;
	}

	/** Leaves the mode in force for `mode` (a drag still going is cancelled). */
	setMode(mode: Mode): void {
		this.#cancelDrag();
		this.#mode.exit?.();
		this.#mode = mode;
		this.#applyGestures(mode.gestures ?? {});
		this.#map.getCanvas().style.cursor = "";
		mode.enter?.();
	}

	/** A key pressed while the map's shortcuts apply (not while typing); true when handled. */
	key(event: KeyboardEvent): boolean {
		if (event.key === "Escape" && this.#press?.dragging) {
			this.#cancelDrag();
			return true;
		}
		return this.#mode.key?.(event) ?? false;
	}

	remove(): void {
		this.setMode(IDLE);
		const map = this.#map;
		map.off("click", this.#onClick);
		map.off("mousedown", this.#onDown);
		map.off("mousemove", this.#onMove);
		map.off("mouseup", this.#onUp);
		map.off("mouseout", this.#onLeave);
		globalThis.window?.removeEventListener("mouseup", this.#onWindowUp);
	}

	readonly #onClick = (event: MapMouseEvent) => {
		if (this.#swallowClick) {
			this.#swallowClick = false;
			return;
		}
		this.#mode.click?.(toPoint(event));
	};

	readonly #onDown = (event: MapMouseEvent) => {
		if (event.originalEvent.button !== 0) return;
		this.#swallowClick = false;
		const at = toPoint(event);
		const drag = this.#mode.press?.(at) ?? null;
		if (!drag) return;
		// Keep the map still: this press belongs to the mode.
		event.preventDefault();
		this.#press = {
			drag,
			start: at.point,
			dragging: false,
			last: at,
			pending: false,
		};
	};

	readonly #onMove = (event: MapMouseEvent) => {
		const at = toPoint(event);
		const press = this.#press;
		if (!press) {
			this.#map.getCanvas().style.cursor = this.#mode.hover?.(at) ?? "";
			return;
		}
		press.last = at;
		if (!press.dragging) {
			const moved = Math.hypot(
				at.point.x - press.start.x,
				at.point.y - press.start.y,
			);
			if (moved < DRAG_THRESHOLD) return;
			press.dragging = true;
			if (press.drag.cursor) {
				this.#map.getCanvas().style.cursor = press.drag.cursor;
			}
		}
		if (press.pending) return;
		press.pending = true;
		this.#requestFrame(() => {
			if (this.#press !== press || !press.dragging) return;
			press.pending = false;
			press.drag.move(press.last);
		});
	};

	readonly #onUp = (event: MapMouseEvent) => this.#release(toPoint(event));

	readonly #onWindowUp = () => {
		if (this.#press) this.#release(this.#press.last);
	};

	#release(at: MapPoint): void {
		const press = this.#press;
		if (!press) return;
		this.#press = null;
		if (press.dragging) {
			this.#swallowClick = true;
			press.drag.end(at);
		} else {
			press.drag.cancel();
		}
	}

	readonly #onLeave = () => {
		if (this.#press) return;
		// What the pointer hovered may change before it comes back (a plan locked with Done).
		this.#map.getCanvas().style.cursor = "";
		this.#mode.leave?.();
	};

	#cancelDrag(): void {
		const press = this.#press;
		if (!press) return;
		this.#press = null;
		press.drag.cancel();
	}

	#applyGestures(gestures: MapGestures): void {
		const map = this.#map;
		const set = (handler: { enable(): void; disable(): void }, on = true) =>
			on ? handler.enable() : handler.disable();
		set(map.doubleClickZoom, gestures.doubleClickZoom);
		set(map.boxZoom, gestures.boxZoom);
		set(map.dragRotate, gestures.dragRotate);
	}
}

function toPoint(event: MapMouseEvent): MapPoint {
	const { shiftKey, ctrlKey, metaKey, altKey } = event.originalEvent;
	return {
		point: { x: event.point.x, y: event.point.y },
		lngLat: [event.lngLat.lng, event.lngLat.lat],
		shiftKey,
		ctrlKey,
		metaKey,
		altKey,
	};
}
