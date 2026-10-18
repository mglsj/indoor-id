<script lang="ts">
	import Download from "@lucide/svelte/icons/download";
	import Focus from "@lucide/svelte/icons/focus";
	import GripVertical from "@lucide/svelte/icons/grip-vertical";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { tick } from "svelte";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { labelFor } from "#lib/map/classify.ts";
	import { type EntityId, entityType, type Relation } from "#lib/osm/entity.ts";
	import { type MemberRow, memberRows } from "#lib/osm/relations.ts";
	import type { PresetGeometry } from "#lib/presets/presets.ts";
	import { cleanValue } from "#lib/presets/text.ts";
	import {
		changeMemberRoles,
		moveMember,
		removeMembers,
	} from "#lib/state/commands.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import ComboField from "#lib/ui/ComboField.svelte";
	import { fieldInputId } from "#lib/ui/field-context.ts";
	import InspectorSection from "#lib/ui/InspectorSection.svelte";
	import { roleContext, roleField } from "#lib/ui/role-field.ts";

	interface Props {
		relation: Relation;
		/** Selects a member (and shows it, when out of view). */
		onshow?: (id: EntityId) => void;
		onzoom?: (id: EntityId) => void;
	}

	let { relation, onshow, onzoom }: Props = $props();
	const editor = getEditor();

	const TYPE_NAMES = { node: "Node", way: "Way", relation: "Relation" };

	/** Rows keyed by member and occurrence, so a row keeps its inputs when it moves. */
	const rows = $derived.by(() => {
		const seen = new Map<EntityId, number>();
		return memberRows(editor.graph, relation).map((row) => {
			const n = seen.get(row.ref) ?? 0;
			seen.set(row.ref, n + 1);
			return { ...row, key: `${row.ref}-${n}` };
		});
	});

	function labelOf(row: MemberRow): string {
		if (!row.entity) return `${TYPE_NAMES[entityType(row.ref)]} ${row.ref}`;
		const type =
			editor.presetOf(row.entity)?.name ?? TYPE_NAMES[row.entity.type];
		const name = labelFor(row.entity.tags);
		return name ? `${type} ${name}` : type;
	}

	/** A member's geometry for taginfo; guessed from its type when it isn't loaded (as iD). */
	function geometryOf(row: MemberRow): PresetGeometry {
		if (row.entity) return editor.geometryOf(row.entity);
		const type = entityType(row.ref);
		return type === "relation" ? "relation" : type === "way" ? "line" : "point";
	}

	const roles = (row: MemberRow) =>
		editor.catalog.services.taginfo
			? (query: string) =>
					editor.catalog.services.taginfo?.roles({
						type: relation.tags.type ?? "",
						query,
						geometry: geometryOf(row),
					}) ?? Promise.resolve([])
			: undefined;

	const roleId = (key: string) => `member-role-${key}`;

	function changeRole(row: MemberRow, typed?: string) {
		const role = cleanValue(typed ?? "");
		if (role !== row.role) {
			changeMemberRoles(editor, relation.id, [row.index], role);
		}
	}

	async function move(from: number, to: number, key: string) {
		if (to < 0 || to >= rows.length || from === to) return;
		moveMember(editor, relation.id, from, to);
		await tick();
		document.getElementById(fieldInputId(roleField(roleId(key))))?.focus();
	}

	/** Alt+↑ and Alt+↓ move a member, from its role input or its handle. */
	function onkeydown(event: KeyboardEvent, index: number, key: string) {
		if (!event.altKey) return;
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		event.preventDefault();
		event.stopPropagation();
		void move(index, index + (event.key === "ArrowUp" ? -1 : 1), key);
	}

	let dragged = $state<number | null>(null);
	let target = $state<number | null>(null);
</script>

<InspectorSection id="members" title={`Members (${relation.members.length})`}>
	<ul aria-label="Members" class="flex flex-col gap-3">
		{#each rows as row, i (row.key)}
			{@const text = labelOf(row)}
			<li
				class={[
					"flex flex-col gap-1 rounded-md",
					dragged === i && "opacity-50",
					target === i && dragged !== i && "ring-2 ring-ring/50",
				]}
				ondragover={(event) => {
					if (dragged === null) return;
					event.preventDefault();
					target = i;
				}}
				ondrop={(event) => {
					event.preventDefault();
					if (dragged !== null) void move(dragged, i, rows[dragged]?.key ?? "");
					dragged = target = null;
				}}
				onkeydowncapture={(event) => onkeydown(event, i, row.key)}
			>
				<div class="flex items-center gap-1">
					<button
						type="button"
						tabindex="-1"
						draggable="true"
						aria-label={`Move ${text}`}
						title="Drag to reorder, or Alt+↑ / Alt+↓ in the role"
						class="flex size-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground"
						ondragstart={(event) => {
							dragged = i;
							event.dataTransfer?.setData("text/plain", row.ref);
						}}
						ondragend={() => (dragged = target = null)}
					>
						<GripVertical class="size-3.5" />
					</button>
					{#if row.entity}
						<button
							type="button"
							class="min-w-0 flex-1 truncate text-left text-sm underline-offset-4 hover:underline"
							title={text}
							onclick={() => onshow?.(row.ref)}
						>
							{text}
						</button>
						{#if onzoom}
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Zoom to ${text}`}
								title="Zoom to"
								onclick={() => onzoom(row.ref)}
							>
								<Focus />
							</Button>
						{/if}
					{:else}
						<span class="min-w-0 flex-1 truncate text-sm" title={text}>
							{text}
							<span class="text-muted-foreground">(incomplete)</span>
						</span>
						<Button
							variant="ghost"
							size="icon-xs"
							aria-label="Download the members"
							title="Download the members"
							onclick={() => editor.sync.loadRelation(relation.id)}
						>
							<Download />
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`Remove ${text}`}
						title="Remove"
						class="text-muted-foreground hover:text-destructive"
						onclick={() => removeMembers(editor, relation.id, [row.index])}
					>
						<Trash2 />
					</Button>
				</div>
				<ComboField
					field={roleField(roleId(row.key))}
					value={row.role || undefined}
					context={roleContext(roles(row))}
					locked={false}
					raw
					ariaLabel={`Role of ${text}`}
					onchange={(typed) => changeRole(row, typed)}
				/>
			</li>
		{/each}
	</ul>
</InspectorSection>
