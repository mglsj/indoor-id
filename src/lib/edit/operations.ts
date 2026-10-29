/**
 * Operations on the selection (P5.3.5), after iD's `operations/`: each says whether it applies
 * to what is selected (the toolbar shows it), why it can't run when it can't (the tooltip says
 * so), its shortcut and what it does. Running one gives an edit to make as one undo step, with
 * what to select after, or a new clipboard. Pure: the editor runs them (`performEdit`).
 */
import {
	type Clipboard,
	canCopy,
	copyEntities,
	pasteEntities,
} from "#lib/actions/copy.ts";
import { deleteEntities } from "#lib/actions/delete.ts";
import { canDisconnect, disconnect } from "#lib/actions/disconnect.ts";
import { mergeAreas, mergeRefusal } from "#lib/actions/merge-areas.ts";
import {
	makeMultipolygon,
	multipolygonRefusal,
} from "#lib/actions/multipolygon.ts";
import {
	orthogonalize,
	orthogonalizeRefusal,
} from "#lib/actions/orthogonalize.ts";
import { canRepeat } from "#lib/actions/repeat-levels.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import type { EntityId, Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";

/** What an operation looks at. */
export interface OperationContext {
	readonly graph: Graph;
	readonly selected: readonly EntityId[];
	/** The level shown, where pasted features go. */
	readonly level: number;
	/** Where a paste goes: the pointer on the map, else the map's centre. */
	readonly pasteAt: Loc;
	readonly clipboard: Clipboard | null;
}

export type OperationResult =
	| {
			readonly kind: "edit";
			/** The new graph and what to select after (null: nothing). */
			readonly edit: (graph: Graph) => {
				graph: Graph;
				select: readonly EntityId[] | null;
			};
			readonly annotation: Message;
	  }
	| { readonly kind: "copy"; readonly clipboard: Clipboard }
	/** Repeat on levels asks which levels first (`ui/RepeatDialog.svelte`). */
	| { readonly kind: "repeat"; readonly id: NodeId | WayId };

export interface Operation {
	readonly id:
		| "delete"
		| "disconnect"
		| "square"
		| "merge"
		| "multipolygon"
		| "repeat"
		| "copy"
		| "paste";
	readonly label: Message;
	/** Shortcuts, the first one shown. */
	readonly keys: readonly string[];
	/** Whether it applies to the selection: the toolbar shows it. */
	available(context: OperationContext): boolean;
	/** Why it can't run on this selection, or null when it can. */
	disabled(context: OperationContext): Message | null;
	run(context: OperationContext): OperationResult;
}

const keep = (select: readonly EntityId[]) => (graph: Graph) => ({
	graph,
	select,
});

const deleteOperation: Operation = {
	id: "delete",
	label: msg("operation_delete"),
	keys: ["Delete", "Mod+Backspace"],
	available: ({ selected }) => selected.length > 0,
	disabled: () => null,
	run: ({ selected }) => ({
		kind: "edit",
		edit: (graph) => ({ graph: deleteEntities(selected)(graph), select: null }),
		annotation:
			selected.length === 1
				? msg("undo_delete")
				: msg("undo_delete_many", { count: selected.length }),
	}),
};

/** The one node or way selected, if that is the selection. */
function singleNodeOrWay(
	graph: Graph,
	selected: readonly EntityId[],
): NodeId | WayId | null {
	const [id] = selected;
	if (selected.length !== 1 || !id) return null;
	const type = graph.entity(id)?.type;
	return type === "node" || type === "way" ? (id as NodeId | WayId) : null;
}

const disconnectOperation: Operation = {
	id: "disconnect",
	label: msg("operation_disconnect"),
	keys: ["D"],
	available: ({ graph, selected }) => {
		const id = singleNodeOrWay(graph, selected);
		// A point on its own has nothing to disconnect from: not offered.
		return (
			id !== null &&
			(id.startsWith("w") || graph.parentWays(id as NodeId).length > 0)
		);
	},
	disabled: ({ graph, selected }) => {
		const id = singleNodeOrWay(graph, selected);
		return id && canDisconnect(graph, id)
			? null
			: msg("operation_disconnect_not_connected");
	},
	run: ({ graph, selected }) => {
		const id = singleNodeOrWay(graph, selected) as NodeId | WayId;
		return {
			kind: "edit",
			edit: (g) => keep(selected)(disconnect(id)(g)),
			annotation: msg("undo_disconnect"),
		};
	},
};

/** The one closed way selected, if that is the selection. */
function singleArea(graph: Graph, selected: readonly EntityId[]): WayId | null {
	const id = singleNodeOrWay(graph, selected);
	return id?.startsWith("w") &&
		orthogonalizeRefusal(graph, id as WayId) !== "not_area"
		? (id as WayId)
		: null;
}

const SQUARE_REFUSALS = {
	not_squarish: msg("operation_square_not_squarish"),
	square_enough: msg("operation_square_square_enough"),
} as const;

const squareOperation: Operation = {
	id: "square",
	label: msg("operation_square"),
	keys: ["Q"],
	available: ({ graph, selected }) => singleArea(graph, selected) !== null,
	disabled: ({ graph, selected }) => {
		const id = singleArea(graph, selected);
		const refusal = id ? orthogonalizeRefusal(graph, id) : "not_area";
		return refusal === null || refusal === "not_area"
			? null
			: SQUARE_REFUSALS[refusal];
	},
	run: ({ graph, selected }) => {
		const id = singleArea(graph, selected) as WayId;
		return {
			kind: "edit",
			edit: (g) => keep(selected)(orthogonalize(id)(g)),
			annotation: msg("undo_square"),
		};
	},
};

const MERGE_REFUSALS = {
	not_areas: msg("operation_merge_not_areas"),
	different_tags: msg("operation_merge_different_tags"),
	not_adjacent: msg("operation_merge_not_adjacent"),
} as const;

const mergeOperation: Operation = {
	id: "merge",
	label: msg("operation_merge"),
	keys: ["C"],
	available: ({ selected }) => selected.length > 1,
	disabled: ({ graph, selected }) => {
		const refusal = mergeRefusal(graph, selected);
		return refusal ? MERGE_REFUSALS[refusal] : null;
	},
	run: ({ selected }) => ({
		kind: "edit",
		edit: (graph) => {
			const after = mergeAreas(selected as WayId[])(graph);
			// The one left is the one kept.
			return {
				graph: after,
				select: selected.filter((id) => after.entity(id)),
			};
		},
		annotation: msg("undo_merge"),
	}),
};

const MULTIPOLYGON_REFUSALS = {
	not_rings: msg("operation_multipolygon_not_rings"),
	several_relations: msg("operation_multipolygon_several_relations"),
	in_other_multipolygon: msg("operation_multipolygon_in_other"),
} as const;

const multipolygonOperation: Operation = {
	id: "multipolygon",
	label: msg("operation_multipolygon"),
	keys: ["Shift+C"],
	available: ({ graph, selected }) =>
		selected.length > 1 &&
		selected.every((id) => {
			const type = graph.entity(id)?.type;
			return type === "way" || type === "relation";
		}),
	disabled: ({ graph, selected }) => {
		const refusal = multipolygonRefusal(graph, selected);
		return refusal ? MULTIPOLYGON_REFUSALS[refusal] : null;
	},
	run: ({ selected }) => ({
		kind: "edit",
		edit: (graph) => {
			const made = makeMultipolygon(graph, selected);
			return made
				? { graph: made.graph, select: [made.relation] }
				: { graph, select: selected };
		},
		annotation: msg("undo_multipolygon"),
	}),
};

const repeatOperation: Operation = {
	id: "repeat",
	label: msg("operation_repeat"),
	keys: ["R"],
	available: ({ graph, selected }) => {
		const id = singleNodeOrWay(graph, selected);
		return (
			id !== null &&
			(id.startsWith("w") || graph.parentWays(id as NodeId).length === 0)
		);
	},
	disabled: ({ graph, selected, level }) => {
		const id = singleNodeOrWay(graph, selected);
		return id && canRepeat(graph, id, level)
			? null
			: msg("operation_repeat_not_on_level", { level });
	},
	run: ({ graph, selected }) => ({
		kind: "repeat",
		id: singleNodeOrWay(graph, selected) as NodeId | WayId,
	}),
};

const copyOperation: Operation = {
	id: "copy",
	label: msg("operation_copy"),
	keys: ["Mod+C"],
	available: ({ selected }) => selected.length > 0,
	disabled: ({ graph, selected }) =>
		selected.some((id) => canCopy(graph, id))
			? null
			: msg("operation_copy_nothing"),
	run: ({ graph, selected }) => ({
		kind: "copy",
		clipboard: copyEntities(graph, selected) as Clipboard,
	}),
};

const pasteOperation: Operation = {
	id: "paste",
	label: msg("operation_paste"),
	keys: ["Mod+V"],
	available: ({ clipboard }) => clipboard !== null,
	disabled: () => null,
	run: ({ clipboard, pasteAt, level }) => ({
		kind: "edit",
		edit: (graph) => {
			const { graph: after, ids } = pasteEntities(
				graph,
				clipboard as Clipboard,
				pasteAt,
				level,
			);
			return { graph: after, select: ids };
		},
		annotation:
			(clipboard?.roots.length ?? 0) > 1
				? msg("undo_paste_many", { count: clipboard?.roots.length ?? 0 })
				: msg("undo_paste"),
	}),
};

/** In the toolbar's order. */
export const OPERATIONS: readonly Operation[] = [
	copyOperation,
	pasteOperation,
	disconnectOperation,
	squareOperation,
	mergeOperation,
	multipolygonOperation,
	repeatOperation,
	deleteOperation,
];
