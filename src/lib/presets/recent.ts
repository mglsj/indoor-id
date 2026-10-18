import type { PresetGeometry as Geometry } from "./presets.ts";

/** The part of the browser's Storage the recents use. */
export interface RecentStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface Recent {
	id: string;
	geometry: Geometry;
}

const KEY = "indoorid.recent-presets";
/** How many choices are kept, across geometries, as iD does. */
const KEPT = 30;

/**
 * The feature types the user chose last, per geometry, newest first, as iD's preset list
 * shows them above the defaults. Remembered in the browser when its storage allows.
 */
export class RecentPresets {
	#storage: RecentStorage;
	#items: Recent[];

	constructor(storage: RecentStorage) {
		this.#storage = storage;
		this.#items = read(storage);
	}

	/** Records `id` as just chosen for a feature of `geometry`. */
	add(id: string, geometry: Geometry): void {
		this.#items = [
			{ id, geometry },
			...this.#items.filter(
				(item) => item.id !== id || item.geometry !== geometry,
			),
		].slice(0, KEPT);
		try {
			this.#storage.setItem(KEY, JSON.stringify(this.#items));
		} catch {
			// Kept for this session only.
		}
	}

	/** The ids chosen for `geometry`, newest first. */
	list(geometry: Geometry, limit = 8): string[] {
		return this.#items
			.filter((item) => item.geometry === geometry)
			.slice(0, limit)
			.map((item) => item.id);
	}
}

function read(storage: RecentStorage): Recent[] {
	try {
		const items: unknown = JSON.parse(storage.getItem(KEY) ?? "[]");
		if (!Array.isArray(items)) return [];
		return items.filter(
			(item): item is Recent =>
				typeof item?.id === "string" && typeof item?.geometry === "string",
		);
	} catch {
		return [];
	}
}
