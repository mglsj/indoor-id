<script lang="ts">
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { SvelteSet } from "svelte/reactivity";
	import type { TagDocs } from "#lib/api/osm-wikibase.ts";
	import * as Command from "#lib/components/shadcn/command/index.ts";
	import type {
		Preset,
		PresetCategory,
		PresetGeometry,
		PresetIndex,
	} from "#lib/presets/presets.ts";
	import {
		presetReference,
		type TagReference as Reference,
	} from "#lib/presets/wiki.ts";
	import InfoButton from "#lib/ui/InfoButton.svelte";
	import PresetIcon from "#lib/ui/PresetIcon.svelte";
	import TagReference from "#lib/ui/TagReference.svelte";

	interface Props {
		presets: PresetIndex;
		geometry: PresetGeometry;
		/** The feature's type, marked in the list. */
		current: Preset | undefined;
		/** Ids of the types chosen last for this geometry, newest first. */
		recent: readonly string[];
		onchoose: (preset: Preset) => void;
		/** Escape: back to the editor without a change. */
		oncancel: () => void;
		/** The OSM wiki's documentation, for each row's ⓘ; none without the wiki. */
		docs?: (reference: Reference) => Promise<TagDocs | null>;
	}

	let { presets, geometry, current, recent, onchoose, oncancel, docs }: Props =
		$props();

	/** Rows whose documentation is shown, by value. */
	const documented = new SvelteSet<string>();
	/** Documentation asked for, kept while the list is open. */
	const asked = new Map<string, Promise<TagDocs | null>>();
	function docsOf(preset: Preset): Promise<TagDocs | null> | undefined {
		const reference = presetReference(preset);
		if (!docs || !reference) return undefined;
		let found = asked.get(preset.id);
		if (!found) {
			found = docs(reference);
			asked.set(preset.id, found);
		}
		return found;
	}

	let query = $state("");
	/** The highlighted row's value: a preset or category id, `category>preset` for a member. */
	let highlighted = $state("");
	const expanded = new SvelteSet<string>();

	const searching = $derived(query.trim() !== "");
	const items = $derived(
		searching
			? presets.search(query, geometry)
			: presets.listFor(geometry, recent, current),
	);

	const isCategory = (item: Preset | PresetCategory): item is PresetCategory =>
		"members" in item;
	const membersOf = (category: PresetCategory) =>
		category.members.filter((p) => p.geometry.includes(geometry));
	const memberValue = (category: PresetCategory, preset: Preset) =>
		`${category.id}>${preset.id}`;

	function toggle(category: PresetCategory) {
		if (expanded.has(category.id)) expanded.delete(category.id);
		else expanded.add(category.id);
	}

	/** iD's list keys: → opens the highlighted category, ← closes it from it or a member. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.stopPropagation();
			oncancel();
			return;
		}
		// The arrows move the caret in a search; the list has no categories then.
		if (searching) return;
		const [categoryId, member] = highlighted.split(">");
		if (!categoryId || !items.some((i) => i.id === categoryId && isCategory(i)))
			return;
		if (event.key === "ArrowRight" && !member) {
			event.preventDefault();
			expanded.add(categoryId);
		} else if (event.key === "ArrowLeft") {
			event.preventDefault();
			expanded.delete(categoryId);
			highlighted = categoryId;
		}
	}
</script>

{#snippet presetRow(
	preset: Preset,
	value: string,
	member: "open" | "closed" | null,
)}
	<!-- ⓘ sits beside the option, not in it: the option is named by the type alone. -->
	<div class={["flex items-center gap-0.5", member === "closed" && "hidden"]}>
		<Command.Item
			{value}
			aria-current={preset === current ? "true" : undefined}
			data-checked={preset === current}
			disabled={member === "closed"}
			class={["min-w-0 flex-1", member && "pl-8"]}
			onSelect={() => onchoose(preset)}
		>
			<PresetIcon icon={preset.icon} size={16} />
			<span class="truncate">{preset.name}</span>
		</Command.Item>
		{#if docs && presetReference(preset)}
			<InfoButton
				label={preset.name}
				expanded={documented.has(value)}
				ontoggle={() =>
					documented.has(value)
						? documented.delete(value)
						: documented.add(value)}
			/>
		{/if}
	</div>
	{#if member !== "closed" && documented.has(value)}
		{@const found = docsOf(preset)}
		{#if found}
			<div class={["pr-1 pb-2", member ? "pl-8" : "pl-2"]}>
				<TagReference docs={found} />
			</div>
		{/if}
	{/if}
{/snippet}

<Command.Root
	shouldFilter={false}
	label="Search feature types"
	bind:value={highlighted}
	class="min-h-0 flex-1 rounded-none!"
>
	<Command.Input
		bind:value={query}
		placeholder="Search feature types"
		autocomplete="off"
		{onkeydown}
		{@attach (input) => input.focus()}
	/>
	<Command.List class="max-h-none flex-1">
		<Command.Empty>No feature type found</Command.Empty>
		<Command.Group>
			{#each items as item (item.id)}
				{#if isCategory(item)}
					{@const open = expanded.has(item.id)}
					<Command.Item
						value={item.id}
						aria-expanded={open}
						class="[&>svg:last-child]:hidden"
						onSelect={() => toggle(item)}
					>
						<PresetIcon icon={item.icon} size={16} />
						<span class="truncate">{item.name}</span>
						<ChevronRight
							class={[
								"ml-auto text-muted-foreground transition-transform",
								open && "rotate-90",
							]}
						/>
					</Command.Item>
					<!-- Members stay in the list while closed: the list highlights its first row
					     whenever rows are added. -->
					{#each membersOf(item) as member (member.id)}
						{@render presetRow(
							member,
							memberValue(item, member),
							open ? "open" : "closed",
						)}
					{/each}
				{:else}
					{@render presetRow(item, item.id, null)}
				{/if}
			{/each}
		</Command.Group>
	</Command.List>
</Command.Root>
