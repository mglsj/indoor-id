import { describe, expect, it, vi } from "vitest";
import type { Mode } from "#lib/edit/mode.ts";
import {
	type ModeHost,
	type ModeKind,
	modeFor,
	modeKindOf,
} from "#lib/edit/mode-factory.ts";
import { Graph } from "#lib/osm/graph.ts";
import { EditHistory } from "#lib/state/edit-history.svelte.ts";
import type { FloorPlans } from "#lib/state/floorplans.svelte.ts";

const NONE = {
	planMode: false,
	planTool: false,
	framePick: null,
	transformTool: null,
	drawing: null,
} as const;

describe("modeKindOf", () => {
	it("browses when nothing is on", () => {
		expect(modeKindOf(NONE)).toBe("browse");
	});

	it("names the drawing tool on", () => {
		expect(modeKindOf({ ...NONE, drawing: "area" })).toBe("draw-area");
		expect(modeKindOf({ ...NONE, drawing: "split" })).toBe("draw-split");
	});

	it("puts a transform tool before a drawing", () => {
		expect(
			modeKindOf({ ...NONE, drawing: "line", transformTool: "rotate" }),
		).toBe("transform-rotate");
	});

	it("puts picking a frame before a transform tool", () => {
		expect(
			modeKindOf({ ...NONE, transformTool: "move", framePick: "origin" }),
		).toBe("frame-origin");
	});

	it("puts floor plan mode first, its tool when one is on", () => {
		const all = {
			planMode: true,
			planTool: false,
			framePick: "align",
			transformTool: "move",
			drawing: "point",
		} as const;
		expect(modeKindOf(all)).toBe("floorplan");
		expect(modeKindOf({ ...all, planTool: true })).toBe("floorplan-tool");
	});

	it("ignores a plan tool outside floor plan mode", () => {
		expect(modeKindOf({ ...NONE, planTool: true })).toBe("browse");
	});
});

function host(overrides: Partial<ModeHost> = {}): ModeHost {
	const noop = () => {};
	return {
		history: new EditHistory(Graph.fromEntities([])),
		level: () => 0,
		snap: () => null,
		precision: {
			frameAt: () => ({ angle: 0, origin: [0, 0] }),
			step: () => null,
			units: () => "metric",
			show: noop,
		} as unknown as ModeHost["precision"],
		inferences: undefined,
		typed: true,
		guides: () => [],
		ondrawn: noop,
		ondrawing: noop,
		tracing: { on: () => false, toggle: noop, path: () => null },
		browse: () => ({ hitTest: () => null, select: noop, hover: noop }),
		transform: () => ({ ids: [], nodes: new Set(), onfinish: noop }),
		measure: () => ({
			variant: "measure",
			onvariant: noop,
			onguide: noop,
			onexit: noop,
		}),
		onmeasure: noop,
		onrectangle: noop,
		framePick: () => ({
			snapSide: () => null,
			onangle: noop,
			onorigin: noop,
			ondone: noop,
		}),
		split: () => ({ onchange: noop, onfinish: noop }),
		floorplan: () => ({
			map: {} as never,
			floorplans: {} as FloorPlans,
			close: noop,
		}),
		floorplanTool: () => ({
			floorplans: {} as FloorPlans,
			snap: (_point, lngLat) => lngLat,
			onmessage: noop,
			onpointer: noop,
		}),
		...overrides,
	};
}

describe("modeFor", () => {
	it.each<[ModeKind, string]>([
		["browse", "browse"],
		["draw-point", "draw-point"],
		["draw-line", "draw-line"],
		["draw-area", "draw-area"],
		["draw-rectangle", "draw-rectangle"],
		["draw-split", "split"],
		["draw-measure", "measure-measure"],
		["transform-move", "transform-move"],
		["transform-offset", "transform-offset"],
		["frame-align", "frame-align"],
		["frame-origin", "frame-origin"],
		["floorplan", "floorplan"],
		["floorplan-tool", "floorplan-tool"],
	])("starts %s as the %s mode", (kind, name) => {
		expect(modeFor(kind, host()).name).toBe(name);
	});

	it("builds only the options of the mode started", () => {
		const browse = vi.fn(host().browse);
		const split = vi.fn(host().split);
		modeFor("draw-split", host({ browse, split }));
		expect(split).toHaveBeenCalledOnce();
		expect(browse).not.toHaveBeenCalled();
	});

	it("hands the measure tool over, for the toolbar's switch", () => {
		let measure: Mode | undefined;
		const mode = modeFor(
			"draw-measure",
			host({ onmeasure: (tool) => (measure = tool) }),
		);
		expect(measure).toBe(mode);
	});

	it("reads the level once, when the mode starts", () => {
		const level = vi.fn(() => 2);
		modeFor("draw-point", host({ level }));
		modeFor("browse", host({ level }));
		expect(level).toHaveBeenCalledOnce();
	});
});
