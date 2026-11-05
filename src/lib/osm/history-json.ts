/**
 * A history as plain JSON, for autosave (P5.4a), after iD's `history.toJSON`: the downloaded
 * versions of the entities edited, then each step as what it changed from the one before, its
 * label and selection. A restore replays the steps on those base versions; the rest of the data
 * downloads again, and a newer server version of an edited entity is then a conflict.
 */
import type { Entity, EntityId } from "./entity.ts";
import { Graph } from "./graph.ts";
import { History, type Step } from "./history.ts";

export interface SavedHistory<A> {
	readonly version: 1;
	/** The downloaded version of each entity edited in any step. */
	readonly base: readonly Entity[];
	/** The steps, first the one without edits. */
	readonly steps: readonly SavedStep<A>[];
	/** The current step. */
	readonly index: number;
}

export interface SavedStep<A> {
	readonly annotation: A | null;
	readonly selected: readonly EntityId[];
	/** Each entity the step changed, as it left it; null when deleted. */
	readonly set: readonly (readonly [EntityId, Entity | null])[];
}

/**
 * A history as saved. Costs what the steps changed, not the size of the data: a step keeps the
 * ids it changed (`Step.changed`). The next new id isn't saved: replaying the steps gives one
 * below every new entity, and ids taken by a drawing never finished aren't used anywhere.
 */
export function saveHistory<A>(history: History<A>): SavedHistory<A> {
	const { steps, index } = history.steps;
	const server = history.base;
	const base = new Map<EntityId, Entity>();
	const saved = steps.map((step): SavedStep<A> => {
		const set = step.changed.map((id) => {
			const original = server.entity(id);
			if (original) base.set(id, original);
			return [id, step.graph.entity(id) ?? null] as const;
		});
		return { annotation: step.annotation, selected: step.selected, set };
	});
	return { version: 1, base: [...base.values()], steps: saved, index };
}

/** The history saved by `saveHistory`, on the base versions it kept. */
export function restoreHistory<A>(saved: SavedHistory<A>): History<A> {
	let graph = Graph.fromEntities(saved.base);
	const steps = saved.steps.map((step, i): Step<A> => {
		if (i > 0) {
			graph = graph.update((g) =>
				step.set.reduce(
					(next, [id, entity]) =>
						entity ? next.replace(entity) : next.remove(id),
					g,
				),
			);
		}
		return {
			graph,
			annotation: step.annotation,
			changed: step.set.map(([id]) => id),
			selected: step.selected,
		};
	});
	return History.fromSteps(steps, saved.index);
}
