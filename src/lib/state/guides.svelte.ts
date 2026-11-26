/**
 * Construction guides (C.5): the lines the user placed, kept per building and level in
 * IndexedDB with the floor plans and exported with them, never in OSM. Guides come in two sets:
 * indoor ones (building mode), per level, and outdoor ones (map mode), on no level. The shown
 * set's guides (the shown level's, indoors) are drawn and snapped to; the guides pane (`ui/GuidesPane.svelte`) lists them to hide,
 * recolour or delete one, and hides them all or clears a level's.
 */
import type { ConstructionGuide } from "#lib/edit/precision/construction.ts";
import type { DirectionLine } from "#lib/edit/precision/snap.ts";
import type { GuideStore } from "#lib/persist/plan-store.ts";

/** A guide as a plan file carries it: without an id, given one on import. */
export type GuideFields = Omit<ConstructionGuide, "id">;

/** Which guides are worked with: building mode's, per level, or map mode's, on no level. */
export type GuideSet = "indoor" | "outdoor";

/** Whether a guide is in a set, and on the level when indoors (outdoor guides have none). */
function isIn(guide: ConstructionGuide, level: number, set: GuideSet): boolean {
	return set === "outdoor"
		? guide.outdoor === true
		: guide.outdoor !== true && guide.level === level;
}

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

	/**
	 * The guides of a level (or the outdoor ones) drawn and snapped to: none while hidden, nor
	 * one hidden itself.
	 */
	on(level: number, set: GuideSet = "indoor"): readonly ConstructionGuide[] {
		return this.shown
			? this.#all.filter((g) => isIn(g, level, set) && !g.hidden)
			: [];
	}

	/** Every guide of a level (or every outdoor one), hidden or not, oldest first. */
	listOn(
		level: number,
		set: GuideSet = "indoor",
	): readonly ConstructionGuide[] {
		return this.#all.filter((g) => isIn(g, level, set));
	}

	/** The levels that have indoor guides, highest first, with how many each has. */
	levels(): { level: number; count: number }[] {
		const counts = new Map<number, number>();
		for (const g of this.#all)
			if (g.outdoor !== true)
				counts.set(g.level, (counts.get(g.level) ?? 0) + 1);
		return [...counts]
			.sort(([a], [b]) => b - a)
			.map(([level, count]) => ({ level, count }));
	}

	/** How many guides a level (or the outdoor set) has, shown or not. */
	countOn(level: number, set: GuideSet = "indoor"): number {
		return this.listOn(level, set).length;
	}

	/**
	 * Places a guide on a level (and in a building, in a colour of its own), shown at once; an
	 * outdoor one keeps the level it was placed on but shows on every level.
	 */
	add(
		line: DirectionLine,
		level: number,
		building?: string,
		color?: string,
		set: GuideSet = "indoor",
	): ConstructionGuide {
		const guide: ConstructionGuide = {
			id: crypto.randomUUID(),
			origin: [line.origin[0], line.origin[1]],
			angle: line.angle,
			level,
			...(building ? { building } : {}),
			...(color ? { color } : {}),
			...(set === "outdoor" ? { outdoor: true } : {}),
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

	/** Hides or shows one guide, or changes its colour. */
	update(
		id: string,
		change: Pick<ConstructionGuide, "color" | "hidden">,
	): void {
		const guide = this.#all.find((g) => g.id === id);
		if (!guide) return;
		const changed = { ...guide, ...change };
		this.#all = this.#all.map((g) => (g.id === id ? changed : g));
		this.#save(() => this.#store?.saveGuides([stored(changed)]));
	}

	remove(id: string): void {
		this.#all = this.#all.filter((g) => g.id !== id);
		this.#save(() => this.#store?.deleteGuides([id]));
	}

	/** Clears a level's guides (or the outdoor ones). */
	clear(level: number, set: GuideSet = "indoor"): void {
		const gone = this.listOn(level, set).map((g) => g.id);
		this.#all = this.#all.filter((g) => !isIn(g, level, set));
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
