<script lang="ts">
	/**
	 * The editor's Map data pane (A.4), after iD's: how areas are filled, Highlight changes and
	 * its palette, and the colours of the grid, new guides and the selection.
	 */
	import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
	import X from "@lucide/svelte/icons/x";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import * as RadioGroup from "#lib/components/shadcn/radio-group/index.ts";
	import { Slider } from "#lib/components/shadcn/slider/index.ts";
	import { type Message, msg, t } from "#lib/i18n/messages.ts";
	import type { AreaFill } from "#lib/map/style/colors.ts";
	import type { EditPalette } from "#lib/map/style/layers.ts";
	import {
		type Appearance,
		type AppearanceSettings,
		DEFAULT_APPEARANCE,
	} from "#lib/state/appearance.svelte.ts";
	import type { BackgroundSettings } from "#lib/state/background.svelte.ts";

	interface Props {
		settings: BackgroundSettings;
		appearance: AppearanceSettings;
		onclose: () => void;
	}

	let { settings, appearance, onclose }: Props = $props();

	const FILLS: { fill: AreaFill; name: Message; hint: Message }[] = [
		{
			fill: "wireframe",
			name: msg("area_fill_wireframe"),
			hint: msg("area_fill_wireframe_hint"),
		},
		{
			fill: "partial",
			name: msg("area_fill_partial"),
			hint: msg("area_fill_partial_hint"),
		},
		{
			fill: "full",
			name: msg("area_fill_full"),
			hint: msg("area_fill_full_hint"),
		},
	];

	const PALETTES: { palette: EditPalette; name: Message; hint: Message }[] = [
		{
			palette: "indoorid",
			name: msg("edit_palette_indoorid"),
			hint: msg("edit_palette_indoorid_hint"),
		},
		{
			palette: "id",
			name: msg("edit_palette_id"),
			hint: msg("edit_palette_id_hint"),
		},
	];

	const COLORS: {
		key: "gridColor" | "guideColor" | "selectionColor" | "drawingColor";
		label: Message;
	}[] = [
		{ key: "selectionColor", label: msg("appearance_selection") },
		{ key: "drawingColor", label: msg("appearance_drawing") },
		{ key: "gridColor", label: msg("appearance_grid") },
		{ key: "guideColor", label: msg("appearance_guide") },
	];

	const OPACITIES: {
		key: "gridMinorOpacity" | "gridMajorOpacity";
		label: Message;
	}[] = [
		{ key: "gridMinorOpacity", label: msg("appearance_grid_minor") },
		{ key: "gridMajorOpacity", label: msg("appearance_grid_major") },
	];

	const changed = $derived(
		(Object.keys(DEFAULT_APPEARANCE) as (keyof Appearance)[]).some(
			(key) => appearance.current[key] !== DEFAULT_APPEARANCE[key],
		),
	);
</script>

<aside
	aria-label={t(msg("map_data"))}
	data-testid="map-data-pane"
	class="flex h-full w-full flex-col border-l bg-background shadow-lg"
>
	<header class="flex items-center gap-2 border-b py-2 pr-2 pl-4">
		<h2 class="flex-1 text-sm font-semibold">{t(msg("map_data"))}</h2>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={t(msg("map_data_close"))}
			onclick={onclose}
		>
			<X />
		</Button>
	</header>

	<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
		<Field.Set>
			<Field.Legend variant="label">{t(msg("area_fill"))}</Field.Legend>
			<RadioGroup.Root
				value={settings.areaFill}
				onValueChange={(fill) => settings.setAreaFill(fill as AreaFill)}
			>
				{#each FILLS as { fill, name, hint } (fill)}
					{@render option("area-fill", fill, t(name), t(hint))}
				{/each}
			</RadioGroup.Root>
		</Field.Set>

		<Field.Set>
			<Field.Legend variant="label">{t(msg("highlight_edits"))}</Field.Legend>
			<Field.Field orientation="horizontal">
				<Checkbox
					id="highlight-edits"
					checked={settings.highlightEdits}
					onCheckedChange={(on) => settings.setHighlightEdits(on === true)}
				/>
				<Field.Content>
					<Field.Label for="highlight-edits" class="font-normal"
						>{t(msg("highlight_edits"))}</Field.Label
					>
					<Field.Description
						>{t(msg("highlight_edits_hint"))}</Field.Description
					>
				</Field.Content>
			</Field.Field>
			<RadioGroup.Root
				aria-label={t(msg("edit_palette"))}
				value={appearance.editPalette}
				disabled={!settings.highlightEdits}
				onValueChange={(palette) =>
					appearance.set({ editPalette: palette as EditPalette })}
			>
				{#each PALETTES as { palette, name, hint } (palette)}
					{@render option("edit-palette", palette, t(name), t(hint))}
				{/each}
			</RadioGroup.Root>
		</Field.Set>

		<Field.Set>
			<Field.Legend variant="label">{t(msg("appearance_colors"))}</Field.Legend>
			{#each COLORS as { key, label } (key)}
				<Field.Field orientation="horizontal">
					<input
						id="appearance-{key}"
						type="color"
						class="h-9 w-14 shrink-0 cursor-pointer rounded-md border bg-background p-1"
						value={appearance[key]}
						oninput={(event) =>
							appearance.set({ [key]: event.currentTarget.value })}
					>
					<Field.Label for="appearance-{key}" class="font-normal"
						>{t(label)}</Field.Label
					>
				</Field.Field>
			{/each}
			{#each OPACITIES as { key, label } (key)}
				<Field.Field>
					<div class="flex items-center justify-between">
						<Field.Label for="appearance-{key}">{t(label)}</Field.Label>
						<span class="text-sm text-muted-foreground tabular-nums"
							>{Math.round(appearance[key] * 100)}%</span
						>
					</div>
					<Slider
						id="appearance-{key}"
						type="single"
						min={0.1}
						max={1}
						step={0.05}
						value={appearance[key]}
						onValueChange={(value: number) => appearance.set({ [key]: value })}
					/>
				</Field.Field>
			{/each}
			<Button
				variant="ghost"
				size="sm"
				class="self-end"
				disabled={!changed}
				onclick={() => appearance.reset()}
			>
				<RotateCcw data-icon="inline-start" />
				{t(msg("appearance_reset"))}
			</Button>
		</Field.Set>
	</div>
</aside>

{#snippet option(group: string, value: string, name: string, hint?: string)}
	{@const id = `${group}-${value}`}
	<Field.Field orientation="horizontal">
		<RadioGroup.Item {value} {id} />
		<Field.Content>
			<Field.Label for={id} class="font-normal">{name}</Field.Label>
			{#if hint}
				<Field.Description>{hint}</Field.Description>
			{/if}
		</Field.Content>
	</Field.Field>
{/snippet}
