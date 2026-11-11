/**
 * The background the user picked (the map, Esri imagery or a custom tile URL), the custom URL
 * and each imagery's offset, kept in this browser's storage as iD keeps them.
 */
import {
	type BackgroundId,
	type Imagery,
	imageryFor,
	NO_OFFSET,
	type Offset,
} from "#lib/map/backgrounds.ts";

const KEY = "indoorid.background";
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
	readonly #storage: Storage | undefined;

	constructor(storage: Storage | undefined) {
		this.#storage = storage;
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

	choose(id: BackgroundId) {
		this.id = id;
		this.#save();
	}

	setCustom(template: string) {
		this.custom = template.trim();
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
