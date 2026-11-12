/**
 * Precision settings (C.0): whether snapping is on (`S`), which kinds of snap, the angle step,
 * and the units lengths are shown and typed in. Kept in this browser's storage, as the
 * background is. Frames and guides, which belong to buildings, are kept with the floor plans.
 */
import { getContext, setContext } from "svelte";
import { defaultUnits, type Units } from "#lib/units/length.ts";

const KEY = "indoorid.precision";

/** Angle steps offered, in degrees: 90 is CAD's Ortho. */
export const ANGLE_STEPS = [5, 10, 15, 22.5, 30, 45, 90] as const;

/** Kinds of snap the user can turn off one by one. */
export type SnapOption =
	| "points"
	| "midpoints"
	| "planVertices"
	| "angles"
	| "grid";
export const SNAP_OPTIONS: readonly SnapOption[] = [
	"points",
	"midpoints",
	"planVertices",
	"angles",
	"grid",
];

interface Saved {
	enabled: boolean;
	grid: boolean;
	gridMinor: number;
	gridMajor: number;
	options: Record<SnapOption, boolean>;
	angleStep: number;
	units: Units;
}

export class PrecisionSettings {
	/** All snapping on or off (`S`); Alt held suspends it for the moment. */
	enabled = $state(true);
	options = $state<Record<SnapOption, boolean>>({
		points: true,
		midpoints: true,
		planVertices: true,
		angles: true,
		grid: true,
	});
	angleStep = $state(15);
	units = $state<Units>("metric");
	/** The grid shown (`G`), and its spacing in metres (C.3). */
	grid = $state(false);
	gridMinor = $state(0.5);
	gridMajor = $state(5);
	readonly #storage: Storage | undefined;

	constructor(storage: Storage | undefined, locale = "en-GB") {
		this.#storage = storage;
		this.units = defaultUnits(locale);
		const saved = read(storage);
		if (saved) {
			this.enabled = saved.enabled ?? this.enabled;
			this.options = { ...this.options, ...saved.options };
			if (ANGLE_STEPS.includes(saved.angleStep as never))
				this.angleStep = saved.angleStep as number;
			if (saved.units === "metric" || saved.units === "imperial")
				this.units = saved.units;
			if (typeof saved.grid === "boolean") this.grid = saved.grid;
			if (validSpacing(saved.gridMinor, saved.gridMajor)) {
				this.gridMinor = saved.gridMinor as number;
				this.gridMajor = saved.gridMajor as number;
			}
		}
	}

	/** Whether a kind of snap applies now (snapping on, and that kind on). */
	snaps(option: SnapOption): boolean {
		return this.enabled && this.options[option];
	}

	/** The angle step in force, or null without angle snapping. */
	get step(): number | null {
		return this.snaps("angles") ? this.angleStep : null;
	}

	toggle() {
		this.enabled = !this.enabled;
		this.#save();
	}

	setOption(option: SnapOption, on: boolean) {
		this.options = { ...this.options, [option]: on };
		// Turning a kind on means snapping is wanted.
		if (on) this.enabled = true;
		this.#save();
	}

	setAngleStep(step: number) {
		if (!ANGLE_STEPS.includes(step as never)) return;
		this.angleStep = step;
		this.#save();
	}

	toggleGrid() {
		this.grid = !this.grid;
		this.#save();
	}

	/** Sets the grid's spacing; false (and nothing changed) unless major ≥ minor > 0. */
	setGridSpacing(minor: number, major: number): boolean {
		if (!validSpacing(minor, major)) return false;
		this.gridMinor = minor;
		this.gridMajor = major;
		this.#save();
		return true;
	}

	setUnits(units: Units) {
		this.units = units;
		this.#save();
	}

	#save() {
		const saved: Saved = {
			enabled: this.enabled,
			grid: this.grid,
			gridMinor: this.gridMinor,
			gridMajor: this.gridMajor,
			options: this.options,
			angleStep: this.angleStep,
			units: this.units,
		};
		try {
			this.#storage?.setItem(KEY, JSON.stringify(saved));
		} catch {
			// Blocked storage: kept for this page only.
		}
	}
}

function read(storage: Storage | undefined): Partial<Saved> | null {
	try {
		const raw = storage?.getItem(KEY);
		if (!raw) return null;
		const saved = JSON.parse(raw) as Partial<Saved>;
		const options: Partial<Record<SnapOption, boolean>> = {};
		for (const option of SNAP_OPTIONS) {
			const value = saved.options?.[option];
			if (typeof value === "boolean") options[option] = value;
		}
		return {
			enabled: typeof saved.enabled === "boolean" ? saved.enabled : undefined,
			options: options as Record<SnapOption, boolean>,
			angleStep: saved.angleStep,
			units: saved.units,
			grid: saved.grid,
			gridMinor: saved.gridMinor,
			gridMajor: saved.gridMajor,
		};
	} catch {
		return null;
	}
}

function validSpacing(minor: unknown, major: unknown): boolean {
	return (
		typeof minor === "number" &&
		typeof major === "number" &&
		Number.isFinite(minor) &&
		Number.isFinite(major) &&
		minor >= 0.01 &&
		major >= minor
	);
}

const CONTEXT = Symbol("precision");

/** Makes `settings` available to the components below with `getPrecision()`. */
export function setPrecision(settings: PrecisionSettings): PrecisionSettings {
	return setContext(CONTEXT, settings);
}

/** The precision settings of the page, or defaults where none were set (component tests). */
export function getPrecision(): PrecisionSettings {
	return (
		getContext<PrecisionSettings | undefined>(CONTEXT) ??
		new PrecisionSettings(undefined)
	);
}
