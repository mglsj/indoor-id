/**
 * The background the user picked (the map, Esri imagery or a custom tile URL), the custom URL
 * and each imagery's offset, kept in this browser's storage as iD keeps them.
 */
import {
	type BackgroundId,
	type Imagery,
	type ImageryDisplay,
	imageryFor,
	NO_OFFSET,
	type Offset,
	PLAIN_DISPLAY,
} from "#lib/map/backgrounds.ts";
import { AREA_FILLS, type AreaFill } from "#lib/map/style/colors.ts";

const KEY = "indoorid.background";
/** The area fill, kept on its own as iD's `area-fill` preference. */
const FILL_KEY = "indoorid.area-fill";
/** Whether edited features are highlighted, kept as iD keeps it. */
const HIGHLIGHT_KEY = "indoorid.highlight-edits";
const IDS: readonly BackgroundId[] = ["map", "esri", "esri-clarity", "custom"];

/** Offsets are kept to the centimetre, and within this many metres. */
const MAX_OFFSET = 1000;

interface Saved {
	id: BackgroundId;
	custom: string;
	offsets: Record<string, Offset>;
}

export class BackgroundSettings {
	id = $state<BackgroundId>("map");
	/** The custom tile URL, as typed. */
	custom = $state("");
	#offsets = $state.raw<Record<string, Offset>>({});
	/** How areas are filled while editing (iD's Map Data pane); partly at first, as iD. */
	areaFill = $state<AreaFill>("partial");
	/** iD's "Highlight changes": edited features drawn with a coloured halo. */
	highlightEdits = $state(false);
	/** Brightness, contrast and saturation of the imagery, for this page only (as iD). */
	display = $state.raw<ImageryDisplay>(PLAIN_DISPLAY);
	/** The fill W goes back to from the wireframe. */
	#lastFill: Exclude<AreaFill, "wireframe"> = "partial";
	readonly #storage: Storage | undefined;

	constructor(storage: Storage | undefined) {
		this.#storage = storage;
		this.areaFill = readFill(storage);
		if (this.areaFill !== "wireframe") this.#lastFill = this.areaFill;
		try {
			this.highlightEdits = storage?.getItem(HIGHLIGHT_KEY) === "true";
		} catch {
			// Blocked storage: off.
		}
		const saved = read(storage);
		if (saved) {
			this.id = saved.id;
			this.custom = saved.custom;
			this.#offsets = saved.offsets;
		}
	}

	/** The imagery shown, or null for the map alone (or a custom URL that can't be shown). */
	readonly imagery: Imagery | null = $derived(imageryFor(this.id, this.custom));

	/** The shown imagery's offset. */
	get offset(): Offset {
		return (this.imagery && this.#offsets[this.imagery.id]) ?? NO_OFFSET;
	}

	/** The background shown before the last choice, for iD's Mod+B; none at first. */
	#previous: BackgroundId | null = null;

	choose(id: BackgroundId) {
		if (id !== this.id) this.#previous = this.id;
		this.id = id;
		this.#save();
	}

	/** iD's Mod+B: back to the background shown before, and again to this one. */
	swapPrevious() {
		if (this.#previous !== null) this.choose(this.#previous);
	}

	setCustom(template: string) {
		this.custom = template.trim();
		if (this.id !== "custom") this.#previous = this.id;
		this.id = "custom";
		this.#save();
	}

	setOffset(offset: Offset) {
		const imagery = this.imagery;
		if (!imagery) return;
		this.#offsets = { ...this.#offsets, [imagery.id]: clamp(offset) };
		this.#save();
	}

	/** Moves the imagery by `east` and `north` metres. */
	nudge(east: number, north: number) {
		const { east: e, north: n } = this.offset;
		this.setOffset({ east: e + east, north: n + north });
	}

	setAreaFill(fill: AreaFill) {
		this.areaFill = fill;
		if (fill !== "wireframe") this.#lastFill = fill;
		try {
			this.#storage?.setItem(FILL_KEY, fill);
		} catch {
			// Blocked storage: kept for this page only.
		}
	}

	setHighlightEdits(on: boolean) {
		this.highlightEdits = on;
		try {
			this.#storage?.setItem(HIGHLIGHT_KEY, String(on));
		} catch {
			// Blocked storage: kept for this page only.
		}
	}

	/** Changes one of the imagery's display values, kept between 0.25 (0 but brightness) and 2. */
	setDisplay(name: keyof ImageryDisplay, value: number) {
		const min = name === "brightness" ? 0.25 : 0;
		const clamped = Math.round(Math.max(min, Math.min(2, value)) * 100) / 100;
		this.display = { ...this.display, [name]: clamped };
	}

	/** iD's W: the wireframe, or back to the fill shown before it. */
	toggleWireframe() {
		this.setAreaFill(
			this.areaFill === "wireframe" ? this.#lastFill : "wireframe",
		);
	}

	#save() {
		const saved: Saved = {
			id: this.id,
			custom: this.custom,
			offsets: this.#offsets,
		};
		try {
			this.#storage?.setItem(KEY, JSON.stringify(saved));
		} catch {
			// Blocked storage: kept for this page only.
		}
	}
}

function clamp({ east, north }: Offset): Offset {
	const round = (value: number) =>
		Math.round(Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, value)) * 100) / 100;
	return { east: round(east), north: round(north) };
}

function readFill(storage: Storage | undefined): AreaFill {
	try {
		const saved = storage?.getItem(FILL_KEY);
		return AREA_FILLS.find((fill) => fill === saved) ?? "partial";
	} catch {
		return "partial";
	}
}

function read(storage: Storage | undefined): Saved | null {
	try {
		const raw = storage?.getItem(KEY);
		if (!raw) return null;
		const saved = JSON.parse(raw) as Partial<Saved>;
		const offsets: Record<string, Offset> = {};
		for (const [id, offset] of Object.entries(saved.offsets ?? {})) {
			if (Number.isFinite(offset?.east) && Number.isFinite(offset?.north)) {
				offsets[id] = clamp(offset);
			}
		}
		return {
			id: IDS.includes(saved.id as BackgroundId)
				? (saved.id as BackgroundId)
				: "map",
			custom: typeof saved.custom === "string" ? saved.custom : "",
			offsets,
		};
	} catch {
		return null;
	}
}

/**
 * Reads an offset as typed, "east, north" in metres (iD's field), or null when it isn't one.
 */
export function parseOffset(text: string): Offset | null {
	const parts = text.split(/[,;\s]+/).filter((part) => part !== "");
	if (parts.length !== 2) return null;
	const [east, north] = parts.map(Number);
	if (!Number.isFinite(east) || !Number.isFinite(north)) return null;
	return { east: east as number, north: north as number };
}

export function formatOffset({ east, north }: Offset): string {
	return `${east}, ${north}`;
}
