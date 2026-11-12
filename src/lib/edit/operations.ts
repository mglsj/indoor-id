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
import { makeSymmetric, straightenToFrame } from "#lib/actions/straighten.ts";
import { squareToFrame } from "#lib/actions/transform.ts";
import { type Message, msg } from "#lib/i18n/messages.ts";
import type { EntityId, Loc, NodeId, WayId } from "#lib/osm/entity.ts";
import type { Extent } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { TransformTool } from "./modes/transform.ts";
import { tooLargeToEdit } from "./visibility.ts";

/** What an operation looks at. */
export interface OperationContext {
	readonly graph: Graph;
	readonly selected: readonly EntityId[];
	/** The level shown, where pasted features go. */
	readonly level: number;
	/** Where a paste goes: the pointer on the map, else the map's centre. */
	readonly pasteAt: Loc;
	readonly clipboard: Clipboard | null;
	/** The drawing frame's angle at the selection (C.6), for squaring to it. */
	readonly frameAngle?: number;
	/** The map in view: operations that change the selection's shape or place need it seen. */
	readonly view?: Extent;
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
	| { readonly kind: "repeat"; readonly id: NodeId | WayId }
	/** A tool on the map does it, by clicks or typed values (C.6, `edit/modes/transform.ts`). */
	| { readonly kind: "tool"; readonly tool: TransformTool };

export interface Operation {
	readonly id:
		| "delete"
		| "disconnect"
		| "square"
		| "merge"
		| "multipolygon"
		| "repeat"
		| "copy"
		| "paste"
		| "move"
		| "rotate"
		| "scale"
		| "side"
		| "offset"
		| "square-frame"
		| "straighten"
		| "symmetric";
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

/** A tool on the map that edits the selection by clicks or typed values (C.6). */
function toolOperation(
	tool: TransformTool,
	label: Message,
	key: string,
	applies: (graph: Graph, selected: readonly EntityId[]) => boolean,
): Operation {
	return {
		id: tool,
		label,
		keys: [key],
		available: ({ graph, selected }) => applies(graph, selected),
		disabled: () => null,
		run: () => ({ kind: "tool", tool }),
	};
}

/** One way selected (a line or an area). */
function singleWay(graph: Graph, selected: readonly EntityId[]): WayId | null {
	const id = singleNodeOrWay(graph, selected);
	return id?.startsWith("w") ? (id as WayId) : null;
}

/** One closed way selected. */
function singleClosedWay(
	graph: Graph,
	selected: readonly EntityId[],
): WayId | null {
	const id = singleWay(graph, selected);
	const way = id && graph.entity(id);
	return way?.type === "way" &&
		way.nodes.length > 3 &&
		way.nodes[0] === way.nodes.at(-1)
		? id
		: null;
}

const anything = (_: Graph, selected: readonly EntityId[]) =>
	selected.length > 0;

const squareFrameOperation: Operation = {
	id: "square-frame",
	label: msg("operation_square_frame"),
	keys: ["Shift+Q"],
	available: ({ graph, selected }) => singleClosedWay(graph, selected) !== null,
	disabled: () => null,
	run: ({ graph, selected, frameAngle = 0 }) => {
		const id = singleClosedWay(graph, selected) as WayId;
		return {
			kind: "edit",
			edit: (g) => keep(selected)(squareToFrame(id, frameAngle)(g)),
			annotation: msg("undo_square_frame"),
		};
	},
};

/**
 * The outline to straighten: one closed way selected, or the one closed outer way of a selected
 * multipolygon (a building mapped as a relation).
 */
function singleOutline(
	graph: Graph,
	selected: readonly EntityId[],
): WayId | null {
	const [id] = selected;
	const entity = selected.length === 1 && id ? graph.entity(id) : undefined;
	if (entity?.type !== "relation") return singleClosedWay(graph, selected);
	if (entity.tags.type !== "multipolygon") return null;
	const outers = entity.members.filter(
		(m) => m.role === "outer" && m.ref.startsWith("w"),
	);
	const [outer] = outers;
	return outers.length === 1 && outer
		? singleClosedWay(graph, [outer.ref])
		: null;
}

/** Every side to a multiple of 45° from the frame, a hand-drawn outline made as drawn in CAD. */
const straightenOperation: Operation = {
	id: "straighten",
	label: msg("operation_straighten"),
	keys: ["A"],
	available: ({ graph, selected }) => singleOutline(graph, selected) !== null,
	disabled: () => null,
	run: ({ graph, selected, frameAngle = 0 }) => {
		const id = singleOutline(graph, selected) as WayId;
		return {
			kind: "edit",
			edit: (g) => keep(selected)(straightenToFrame(id, frameAngle, 45)(g)),
			annotation: msg("undo_straighten"),
		};
	},
};

/** A symmetric outline made exactly symmetric about the frame's axes or diagonals. */
const symmetricOperation: Operation = {
	id: "symmetric",
	label: msg("operation_symmetric"),
	keys: ["Y"],
	available: ({ graph, selected }) => singleOutline(graph, selected) !== null,
	disabled: ({ graph, selected, frameAngle = 0 }) => {
		const id = singleOutline(graph, selected) as WayId;
		return makeSymmetric(id, frameAngle)(graph) === graph
			? msg("operation_symmetric_none")
			: null;
	},
	run: ({ graph, selected, frameAngle = 0 }) => {
		const id = singleOutline(graph, selected) as WayId;
		return {
			kind: "edit",
			edit: (g) => keep(selected)(makeSymmetric(id, frameAngle)(g)),
			annotation: msg("undo_symmetric"),
		};
	},
};

/**
 * The operation, refused while too little of the selection is in view (iD's `too_large`): what
 * moves, reshapes or deletes features needs them seen first.
 */
function inView(operation: Operation): Operation {
	return {
		...operation,
		disabled: (context) =>
			tooLargeToEdit(context.graph, context.selected, context.view)
				? msg("operation_too_large")
				: operation.disabled(context),
	};
}

/** In the toolbar's order. */
export const OPERATIONS: readonly Operation[] = [
	copyOperation,
	pasteOperation,
	inView(disconnectOperation),
	inView(squareOperation),
	mergeOperation,
	multipolygonOperation,
	repeatOperation,
	inView(toolOperation("move", msg("operation_move"), "Shift+M", anything)),
	inView(toolOperation("rotate", msg("operation_rotate"), "Shift+R", anything)),
	inView(toolOperation("scale", msg("operation_scale"), "Shift+S", anything)),
	inView(
		toolOperation(
			"side",
			msg("operation_move_side"),
			"E",
			(graph, selected) => singleWay(graph, selected) !== null,
		),
	),
	inView(
		toolOperation(
			"offset",
			msg("operation_offset"),
			"O",
			(graph, selected) => singleWay(graph, selected) !== null,
		),
	),
	inView(squareFrameOperation),
	inView(straightenOperation),
	inView(symmetricOperation),
	inView(deleteOperation),
];
