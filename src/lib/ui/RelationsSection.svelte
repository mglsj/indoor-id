<script lang="ts">
	import Download from "@lucide/svelte/icons/download";
	import Focus from "@lucide/svelte/icons/focus";
	import Plus from "@lucide/svelte/icons/plus";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { tick } from "svelte";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { labelFor } from "#lib/map/classify.ts";
	import type { Entity, Relation, RelationId } from "#lib/osm/entity.ts";
	import { type Extent, extentsIntersect } from "#lib/osm/geometry.ts";
	import {
		entityExtent,
		isComplete,
		memberships,
		nearbyRelations,
	} from "#lib/osm/relations.ts";
	import { cleanValue } from "#lib/presets/text.ts";
	import {
		addToRelation,
		changeMemberRoles,
		relationLabel,
		removeMembers,
	} from "#lib/state/commands.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import ComboField from "#lib/ui/ComboField.svelte";
	import InspectorSection from "#lib/ui/InspectorSection.svelte";
	import { roleContext, roleField } from "#lib/ui/role-field.ts";
	import SearchCombo, { type SearchItem } from "#lib/ui/SearchCombo.svelte";

	interface Props {
		entity: Entity;
		/** The part of the map in view: relations there are offered. */
		viewExtent?: () => Extent | undefined;
		onzoom?: (relation: RelationId) => void;
	}

	let { entity, viewExtent, onzoom }: Props = $props();
	const editor = getEditor();

	/** Relations the feature was added to since the panel opened: listed last (as iD). */
	let recentlyAdded = $state<RelationId[]>([]);
	/** Whether the row to add the feature to a relation is shown. */
	let adding = $state(false);
	/** The role typed in that row. */
	let addedRole = $state("");

	const label = (relation: Relation) => relationLabel(editor, relation);
	const rows = $derived(
		memberships(editor.graph, entity.id, label, recentlyAdded),
	);
	const count = $derived(new Set(rows.map((row) => row.relation.id)).size);
	const geometry = $derived(editor.geometryOf(entity));

	/** Roles taginfo knows for members of this geometry in relations of the type. */
	const roles = (relation: Relation | null) =>
		editor.catalog.services.taginfo
			? (query: string) =>
					editor.catalog.services.taginfo?.roles({
						type: relation?.tags.type ?? "",
						query,
						geometry,
					}) ?? Promise.resolve([])
			: undefined;

	const NEW_RELATION = "new";
	const newRole = roleField("new-membership-role");
	const chooseId = "parent-relation";

	function search(query: string): SearchItem[] {
		const view = viewExtent?.();
		const choices = nearbyRelations(editor.graph, entity.id, query, {
			label,
			inView: (relation) => {
				const extent = entityExtent(editor.graph, relation.id);
				return !view || (extent !== null && extentsIntersect(extent, view));
			},
		});
		return [
			{ key: NEW_RELATION, label: "New relation…" },
			...choices.map(({ relation, value }) => ({
				key: relation.id,
				label: value,
				title: value,
			})),
		];
	}

	async function startAdding() {
		adding = true;
		await tick();
		document.getElementById(chooseId)?.focus();
	}

	function choose(item: SearchItem) {
		const role = addedRole;
		adding = false;
		addedRole = "";
		if (item.key === NEW_RELATION) {
			// Selected at once, its type to choose (iD's `newFeature`).
			editor.select(addToRelation(editor, entity.id, null, role));
			return;
		}
		const id = item.key as RelationId;
		addToRelation(editor, entity.id, id, role);
		recentlyAdded = [...recentlyAdded.filter((r) => r !== id), id];
	}

	function changeRole(relation: Relation, index: number, typed?: string) {
		const role = cleanValue(typed ?? "");
		if (role !== relation.members[index]?.role) {
			changeMemberRoles(editor, relation.id, [index], role);
		}
	}
</script>

<InspectorSection id="relations" title={`Relations (${count})`}>
	<div class="flex flex-col gap-3">
		<ul aria-label="Relations" class="flex flex-col gap-3">
			{#each rows as { relation, index, role } (`${relation.id}-${index}`)}
				{@const name = labelFor(relation.tags)}
				{@const text = label(relation)}
				<li class="flex flex-col gap-1">
					<div class="flex items-center gap-1">
						<button
							type="button"
							class="min-w-0 flex-1 truncate text-left text-sm underline-offset-4 hover:underline"
							title={text}
							onclick={() => editor.select(relation.id)}
						>
							<span class="font-medium"
								>{editor.presetOf(relation)?.name ?? "Relation"}</span
							>
							{#if name}
								{" "}<span>{name}</span>
							{/if}
						</button>
						{#if !isComplete(editor.graph, relation)}
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Download the members of ${text}`}
								title="Download the members"
								onclick={() => editor.sync.loadRelation(relation.id)}
							>
								<Download />
							</Button>
						{/if}
						{#if onzoom}
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Zoom to ${text}`}
								title="Zoom to"
								onclick={() => onzoom(relation.id)}
							>
								<Focus />
							</Button>
						{/if}
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label={`Remove from ${text}`}
							title="Remove"
							class="text-muted-foreground hover:text-destructive"
							onclick={() => removeMembers(editor, relation.id, [index])}
						>
							<Trash2 />
						</Button>
					</div>
					<ComboField
						field={roleField(`membership-role-${relation.id}-${index}`)}
						value={role || undefined}
						context={roleContext(roles(relation))}
						locked={false}
						raw
						ariaLabel={`Role in ${text}`}
						onchange={(typed) => changeRole(relation, index, typed)}
					/>
				</li>
			{/each}
		</ul>

		{#if adding}
			<div class="flex flex-col gap-1 rounded-md border border-dashed p-2">
				<div class="flex items-center gap-1">
					<SearchCombo
						id={chooseId}
						value=""
						placeholder="Choose a parent relation"
						ariaLabel="Choose a parent relation"
						{search}
						onchoose={choose}
						class="flex-1"
					/>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Cancel"
						title="Cancel"
						class="text-muted-foreground hover:text-destructive"
						onclick={() => (adding = false)}
					>
						<Trash2 />
					</Button>
				</div>
				<ComboField
					field={newRole}
					value={addedRole || undefined}
					context={roleContext(roles(null))}
					locked={false}
					raw
					ariaLabel="Role in the new relation"
					onchange={(typed) => (addedRole = cleanValue(typed ?? ""))}
				/>
			</div>
		{/if}

		<Button
			variant="outline"
			size="sm"
			class="self-start"
			onclick={startAdding}
		>
			<Plus data-icon="inline-start" />
			Add to a relation
		</Button>
	</div>
</InspectorSection>
