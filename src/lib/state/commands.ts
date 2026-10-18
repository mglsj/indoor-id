/**
 * Edits made from the UI, each one undo step with its label: plain functions over the editor's
 * parts, so components call them and tests run them without a component.
 */
import { changeTags } from "#lib/actions/change-tags.ts";
import {
	addMember,
	addToNewRelation,
	changeMemberRoles as changeRoles,
	moveMember as move,
	removeMembers as remove,
} from "#lib/actions/members.ts";
import { msg } from "#lib/i18n/messages.ts";
import { labelFor } from "#lib/map/classify.ts";
import type {
	Entity,
	EntityId,
	Relation,
	RelationId,
} from "#lib/osm/entity.ts";
import type { Preset } from "#lib/presets/presets.ts";
import type { Issue } from "#lib/validation/validate.ts";
import type { Editor } from "./editor.svelte.ts";

/** Applies an issue's one-click fix. */
export function fix(editor: Editor, issue: Issue): void {
	if (issue.fix) editor.history.perform(issue.fix.action, issue.fix.label);
}

/** Changes a feature's type, keeping the tags the new preset doesn't replace. */
export function setPreset(
	editor: Editor,
	entity: Entity,
	preset: Preset,
): void {
	const geometry = editor.geometryOf(entity);
	const tags =
		editor.catalog.presets?.changePreset(
			entity.tags,
			editor.presetOf(entity),
			preset,
			geometry,
		) ?? entity.tags;
	editor.history.perform(
		changeTags(entity.id, tags),
		msg("undo_change_preset", { preset: preset.name }),
	);
	editor.catalog.recentPresets.add(preset.id, geometry);
}

/** How a relation reads in lists: its type, then its name (iD's `baseDisplayValue`). */
export function relationLabel(editor: Editor, relation: Relation): string {
	const type = editor.presetOf(relation)?.name ?? "Relation";
	return `${type} ${labelFor(relation.tags) ?? ""}`;
}

/**
 * Adds a feature to a relation with `role`, or to a new relation (null), and returns the
 * relation's id.
 */
export function addToRelation(
	editor: Editor,
	id: EntityId,
	relationId: RelationId | null,
	role: string,
): RelationId {
	const member = { ref: id, role };
	if (relationId) {
		editor.history.perform(
			addMember(relationId, member),
			msg("undo_add_to_relation"),
		);
		return relationId;
	}
	const created = editor.graph.newId("relation");
	editor.history.perform(
		addToNewRelation(created, member),
		msg("undo_add_relation"),
	);
	return created;
}

export function changeMemberRoles(
	editor: Editor,
	relationId: RelationId,
	indexes: readonly number[],
	role: string,
): void {
	editor.history.perform(
		changeRoles(relationId, indexes, role),
		msg("undo_change_role"),
	);
}

/** Takes members out of a relation; a relation left empty is deleted. */
export function removeMembers(
	editor: Editor,
	relationId: RelationId,
	indexes: readonly number[],
): void {
	editor.history.perform(
		remove(relationId, indexes),
		msg("undo_remove_from_relation"),
	);
}

export function moveMember(
	editor: Editor,
	relationId: RelationId,
	from: number,
	to: number,
): void {
	if (from === to) return;
	editor.history.perform(
		move(relationId, from, to),
		msg("undo_reorder_members"),
	);
}
