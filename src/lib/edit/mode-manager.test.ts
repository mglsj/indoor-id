import { describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "#lib/map/maplibre.ts";
import type { Drag, MapPoint, Mode } from "./mode.ts";
import { ModeManager } from "./mode-manager.ts";

type Listener = (event: unknown) => void;

/** The DOM event each test name stands for. */
const POINTER: Record<string, string> = {
	mousedown: "pointerdown",
	mousemove: "pointermove",
	mouseup: "pointerup",
	mouseout: "pointerleave",
};

/**
 * A map stand-in: fires pointer events on its container (and clicks on the map), records
 * gestures, cursor and pointer capture.
 */
function fakeMap() {
	const listeners = new Map<string, Set<Listener>>();
	const domListeners = new Map<string, Set<Listener>>();
	const gesture = () => {
		const state = { on: true };
		return {
			state,
			isEnabled: () => state.on,
			enable: () => {
				state.on = true;
			},
			disable: () => {
				state.on = false;
			},
		};
	};
	const captured = new Set<number>();
	const container = {
		addEventListener: (type: string, listener: Listener) => {
			const set = domListeners.get(type) ?? new Set();
			set.add(listener);
			domListeners.set(type, set);
		},
		removeEventListener: (type: string, listener: Listener) =>
			domListeners.get(type)?.delete(listener),
		setPointerCapture: (id: number) => captured.add(id),
		hasPointerCapture: (id: number) => captured.has(id),
		releasePointerCapture: (id: number) => captured.delete(id),
	};
	const canvas = {
		style: { cursor: "" },
		getBoundingClientRect: () => ({ left: 100, top: 50 }),
	};
	const map = {
		on: (type: string, listener: Listener) => {
			const set = listeners.get(type) ?? new Set();
			set.add(listener);
			listeners.set(type, set);
		},
		off: (type: string, listener: Listener) =>
			listeners.get(type)?.delete(listener),
		getCanvas: () => canvas,
		getCanvasContainer: () => container,
		unproject: ([x, y]: [number, number]) => ({ lng: x / 10, lat: y / 10 }),
		doubleClickZoom: gesture(),
		boxZoom: gesture(),
		dragRotate: gesture(),
		dragPan: gesture(),
		touchZoomRotate: gesture(),
	};
	const modifiers = {
		button: 0,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
	};
	/** Fires `type` at map pixel x, y: a pointer event (as a mouse by default) or a click. */
	const fire = (type: string, x = 0, y = 0, extra: object = {}) => {
		let prevented = false;
		const preventDefault = () => (prevented = true);
		if (type === "click") {
			const event = {
				point: { x, y },
				lngLat: { lng: x / 10, lat: y / 10 },
				originalEvent: { ...modifiers, ...extra },
				preventDefault,
			};
			for (const listener of listeners.get(type) ?? []) listener(event);
			return { prevented };
		}
		const event = {
			type: POINTER[type] ?? type,
			clientX: x + 100,
			clientY: y + 50,
			pointerId: 1,
			pointerType: "mouse",
			isPrimary: true,
			currentTarget: container,
			...modifiers,
			...extra,
			preventDefault,
		};
		for (const listener of domListeners.get(event.type) ?? []) listener(event);
		return { prevented };
	};
	return {
		map: map as unknown as MapLibreMap,
		fire,
		canvas,
		raw: map,
		captured,
	};
}

/** Runs the frame callbacks queued so far. */
function frames() {
	const queue: FrameRequestCallback[] = [];
	return {
		request: (callback: FrameRequestCallback) => queue.push(callback),
		flush: () => {
			for (const callback of queue.splice(0)) callback(0);
		},
	};
}

function recordingDrag() {
	const log: string[] = [];
	const drag: Drag = {
		cursor: "move",
		move: (at: MapPoint) => log.push(`move ${at.point.x},${at.point.y}`),
		end: (at: MapPoint) => log.push(`end ${at.point.x},${at.point.y}`),
		cancel: () => log.push("cancel"),
	};
	return { drag, log };
}

function setup(mode: Mode) {
	const fake = fakeMap();
	const raf = frames();
	const manager = new ModeManager(fake.map, { requestFrame: raf.request });
	manager.setMode(mode);
	return { ...fake, raf, manager };
}

describe("ModeManager", () => {
	it("hands clicks to the mode, with the map position", () => {
		const click = vi.fn();
		const { fire } = setup({ name: "test", click });
		fire("click", 30, 40);
		expect(click).toHaveBeenCalledOnce();
		expect(click.mock.calls[0]?.[0]).toMatchObject({
			point: { x: 30, y: 40 },
			lngLat: [3, 4],
		});
	});

	it("leaves the map to pan when the mode takes no drag", () => {
		const { fire } = setup({ name: "test", press: () => null });
		expect(fire("mousedown").prevented).toBe(false);
	});

	it("starts a drag only past 3 px, once per frame, and swallows the click after it", () => {
		const { drag, log } = recordingDrag();
		const click = vi.fn();
		const { fire, raf, canvas } = setup({
			name: "test",
			press: () => drag,
			click,
		});
		expect(fire("mousedown", 10, 10).prevented).toBe(true);
		fire("mousemove", 11, 11);
		raf.flush();
		expect(log).toEqual([]);
		fire("mousemove", 14, 10);
		fire("mousemove", 20, 10);
		raf.flush();
		expect(log).toEqual(["move 20,10"]);
		expect(canvas.style.cursor).toBe("move");
		fire("mouseup", 21, 10);
		expect(log).toEqual(["move 20,10", "end 21,10"]);
		fire("click", 21, 10);
		expect(click).not.toHaveBeenCalled();
		// The next click is a click again.
		fire("click", 21, 10);
		expect(click).toHaveBeenCalledOnce();
	});

	it("cancels a press released without moving, and lets its click through", () => {
		const { drag, log } = recordingDrag();
		const click = vi.fn();
		const { fire } = setup({ name: "test", press: () => drag, click });
		fire("mousedown", 10, 10);
		fire("mouseup", 10, 10);
		fire("click", 10, 10);
		expect(log).toEqual(["cancel"]);
		expect(click).toHaveBeenCalledOnce();
	});

	it("cancels a drag on Escape, before the mode sees the key", () => {
		const { drag, log } = recordingDrag();
		const key = vi.fn(() => true);
		const { fire, raf, manager } = setup({
			name: "test",
			press: () => drag,
			key,
		});
		fire("mousedown", 10, 10);
		fire("mousemove", 30, 10);
		raf.flush();
		expect(manager.key({ key: "Escape" } as KeyboardEvent)).toBe(true);
		expect(log).toEqual(["move 30,10", "cancel"]);
		expect(key).not.toHaveBeenCalled();
		fire("mouseup", 30, 10);
		expect(log).toEqual(["move 30,10", "cancel"]);
	});

	it("shows the mode's cursor while hovering, and the map's own outside", () => {
		const { fire, canvas } = setup({
			name: "test",
			hover: (at) => (at.point.x > 50 ? "pointer" : ""),
		});
		fire("mousemove", 60, 0);
		expect(canvas.style.cursor).toBe("pointer");
		fire("mousemove", 10, 0);
		expect(canvas.style.cursor).toBe("");
	});

	it("drops the hover cursor when the pointer leaves the map, and tells the mode", () => {
		const leave = vi.fn();
		const { fire, canvas } = setup({
			name: "test",
			hover: () => "move",
			leave,
		});
		fire("mousemove", 60, 0);
		fire("mouseout");
		expect(canvas.style.cursor).toBe("");
		expect(leave).toHaveBeenCalledOnce();
	});

	it("enters and exits modes, and turns MapLibre's gestures off and on for them", () => {
		const log: string[] = [];
		const { manager, raw } = setup({
			name: "first",
			exit: () => log.push("exit first"),
		});
		manager.setMode({
			name: "second",
			gestures: { doubleClickZoom: false, boxZoom: false },
			enter: () => log.push("enter second"),
		});
		expect(log).toEqual(["exit first", "enter second"]);
		expect(manager.mode.name).toBe("second");
		expect(raw.doubleClickZoom.state.on).toBe(false);
		expect(raw.boxZoom.state.on).toBe(false);
		expect(raw.dragRotate.state.on).toBe(true);
		manager.setMode({ name: "third" });
		expect(raw.doubleClickZoom.state.on).toBe(true);
	});

	it("cancels a drag still going when the mode changes", () => {
		const { drag, log } = recordingDrag();
		const { fire, raf, manager } = setup({ name: "test", press: () => drag });
		fire("mousedown", 10, 10);
		fire("mousemove", 30, 10);
		raf.flush();
		manager.setMode({ name: "other" });
		expect(log).toEqual(["move 30,10", "cancel"]);
	});

	it("takes a finger's or a pen's press too, holding the map still and capturing the pointer", () => {
		const { drag, log } = recordingDrag();
		const { fire, raf, raw, captured } = setup({
			name: "test",
			press: () => drag,
		});
		const touch = { pointerType: "touch", pointerId: 7 };
		expect(fire("pointerdown", 10, 10, touch).prevented).toBe(true);
		expect(raw.dragPan.state.on).toBe(false);
		expect(raw.touchZoomRotate.state.on).toBe(false);
		expect(captured.has(7)).toBe(true);
		fire("pointermove", 30, 10, touch);
		raf.flush();
		fire("pointerup", 32, 12, touch);
		expect(log).toEqual(["move 30,10", "end 32,12"]);
		expect(raw.dragPan.state.on).toBe(true);
		expect(raw.touchZoomRotate.state.on).toBe(true);
		expect(captured.has(7)).toBe(false);
	});

	it("follows one pointer at a time", () => {
		const { drag, log } = recordingDrag();
		const press = vi.fn(() => drag);
		const { fire, raf } = setup({ name: "test", press });
		fire("pointerdown", 10, 10, { pointerType: "touch", pointerId: 1 });
		const second = { pointerType: "touch", pointerId: 2, isPrimary: false };
		expect(fire("pointerdown", 50, 50, second).prevented).toBe(false);
		fire("pointermove", 90, 90, second);
		fire("pointerup", 90, 90, second);
		raf.flush();
		expect(press).toHaveBeenCalledOnce();
		expect(log).toEqual([]);
	});

	it("ends a drag where it is released, even before its last move's frame", () => {
		const { drag, log } = recordingDrag();
		const { fire } = setup({ name: "test", press: () => drag });
		fire("mousedown", 10, 10);
		fire("mousemove", 30, 10);
		fire("mouseup", 40, 10);
		expect(log).toEqual(["end 40,10"]);
	});

	it("cancels a press the browser takes over (pointercancel)", () => {
		const { drag, log } = recordingDrag();
		const { fire, raf, raw } = setup({ name: "test", press: () => drag });
		fire("pointerdown", 10, 10, { pointerType: "touch" });
		fire("pointermove", 30, 10, { pointerType: "touch" });
		raf.flush();
		fire("pointercancel", 30, 10, { pointerType: "touch" });
		expect(log).toEqual(["move 30,10", "cancel"]);
		expect(raw.dragPan.state.on).toBe(true);
	});
});
