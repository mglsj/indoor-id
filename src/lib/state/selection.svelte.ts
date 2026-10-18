/**
 * The selected features and the one under the pointer, by id. The map highlights both; the
 * Inspector edits the selection when it holds a single feature.
 */
import type { EntityId } from "#lib/osm/entity.ts";

export class Selection {
	/** The selected features, in the order they were selected, each once. */
	ids = $state.raw<readonly EntityId[]>([]);
	/** The feature under the pointer, selected or not. */
	hover = $state<EntityId | null>(null);
	/** The one feature selected, or null when none or several are. */
	readonly single = $derived(this.ids.length === 1 ? this.ids[0] : null);

	select(ids: EntityId | readonly EntityId[] | null): void {
		if (ids === null) this.ids = [];
		else if (typeof ids === "string") this.ids = [ids];
		else this.ids = [...new Set(ids)];
	}

	/** Adds a feature to the selection, or takes it out (Shift+click). */
	toggle(id: EntityId): void {
		this.ids = this.has(id)
			? this.ids.filter((selected) => selected !== id)
			: [...this.ids, id];
	}

	has(id: EntityId): boolean {
		return this.ids.includes(id);
	}

	setHover(id: EntityId | null): void {
		this.hover = id;
	}

	/** Follows the ids an upload gave to new features. */
	remap(idMap: ReadonlyMap<EntityId, EntityId>): void {
		this.ids = this.ids.map((id) => idMap.get(id) ?? id);
		if (this.hover) this.hover = idMap.get(this.hover) ?? this.hover;
	}
}
