<script lang="ts">
	import { untrack } from "svelte";
	import {
		currentRepeat,
		type NodesOnLevel,
		type RepeatMethod,
		repeatOnLevels,
	} from "#lib/actions/repeat-levels.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import * as Dialog from "#lib/components/shadcn/dialog/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import * as RadioGroup from "#lib/components/shadcn/radio-group/index.ts";
	import { msg } from "#lib/i18n/messages.ts";
	import { fullLabel, type LevelEntry } from "#lib/levels/level-names.ts";
	import type { NodeId, WayId } from "#lib/osm/entity.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";

	interface Props {
		/** The point or way to repeat, on `level`. */
		id: NodeId | WayId;
		level: number;
		/** The levels to offer, named (the levels in view). */
		levels: readonly LevelEntry[];
		/** The drawn nodes on a level around the feature, to find copies and share nodes. */
		near: NodesOnLevel;
		onclose: () => void;
	}

	let { id, level, levels, near, onclose }: Props = $props();
	const editor = getEditor();

	// Read once: the dialog edits what the feature was on when it opened.
	const now = untrack(() =>
		currentRepeat(
			editor.graph,
			id,
			level,
			levels.map((l) => l.level),
			near,
		),
	);
	let method = $state<RepeatMethod>(now.method);
	let chosen = $state<number[]>([...now.levels]);

	/** The levels offered: those in view and those it is on now, but the one shown. */
	const offered = $derived.by(() => {
		const byLevel = new Map(levels.map((l) => [l.level, l]));
		for (const l of now.levels)
			if (!byLevel.has(l)) byLevel.set(l, { level: l });
		return [...byLevel.values()]
			.filter((l) => l.level !== level)
			.sort((a, b) => b.level - a.level);
	});

	function choose(other: number, on: boolean) {
		chosen = on ? [...chosen, other] : chosen.filter((l) => l !== other);
	}

	function apply() {
		editor.history.perform(
			repeatOnLevels(id, level, { method, levels: chosen }, now, near),
			msg("undo_repeat_levels"),
		);
		onclose();
	}

	const METHODS: { value: RepeatMethod; label: string; hint: string }[] = [
		{
			value: "copies",
			label: "A copy on each level",
			hint: "Separate features, sharing corners with what is mapped there",
		},
		{
			value: "repeat_on",
			label: "One feature with repeat_on",
			hint: "Keeps level, lists the other levels in repeat_on",
		},
		{
			value: "level",
			label: "One feature on several levels",
			hint: "Lists every level in level, as one feature spanning them",
		},
	];
</script>

<Dialog.Root
	open
	onOpenChange={(open) => {
		if (!open) onclose();
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Repeat on levels</Dialog.Title>
			<Dialog.Description>
				On level {level} and the levels checked here.
			</Dialog.Description>
		</Dialog.Header>
		<Field.Set>
			<Field.Legend variant="label">Levels</Field.Legend>
			{#if offered.length === 0}
				<p class="text-sm text-muted-foreground">
					No other level is in view. Move the map over the building first.
				</p>
			{/if}
			<div class="flex max-h-60 flex-col gap-2 overflow-y-auto">
				{#each offered as entry (entry.level)}
					{@const checkboxId = `repeat-level-${entry.level}`}
					<Field.Field orientation="horizontal">
						<Checkbox
							id={checkboxId}
							checked={chosen.includes(entry.level)}
							onCheckedChange={(on) => choose(entry.level, on)}
						/>
						<Field.Label for={checkboxId} class="font-normal">
							{fullLabel(entry)}
							{#if now.copies.has(entry.level)}
								<span class="text-muted-foreground">(a copy is there)</span>
							{/if}
						</Field.Label>
					</Field.Field>
				{/each}
			</div>
		</Field.Set>
		<Field.Set>
			<Field.Legend variant="label">How</Field.Legend>
			<RadioGroup.Root
				value={method}
				onValueChange={(value) => (method = value as RepeatMethod)}
			>
				{#each METHODS as option (option.value)}
					{@const radioId = `repeat-method-${option.value}`}
					<Field.Field orientation="horizontal">
						<RadioGroup.Item value={option.value} id={radioId} />
						<Field.Content>
							<Field.Label for={radioId} class="font-normal">
								{option.label}
							</Field.Label>
							<Field.Description>{option.hint}</Field.Description>
						</Field.Content>
					</Field.Field>
				{/each}
			</RadioGroup.Root>
		</Field.Set>
		<Dialog.Footer>
			<Button variant="outline" onclick={onclose}>Cancel</Button>
			<Button onclick={apply}>Apply</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
