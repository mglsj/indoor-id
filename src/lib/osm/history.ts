import { type Entity, type EntityId, sameContent } from "./entity.ts";
import type { Graph } from "./graph.ts";

/** A change to the graph. Actions are pure: they return a new graph. */
export type Action = (graph: Graph) => Graph;

/** One undo step: its graph, label, what it changed and what was selected on it. */
export interface Step<A> {
	readonly graph: Graph;
	readonly annotation: A | null;
	/** The entities the step changed from the one before (what a saved step holds). */
	readonly changed: readonly EntityId[];
	/** The features selected while the step was the current one, last. */
	readonly selected: readonly EntityId[];
}

/** Undo/redo as a list of graph snapshots, each labelled with an annotation (`A`). */
export class History<A = string> {
	#steps: Step<A>[];
	#index = 0;
	/**
	 * The latest server data. A merge only replaces it: each step is rebased onto it when next
	 * shown (`#at`), so a download under 10,000 steps doesn't rebase them all (R4.4).
	 */
	#server: Graph;

	constructor(base: Graph) {
		this.#steps = [
			{ graph: base, annotation: null, changed: [], selected: [] },
		];
		this.#server = base.base();
	}

	/** A history of saved steps (`history-json.ts`), the first one without edits. */
	static fromSteps<A>(steps: readonly Step<A>[], index: number): History<A> {
		const first = steps[0];
		if (!first) throw new Error("A history needs a first step");
		const history = new History<A>(first.graph);
		history.#steps = [...steps];
		history.#index = Math.max(0, Math.min(index, steps.length - 1));
		return history;
	}

	/** Every step, first the one without edits, and the index of the current one. */
	get steps(): { readonly steps: readonly Step<A>[]; readonly index: number } {
		return { steps: this.#steps, index: this.#index };
	}

	/** The features selected on the current step. */
	get selected(): readonly EntityId[] {
		return this.#current.selected;
	}

	/** Records the selection on the current step, for undo, redo and a restore to select again. */
	select(ids: readonly EntityId[]): void {
		const step = this.#current;
		if (sameIds(step.selected, ids)) return;
		this.#steps[this.#index] = { ...step, selected: [...ids] };
	}

	get graph(): Graph {
		return this.#current.graph;
	}

	/** The graph before any edit. */
	get base(): Graph {
		return this.#first.graph;
	}

	get canUndo(): boolean {
		return this.#index > 0;
	}

	get canRedo(): boolean {
		return this.#index < this.#steps.length - 1;
	}

	get hasChanges(): boolean {
		return this.graph.hasChanges();
	}

	/** Applies an action, labelled for the undo button, and drops anything that could be redone. */
	perform(action: Action, annotation: A): Graph {
		const graph = this.graph.update(action);
		const changed = [...graph.changedSince(this.graph)];
		// An action that changed nothing makes no step to undo.
		if (sameEntities(changed, graph, this.graph)) return this.graph;
		const { selected } = this.#current;
		this.#steps = this.#steps.slice(0, this.#index + 1);
		this.#steps.push({ graph, annotation, changed, selected });
		this.#index++;
		return graph;
	}

	/**
	 * Applies an action to the current step instead of adding one, so one undo takes back both
	 * (iD's `replace`: a Wikipedia tag following a Wikidata choice). Performs it, labelled
	 * `annotation`, when there is no step to fold it into.
	 */
	replace(action: Action, annotation: A): Graph {
		const step = this.#current;
		if (this.#index === 0 || step.annotation === null) {
			return this.perform(action, annotation);
		}
		const graph = step.graph.update(action);
		const changed = [
			...new Set([...step.changed, ...graph.changedSince(step.graph)]),
		];
		this.#steps = [
			...this.#steps.slice(0, this.#index),
			{ ...step, graph, changed },
		];
		return graph;
	}

	/**
	 * Adds downloaded entities to the server data of every step. Entities already known in the
	 * same or a newer version are ignored. A newer version of an entity edited locally is not
	 * taken: the local edit stays, the upload will be refused for it, and it is reported here.
	 */
	merge(entities: Iterable<Entity>): { conflicts: EntityId[] } {
		const base = this.#server;
		// Each step is made from the one before, so the last one has every entity edited in any.
		const last = this.#steps[this.#steps.length - 1] as Step<A>;
		const accepted: Entity[] = [];
		const conflicts: EntityId[] = [];
		for (const entity of entities) {
			const known = base.entity(entity.id);
			if (known && (known.version ?? 0) >= (entity.version ?? 0)) continue;
			if (last.graph.isEdited(entity.id)) {
				conflicts.push(entity.id);
			} else {
				accepted.push(entity);
			}
		}
		if (accepted.length > 0) {
			this.#server = base.withBaseEntities(accepted).base();
		}
		return { conflicts };
	}

	/** Returns the annotation of the undone action, or null if there was nothing to undo. */
	undo(): A | null {
		if (!this.canUndo) return null;
		const { annotation } = this.#current;
		this.#index--;
		return annotation;
	}

	/** Returns the annotation of the redone action, or null if there was nothing to redo. */
	redo(): A | null {
		if (!this.canRedo) return null;
		this.#index++;
		return this.#current.annotation;
	}

	get #current(): Step<A> {
		return this.#at(this.#index);
	}

	get #first(): Step<A> {
		return this.#at(0);
	}

	/** Step `index`, rebased onto the latest server data first if a merge came since. */
	#at(index: number): Step<A> {
		const step = this.#steps[index] as Step<A>;
		if (step.graph.base() === this.#server) return step;
		const rebased = { ...step, graph: step.graph.rebaseOnto(this.#server) };
		this.#steps[index] = rebased;
		return rebased;
	}
}

function sameIds(a: readonly EntityId[], b: readonly EntityId[]): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Whether two graphs hold the same `changed` entities, as copies or as the same objects. */
function sameEntities(
	changed: readonly EntityId[],
	a: Graph,
	b: Graph,
): boolean {
	for (const id of changed) {
		const [x, y] = [a.entity(id), b.entity(id)];
		if (!x || !y || x.version !== y.version || !sameContent(x, y)) return false;
	}
	return true;
}
