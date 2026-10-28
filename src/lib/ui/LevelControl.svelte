<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import ChevronUp from "@lucide/svelte/icons/chevron-up";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";
	import {
		fullLabel,
		type LevelEntry,
		shortLabel,
	} from "#lib/levels/level-names.ts";

	interface Props {
		level: number;
		/**
		 * The levels of the data in view, sorted ascending, with their names. Without any,
		 * levels step by one and no list shows.
		 */
		levels?: readonly LevelEntry[];
	}

	let { level = $bindable(), levels = [] }: Props = $props();

	const numbers = $derived(levels.map((e) => e.level));
	const above = $derived(numbers.find((l) => l > level));
	const below = $derived(numbers.findLast((l) => l < level));
	const descending = $derived([...levels].reverse());
	/** The level shown, named when the data in view names it. */
	const current = $derived(levels.find((e) => e.level === level) ?? { level });

	const upTarget = $derived(levels.length > 0 ? above : level + 1);
	const downTarget = $derived(levels.length > 0 ? below : level - 1);

	const selectedValue = () => String(level);
	function selectLevel(value: string) {
		// Clicking the current level again would unselect it: keep it.
		if (value) level = Number(value);
	}

	/** A level's accessible name: its number, then its names, which the button shows. */
	function accessibleName(entry: LevelEntry): string {
		const label = fullLabel(entry);
		return entry.ref === undefined && entry.name === undefined
			? label
			: `Level ${String(entry.level)}: ${label}`;
	}
</script>

{#snippet stepButton(
	label: string,
	Icon: typeof ChevronUp,
	target: number | undefined,
)}
	<Tooltip.Root>
		<Tooltip.Trigger
			disabled={target === undefined}
			onclick={() => {
				if (target !== undefined) level = target;
			}}
		>
			{#snippet child({
				props,
			})}
				<Button
					{...props}
					variant="outline"
					size="icon"
					aria-label={label}
					disabled={target === undefined}
				>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="left">{label}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<ButtonGroup.Root
	orientation="vertical"
	aria-label="Level"
	class="max-w-20 rounded-md bg-background shadow-md"
>
	{@render stepButton("Level up", ChevronUp, upTarget)}
	<ButtonGroup.Text class="justify-center px-1 tabular-nums">
		{#snippet child({
			props,
		})}
			<output
				{...props}
				aria-label="Current level"
				data-testid="level"
				data-level={level}
			>
				{shortLabel(current)}
			</output>
		{/snippet}
	</ButtonGroup.Text>
	{#if descending.length > 1}
		<ToggleGroup.Root
			type="single"
			orientation="vertical"
			variant="outline"
			aria-label="Levels"
			class="max-h-64 w-full overflow-y-auto"
			bind:value={selectedValue, selectLevel}
		>
			{#each descending as entry (entry.level)}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({
							props,
						})}
							<ToggleGroup.Item
								{...props}
								value={String(entry.level)}
								aria-label={accessibleName(entry)}
								class="px-1 tabular-nums"
							>
								{shortLabel(entry)}
							</ToggleGroup.Item>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="left">{fullLabel(entry)}</Tooltip.Content>
				</Tooltip.Root>
			{/each}
		</ToggleGroup.Root>
	{/if}
	{@render stepButton("Level down", ChevronDown, downTarget)}
</ButtonGroup.Root>
