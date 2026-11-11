/**
 * Drawing frames per building (C.3): automatic from the building's (or level outline's) main
 * direction, or set by the user, kept in IndexedDB by the outline's id, never in OSM.
 */
import { type Frame, outlineFrame } from "#lib/edit/precision/frame.ts";
import { containerAt } from "#lib/edit/unmapped-floor.ts";
import type { IndoorFeature } from "#lib/map/features.ts";
import type { Loc } from "#lib/osm/entity.ts";
import type { FrameStore, StoredFrame } from "#lib/persist/plan-store.ts";

/** The frame of the building at a position. */
export interface BuildingFrame {
	/** The outline's id (a building, or a level outline). */
	readonly id: string;
	readonly frame: Frame;
	/** The building's own frame, as `outlineFrame` gives it. */
	readonly auto: Frame;
	/** Whether the user set it. */
	readonly set: boolean;
}

export class Frames {
	#saved = $state.raw(new Map<string, StoredFrame>());
	readonly #store: FrameStore | undefined;

	/** Changes whenever a frame is set or reset, for derived values to follow. */
	get version(): ReadonlyMap<string, StoredFrame> {
		return this.#saved;
	}

	constructor(store?: FrameStore) {
		this.#store = store;
	}

	async load(): Promise<void> {
		try {
			const saved = await this.#store?.loadFrames();
			if (saved) this.#saved = saved;
		} catch {
			// Storage unavailable: frames are automatic, and kept for this page only.
		}
	}

	/** The frame of the building or level outline under `loc` on `level`, or null outside one. */
	at(
		features: readonly IndoorFeature[],
		loc: Loc,
		level: number,
	): BuildingFrame | null {
		const container = containerAt(features, loc, level);
		const ring = container?.polygons.find((p) => p[0])?.[0];
		const auto = ring && outlineFrame(ring);
		if (!container || !auto) return null;
		return this.of(container.feature.properties["@id"], auto);
	}

	/** A building's frame, from its automatic one. */
	of(id: string, auto: Frame): BuildingFrame {
		const saved = this.#saved.get(id);
		if (!saved) return { id, frame: auto, auto, set: false };
		return {
			id,
			frame: {
				angle: saved.angle,
				origin: saved.origin ? [saved.origin[0], saved.origin[1]] : auto.origin,
			},
			auto,
			set: true,
		};
	}

	/** Sets a building's frame (its angle, and its origin when given). */
	set(id: string, frame: StoredFrame): void {
		const previous = this.#saved.get(id);
		const next: StoredFrame = {
			angle: frame.angle,
			origin: frame.origin ?? previous?.origin,
		};
		this.#saved = new Map(this.#saved).set(id, next);
		void this.#store?.saveFrame(id, next).catch(() => {});
	}

	/** Back to the building's own frame. */
	reset(id: string): void {
		const next = new Map(this.#saved);
		next.delete(id);
		this.#saved = next;
		void this.#store?.saveFrame(id, null).catch(() => {});
	}
}
