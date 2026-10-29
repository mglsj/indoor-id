/**
 * Hands the map's pointer events and keys to the editing mode in force, as gestures: a click, a
 * hover (the cursor), or a drag the mode takes from a press. Pointer events: a mouse, a finger
 * or a pen, one pointer at a time (a second finger is the map's). A drag starts once the
 * pointer has moved 3 px, moves at most once per frame, ends on release (even off the map, the
 * pointer being captured) and swallows the click that follows; Escape cancels it. The only
 * listener on the map's pointer events.
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

/** MapLibre's handlers that move the map from a press, held while a mode takes one. */
type Handler = { isEnabled(): boolean; enable(): void; disable(): void };

/** A press a mode took. */
interface Press {
	readonly pointerId: number;
	readonly drag: Drag;
	readonly start: { x: number; y: number };
	dragging: boolean;
	last: MapPoint;
	/** A move waiting for the next frame. */
	pending: boolean;
	/** The map's handlers turned off for the press, turned on again after it. */
	readonly held: Handler[];
}

export class ModeManager {
	readonly #map: MapLibreMap;
	readonly #target: HTMLElement;
	readonly #requestFrame: (callback: FrameRequestCallback) => unknown;
	#mode: Mode = IDLE;
	#press: Press | null = null;
	/** The click following a drag's release is the release itself. */
	#swallowClick = false;

	constructor(map: MapLibreMap, options: ModeManagerOptions = {}) {
		this.#map = map;
		this.#target = map.getCanvasContainer();
		this.#requestFrame =
			options.requestFrame ??
			((callback) => globalThis.requestAnimationFrame(callback));
		map.on("click", this.#onClick);
		const target = this.#target;
		target.addEventListener("pointerdown", this.#onDown);
		target.addEventListener("pointermove", this.#onMove);
		target.addEventListener("pointerup", this.#onUp);
		target.addEventListener("pointercancel", this.#onCancel);
		target.addEventListener("pointerleave", this.#onLeave);
		// Released anywhere, should the capture not hold.
		globalThis.window?.addEventListener("pointerup", this.#onUp);
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

	/** Ends the mode's work as Escape would (a drag still going is cancelled). */
	finish(): void {
		this.#cancelDrag();
		this.#mode.finish?.();
	}

	remove(): void {
		this.setMode(IDLE);
		this.#map.off("click", this.#onClick);
		const target = this.#target;
		target.removeEventListener("pointerdown", this.#onDown);
		target.removeEventListener("pointermove", this.#onMove);
		target.removeEventListener("pointerup", this.#onUp);
		target.removeEventListener("pointercancel", this.#onCancel);
		target.removeEventListener("pointerleave", this.#onLeave);
		globalThis.window?.removeEventListener("pointerup", this.#onUp);
	}

	readonly #onClick = (event: MapMouseEvent) => {
		if (this.#swallowClick) {
			this.#swallowClick = false;
			return;
		}
		this.#mode.click?.(clickPoint(event));
	};

	readonly #onDown = (event: PointerEvent) => {
		// One pointer at a time; the primary button only (a pen's tip, a finger).
		if (this.#press || !event.isPrimary || event.button !== 0) return;
		this.#swallowClick = false;
		const at = this.#toPoint(event);
		const drag = this.#mode.press?.(at) ?? null;
		if (!drag) return;
		// Keep the map still: this press belongs to the mode. No mouse events follow it.
		event.preventDefault();
		const held = [this.#map.dragPan, this.#map.touchZoomRotate].filter(
			(handler) => handler.isEnabled(),
		);
		for (const handler of held) handler.disable();
		this.#target.setPointerCapture?.(event.pointerId);
		this.#press = {
			pointerId: event.pointerId,
			drag,
			start: at.point,
			dragging: false,
			last: at,
			pending: false,
			held,
		};
	};

	readonly #onMove = (event: PointerEvent) => {
		const press = this.#press;
		if (!press) {
			// A finger has nothing to hover.
			if (event.pointerType === "touch") return;
			this.#map.getCanvas().style.cursor =
				this.#mode.hover?.(this.#toPoint(event)) ?? "";
			return;
		}
		if (event.pointerId !== press.pointerId) return;
		const at = this.#toPoint(event);
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

	readonly #onUp = (event: PointerEvent) => {
		const press = this.#press;
		if (!press || event.pointerId !== press.pointerId) return;
		// Off the map (the window's listener), the last position on it.
		const at =
			event.currentTarget === this.#target ? this.#toPoint(event) : press.last;
		this.#release(at);
	};

	/** The browser took the pointer (a scroll, a system gesture): nothing should change. */
	readonly #onCancel = (event: PointerEvent) => {
		if (this.#press?.pointerId === event.pointerId) this.#cancelDrag();
	};

	#release(at: MapPoint): void {
		const press = this.#press;
		if (!press) return;
		this.#end(press);
		if (press.dragging) {
			this.#swallowClick = true;
			// The last move may still wait for its frame: the drag ends where released.
			press.drag.end(at);
		} else {
			press.drag.cancel();
		}
	}

	readonly #onLeave = (event: PointerEvent) => {
		if (this.#press || event.pointerType === "touch") return;
		// What the pointer hovered may change before it comes back (a plan locked with Done).
		this.#map.getCanvas().style.cursor = "";
		this.#mode.leave?.();
	};

	/** The press is over: the map's handlers come back, the pointer is let go. */
	#end(press: Press): void {
		this.#press = null;
		for (const handler of press.held) handler.enable();
		if (this.#target.hasPointerCapture?.(press.pointerId)) {
			this.#target.releasePointerCapture(press.pointerId);
		}
	}

	#toPoint(event: PointerEvent): MapPoint {
		const rect = this.#map.getCanvas().getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		const { lng, lat } = this.#map.unproject([x, y]);
		return {
			point: { x, y },
			lngLat: [lng, lat],
			shiftKey: event.shiftKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			altKey: event.altKey,
		};
	}

	#cancelDrag(): void {
		const press = this.#press;
		if (!press) return;
		this.#end(press);
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

function clickPoint(event: MapMouseEvent): MapPoint {
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
