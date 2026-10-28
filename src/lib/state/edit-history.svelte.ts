/**
 * The OSM graph with its undo history, as the UI sees it: `graph` is replaced (never mutated)
 * on every change. Tag edits made while typing fold into one step (iD's `_coalesceChanges`).
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import { type Entity, type EntityId, sameTags } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { type Action, History } from "#lib/osm/history.ts";
import type { Tags } from "#lib/osm/tags.ts";
import type { TagPatch } from "#lib/presets/combo.ts";

const CHANGE_TAGS = msg("undo_change_tags");

export class EditHistory {
	/** Current graph; replaced (never mutated) on every change. */
	graph: Graph;
	/** Number of entities created, modified or deleted since the download or last upload. */
	readonly editCount = $derived.by(() => this.graph.changeCount());

	/** True while uploading: edits, undo and redo are refused (see `lock`). */
	locked = $state(false);

	#history: History<Message>;
	/**
	 * Counts the changes made by the user (not merges); `#made` gives the count each graph
	 * was made at, so `amend` knows whether anything was done since.
	 */
	#edits = 0;
	readonly #made = new WeakMap<Graph, number>();
	/**
	 * The features whose field is being typed in (their ids, joined): their next tag change
	 * replaces the last step instead of adding one.
	 */
	#typing: string | null = null;
	/** The action a drag shows on the map, not a step yet (see `preview`). */
	#preview: Action | null = null;

	constructor(base: Graph) {
		this.#history = new History<Message>(base);
		this.graph = $state.raw(base);
		this.#made.set(base, 0);
	}

	/**
	 * Refuses edits, undo and redo until `unlock`: an upload sends the graph as it was, and
	 * starts again from the server's answer.
	 */
	lock(): void {
		this.locked = true;
	}

	unlock(): void {
		this.locked = false;
	}

	get canUndo(): boolean {
		void this.graph; // re-evaluate when the graph changes
		return this.#history.canUndo;
	}

	get canRedo(): boolean {
		void this.graph;
		return this.#history.canRedo;
	}

	/** Applies an action as an undo step, labelled for the user. */
	perform(action: Action, annotation: Message): void {
		if (this.locked) return;
		this.#endPreview();
		this.#typing = null;
		this.#edited(this.#history.perform(action, annotation));
	}

	undo(): void {
		if (this.locked) return;
		this.#endPreview();
		this.#typing = null;
		this.#history.undo();
		this.#edited(this.#history.graph);
	}

	redo(): void {
		if (this.locked) return;
		this.#endPreview();
		this.#typing = null;
		this.#history.redo();
		this.#edited(this.#history.graph);
	}

	/**
	 * Shows `action` (a drag's latest move) applied to the last step, without making a step:
	 * each call replaces the one before. `commit` makes it a step, `cancelPreview` drops it.
	 */
	preview(action: Action): void {
		if (this.locked) return;
		this.#typing = null;
		this.#preview = action;
		this.graph = this.#history.graph.update(action);
	}

	/** Whether a preview is shown. */
	get previewing(): boolean {
		return this.#preview !== null;
	}

	/** Makes `action` (the drag's end, often the last preview) one undo step, ending the preview. */
	commit(action: Action, annotation: Message): void {
		if (this.locked) {
			this.cancelPreview();
			return;
		}
		this.#preview = null;
		// An action that changed nothing makes no step: the graph goes back to the last one.
		this.perform(action, annotation);
	}

	/** Drops the preview: the map shows the last step again. */
	cancelPreview(): void {
		if (this.#endPreview()) this.graph = this.#history.graph;
	}

	/** Ends a preview still shown (an edit made meanwhile wins); true when there was one. */
	#endPreview(): boolean {
		if (this.#preview === null) return false;
		this.#preview = null;
		return true;
	}

	/** Typing is over (another feature selected): the next tag change is a step of its own. */
	endTyping(): void {
		this.#typing = null;
	}

	/**
	 * Sets a feature's tags, as iD's entity editor: `live` changes (text being typed) are kept as
	 * typed and fold into one undo step, which the next change that isn't live (leaving the
	 * field) cleans and closes. Tags left as they were make no step.
	 */
	setTags(id: EntityId, tags: Tags, { live = false } = {}): void {
		if (this.locked) return;
		const entity = this.graph.entity(id);
		if (!entity) return;
		const action = changeTags(id, tags, { clean: !live });
		const changed = action(this.graph).entity(id);
		if (changed && sameTags(changed.tags, entity.tags)) {
			if (!live) this.#typing = null;
			return;
		}
		this.#apply(action, id, live);
	}

	/**
	 * Applies a field's change to several features in one undo step: `patch` (or the patch it
	 * makes from each feature's tags) sets keys, or removes those given as undefined. Typing
	 * folds as with `setTags`; features that don't change are left alone.
	 */
	patchTags(
		ids: readonly EntityId[],
		patch: TagPatch | ((tags: Tags, id: EntityId) => TagPatch),
		{ live = false } = {},
	): void {
		if (this.locked) return;
		const actions: Action[] = [];
		for (const id of ids) {
			const entity = this.graph.entity(id);
			if (!entity) continue;
			const changes =
				typeof patch === "function" ? patch(entity.tags, id) : patch;
			const tags: Record<string, string> = { ...entity.tags };
			for (const [key, value] of Object.entries(changes)) {
				if (value === undefined) delete tags[key];
				else tags[key] = value;
			}
			const action = changeTags(id, tags, { clean: !live });
			const changed = action(this.graph).entity(id);
			if (!changed || !sameTags(changed.tags, entity.tags))
				actions.push(action);
		}
		if (actions.length === 0) {
			if (!live) this.#typing = null;
			return;
		}
		const all: Action = (graph) =>
			actions.reduce((next, action) => action(next), graph);
		this.#apply(all, ids.join(" "), live);
	}

	/** Applies a tag change, folded into the last step while the same features are typed in. */
	#apply(action: Action, features: string, live: boolean): void {
		this.#edited(
			this.#typing === features
				? this.#history.replace(action, CHANGE_TAGS)
				: this.#history.perform(action, CHANGE_TAGS),
		);
		this.#typing = live ? features : null;
	}

	/**
	 * Changes tags in the last undo step, as iD does with tags looked up after an edit (the
	 * Wikipedia article of a Wikidata item). Only while nothing was done since `after`, the
	 * graph that edit made (downloaded data merged since doesn't count): anything done since
	 * wins.
	 */
	amend(after: Graph, id: EntityId, patch: (tags: Tags) => Tags | null): void {
		if (this.locked || this.#made.get(after) !== this.#edits) return;
		const entity = this.graph.entity(id);
		const tags = entity && patch(entity.tags);
		if (!tags) return;
		this.#edited(this.#history.replace(changeTags(id, tags), CHANGE_TAGS));
	}

	/** An entity's tags as downloaded, or undefined for a new feature (for a field's revert). */
	downloadedTags(id: EntityId): Tags | undefined {
		return this.#history.base.entity(id)?.tags;
	}

	/** Adds downloaded entities under every step (see `History.merge`). */
	merge(entities: Iterable<Entity>): void {
		this.#history.merge(entities);
		// A drag goes on over the downloaded data.
		this.graph = this.#preview
			? this.#history.graph.update(this.#preview)
			: this.#history.graph;
		this.#made.set(this.graph, this.#edits);
	}

	/** Starts a new history from `graph` (the server's state after an upload). */
	reset(graph: Graph): void {
		this.#typing = null;
		this.#preview = null;
		this.#history = new History<Message>(graph);
		this.#edited(graph);
	}

	#edited(graph: Graph): void {
		this.graph = graph;
		this.#made.set(graph, ++this.#edits);
	}
}
