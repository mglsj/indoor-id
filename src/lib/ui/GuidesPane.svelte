<script lang="ts">
	/**
	 * The construction guides (C.5), in a pane on the right of the map as the background's:
	 * the shown level's guides, each to recolour, hide, delete or find on the map (pointing at
	 * one draws it bold), all of them hidden at once or the level's cleared, and the other
	 * levels that have guides.
	 */
	import Eye from "@lucide/svelte/icons/eye";
	import EyeOff from "@lucide/svelte/icons/eye-off";
	import Plus from "@lucide/svelte/icons/plus";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import X from "@lucide/svelte/icons/x";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import type { ConstructionGuide } from "#lib/edit/precision/construction.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import { INDOOR_COLORS } from "#lib/map/style/colors.ts";
	import type { Guides } from "#lib/state/guides.svelte.ts";

	interface Props {
		guides: Guides;
		/** The shown level. */
		level: number;
		/** The tool's shortcut, as shown ("M"). */
		toolKey: string;
		/** Turns the measure and guide tool on, placing guides. */
		onplace: () => void;
		/** Shows another level. */
		onlevel: (level: number) => void;
		/** The guide pointed at in the list, drawn bold on the map; null when none. */
		onhighlight: (id: string | null) => void;
		/** Moves the map to a guide. */
		onlocate: (guide: ConstructionGuide) => void;
		onclose: () => void;
	}

	let {
		guides,
		level,
		toolKey,
		onplace,
		onlevel,
		onhighlight,
		onlocate,
		onclose,
	}: Props = $props();

	const listed = $derived(guides.listOn(level));
	const others = $derived(guides.levels().filter((l) => l.level !== level));

	/** A guide's direction, as a line has: 0° to 180° from east, counterclockwise. */
	function direction(angle: number): string {
		const a = ((angle % 180) + 180) % 180;
		return String(Math.round(a * 10) / 10);
	}
</script>

<aside
	aria-label={t(msg("guides_section"))}
	data-testid="guides-pane"
	class="flex h-full w-full flex-col border-l bg-background shadow-lg"
>
	<header class="flex items-center gap-2 border-b py-2 pr-2 pl-4">
		<h2 class="flex-1 text-sm font-semibold">{t(msg("guides_section"))}</h2>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={t(msg("guides_close"))}
			onclick={onclose}
		>
			<X />
		</Button>
	</header>

	<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
		<div class="flex flex-col gap-3">
			<p class="text-sm text-muted-foreground">{t(msg("guides_intro"))}</p>
			<Button variant="outline" size="sm" class="self-start" onclick={onplace}>
				<Plus data-icon="inline-start" />
				{t(msg("guides_place"))}
				<kbd class="ml-1 text-xs text-muted-foreground">{toolKey}</kbd>
			</Button>
			<Field.Field orientation="horizontal">
				<Checkbox
					id="guides-shown"
					checked={guides.shown}
					onCheckedChange={(on) => (guides.shown = on === true)}
				/>
				<Field.Label for="guides-shown" class="font-normal"
					>{t(msg("guides_show"))}</Field.Label
				>
			</Field.Field>
		</div>

		<section class="flex flex-col gap-2" aria-labelledby="guides-this-level">
			<h3 id="guides-this-level" class="text-sm font-medium">
				{t(msg("guides_this_level"))}
			</h3>
			{#if listed.length === 0}
				<p class="text-sm text-muted-foreground">
					{t(msg("guides_none", { key: toolKey }))}
				</p>
			{:else}
				<ul class="flex flex-col gap-0.5" data-testid="guides-list">
					{#each listed as guide, index (guide.id)}
						{@const n = String(index + 1)}
						{@const hidden = guide.hidden === true}
						<li
							class={[
								"flex items-center gap-2 rounded-md py-1 pr-1 pl-2 hover:bg-muted focus-within:bg-muted",
								(hidden || !guides.shown) && "text-muted-foreground",
							]}
							onpointerenter={() => onhighlight(guide.id)}
							onpointerleave={() => onhighlight(null)}
							onfocusin={() => onhighlight(guide.id)}
							onfocusout={() => onhighlight(null)}
						>
							<input
								type="color"
								class={[
									"size-6 shrink-0 cursor-pointer rounded border bg-background p-0.5",
									hidden && "opacity-50",
								]}
								aria-label={t(msg("guide_color", { n }))}
								title={t(msg("guide_color", { n }))}
								value={guide.color ?? INDOOR_COLORS.guide}
								oninput={(event) =>
									guides.update(guide.id, { color: event.currentTarget.value })}
							>
							<button
								type="button"
								class="flex min-w-0 flex-1 flex-col items-start rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								title={t(msg("guide_locate", { n }))}
								onclick={() => onlocate(guide)}
							>
								<span class="text-sm">{t(msg("guide_name", { n }))}</span>
								<span class="text-xs text-muted-foreground tabular-nums"
									>{t(
										msg("guide_angle", { angle: direction(guide.angle) }),
									)}</span
								>
							</button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t(msg(hidden ? "guide_show" : "guide_hide", { n }))}
								title={t(msg(hidden ? "guide_show" : "guide_hide", { n }))}
								aria-pressed={hidden}
								onclick={() => guides.update(guide.id, { hidden: !hidden })}
							>
								{#if hidden}
									<EyeOff />
								{:else}
									<Eye />
								{/if}
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t(msg("guide_delete", { n }))}
								title={t(msg("guide_delete", { n }))}
								onclick={() => {
									onhighlight(null);
									guides.remove(guide.id);
								}}
							>
								<Trash2 />
							</Button>
						</li>
					{/each}
				</ul>
				<Button
					variant="outline"
					size="sm"
					class="self-start"
					onclick={() => {
						onhighlight(null);
						guides.clear(level);
					}}
				>
					{t(msg("guides_clear"))}
				</Button>
			{/if}
		</section>

		{#if others.length > 0}
			<section
				class="flex flex-col gap-2"
				aria-labelledby="guides-other-levels"
			>
				<h3 id="guides-other-levels" class="text-sm font-medium">
					{t(msg("guides_other_levels"))}
				</h3>
				<ul class="flex flex-col gap-0.5">
					{#each others as other (other.level)}
						<li>
							<button
								type="button"
								class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
								title={t(
									msg("guides_go_level", { level: String(other.level) }),
								)}
								onclick={() => onlevel(other.level)}
							>
								<span
									>{t(
										msg("guides_on_level", { level: String(other.level) }),
									)}</span
								>
								<span class="text-xs text-muted-foreground tabular-nums"
									>{other.count}</span
								>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</aside>
