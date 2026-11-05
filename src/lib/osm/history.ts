import { type Entity, type EntityId, sameContent } from "./entity.ts";
import type { Graph } from "./graph.ts";

/** A change to the graph. Actions are pure: they return a new graph. */
export type Action = (graph: Graph) => Graph;

interface Step<A> {
	readonly graph: Graph;
	readonly annotation: A | null;
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
		this.#steps = [{ graph: base, annotation: null }];
		this.#server = base.base();
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
		// An action that changed nothing makes no step to undo.
		if (sameGraph(graph, this.graph)) return this.graph;
		this.#steps = this.#steps.slice(0, this.#index + 1);
		this.#steps.push({ graph, annotation });
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
		this.#steps = [
			...this.#steps.slice(0, this.#index),
			{ graph, annotation: step.annotation },
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

/** Whether two graphs hold the same entities, as copies or as the same objects. */
function sameGraph(a: Graph, b: Graph): boolean {
	for (const id of a.changedSince(b)) {
		const [x, y] = [a.entity(id), b.entity(id)];
		if (!x || !y || x.version !== y.version || !sameContent(x, y)) return false;
	}
	return true;
}
