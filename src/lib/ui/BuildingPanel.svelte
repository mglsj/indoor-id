<script lang="ts">
	/**
	 * The side panel in building mode with nothing selected (B.2): the building entered, its
	 * levels (a click shows one), whether its surroundings are drawn, and a button to leave (as
	 * the header's Done).
	 */
	import X from "@lucide/svelte/icons/x";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import type { ScopeKind } from "#lib/edit/scope.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import { fullLabel, type LevelEntry } from "#lib/levels/level-names.ts";

	interface Props {
		/** The building's name, or what stands in for it. */
		name: string;
		kind: ScopeKind;
		/** The levels mapped in the building, ascending. */
		levels: readonly LevelEntry[];
		/** The shown level. */
		level: number;
		/** Whether what is outside the building is drawn (faded). */
		surroundings: boolean;
		/** Shows a level. */
		onshowlevel: (level: number) => void;
		/** Draws the surroundings, or hides them. */
		onsurroundings: (on: boolean) => void;
		/** Leaves the building. */
		ondone: () => void;
	}

	let {
		name,
		kind,
		levels,
		level,
		surroundings,
		onshowlevel,
		onsurroundings,
		ondone,
	}: Props = $props();

	/** Top floor first, as the level switcher lists them. */
	const descending = $derived([...levels].reverse());
</script>

<aside
	aria-label={name}
	data-testid="building-panel"
	class="flex h-full w-full flex-col border-r bg-background shadow-lg"
>
	<header class="flex items-center gap-2 border-b px-4 py-3">
		<div class="min-w-0 flex-1">
			<h2 class="truncate text-base font-semibold">{name}</h2>
			<p class="text-xs text-muted-foreground">
				{t(
					msg(
						kind === "building"
							? "building_kind_building"
							: "building_kind_level",
					),
				)}
			</p>
		</div>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={t(msg("building_done_hint"))}
			title={t(msg("building_done_hint"))}
			onclick={ondone}
		>
			<X />
		</Button>
	</header>
	<div class="flex flex-col gap-4 overflow-y-auto px-4 py-3 text-sm">
		<p class="text-muted-foreground">{t(msg("building_help"))}</p>
		<section class="flex flex-col gap-2">
			<h3 class="font-medium">{t(msg("building_levels"))}</h3>
			{#if descending.length > 0}
				<ul class="flex flex-col gap-1">
					{#each descending as entry (entry.level)}
						<li>
							<Button
								variant={entry.level === level ? "secondary" : "ghost"}
								size="sm"
								class="w-full justify-start"
								aria-pressed={entry.level === level}
								onclick={() => onshowlevel(entry.level)}
							>
								{fullLabel(entry)}
							</Button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-muted-foreground">{t(msg("building_no_levels"))}</p>
			{/if}
		</section>
		<Field.Field orientation="horizontal">
			<Checkbox
				id="building-surroundings"
				checked={surroundings}
				onCheckedChange={(on) => onsurroundings(on === true)}
			/>
			<Field.Content>
				<Field.Label for="building-surroundings" class="font-normal">
					{t(msg("building_surroundings"))}
				</Field.Label>
				<Field.Description>
					{t(msg("building_surroundings_hint"))}
				</Field.Description>
			</Field.Content>
		</Field.Field>
	</div>
</aside>
