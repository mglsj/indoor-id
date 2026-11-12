/**
 * Construction guides (C.5): the lines the user placed, kept per building and level in
 * IndexedDB with the floor plans and exported with them, never in OSM. The shown level's
 * guides are drawn and snapped to; the snapping menu hides them or clears a level's.
 */
import type { ConstructionGuide } from "#lib/edit/precision/construction.ts";
import type { DirectionLine } from "#lib/edit/precision/snap.ts";
import type { GuideStore } from "#lib/persist/plan-store.ts";

/** A guide as a plan file carries it: without an id, given one on import. */
export type GuideFields = Omit<ConstructionGuide, "id">;

export class Guides {
	#all = $state.raw<readonly ConstructionGuide[]>([]);
	/** Guides drawn and snapped to; hiding them keeps them. */
	shown = $state(true);
	readonly #store: GuideStore | undefined;

	constructor(store?: GuideStore) {
		this.#store = store;
	}

	get all(): readonly ConstructionGuide[] {
		return this.#all;
	}

	async load(): Promise<void> {
		try {
			const stored = (await this.#store?.loadGuides()) ?? [];
			const known = new Set(this.#all.map((g) => g.id));
			this.#all = [
				...this.#all,
				...stored
					.filter((g) => !known.has(g.id))
					.map(({ origin, ...rest }) => ({
						...rest,
						origin: [origin[0], origin[1]] as const,
					})),
			];
		} catch {
			// Storage unavailable: guides are kept for this page only.
		}
	}

	/** The guides of a level, while shown. */
	on(level: number): readonly ConstructionGuide[] {
		return this.shown ? this.#all.filter((g) => g.level === level) : [];
	}

	/** How many guides a level has, shown or not. */
	countOn(level: number): number {
		return this.#all.filter((g) => g.level === level).length;
	}

	/** Places a guide on a level (and in a building), shown at once. */
	add(
		line: DirectionLine,
		level: number,
		building?: string,
	): ConstructionGuide {
		const guide: ConstructionGuide = {
			id: crypto.randomUUID(),
			origin: [line.origin[0], line.origin[1]],
			angle: line.angle,
			level,
			...(building ? { building } : {}),
		};
		this.addAll([guide]);
		return guide;
	}

	/** Adds guides, read from a plan file (each gets a new id). */
	addAll(guides: readonly (GuideFields & { id?: string })[]): void {
		const added = guides.map((g) => ({
			...g,
			id: g.id ?? crypto.randomUUID(),
		}));
		this.#all = [...this.#all, ...added];
		this.shown = true;
		this.#save(() => this.#store?.saveGuides(added.map(stored)));
	}

	remove(id: string): void {
		this.#all = this.#all.filter((g) => g.id !== id);
		this.#save(() => this.#store?.deleteGuides([id]));
	}

	/** Clears a level's guides. */
	clear(level: number): void {
		const gone = this.#all.filter((g) => g.level === level).map((g) => g.id);
		this.#all = this.#all.filter((g) => g.level !== level);
		this.#save(() => this.#store?.deleteGuides(gone));
	}

	#save(write: () => Promise<void> | undefined) {
		void Promise.resolve()
			.then(write)
			.catch(() => {});
	}
}

/** A guide as stored: plain arrays. */
function stored({ origin, ...rest }: ConstructionGuide) {
	return { ...rest, origin: [origin[0], origin[1]] as [number, number] };
}
