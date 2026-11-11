<script lang="ts">
	import Magnet from "@lucide/svelte/icons/magnet";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import { Label } from "#lib/components/shadcn/label/index.ts";
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";
	import { type Message, msg, t } from "#lib/i18n/messages.ts";
	import {
		ANGLE_STEPS,
		type PrecisionSettings,
		SNAP_OPTIONS,
		type SnapOption,
	} from "#lib/state/precision.svelte.ts";

	interface Props {
		precision: PrecisionSettings;
	}

	let { precision }: Props = $props();
	const id = $props.id();

	const OPTION_LABELS: Record<SnapOption, Message> = {
		points: msg("snap_points"),
		midpoints: msg("snap_midpoints"),
		planVertices: msg("snap_plan_vertices"),
		angles: msg("snap_angles"),
	};
</script>

<!-- Snapping on or off (S), and a menu of what snaps (C.1). -->
<ButtonGroup.Root aria-label={t(msg("snap_menu"))}>
	<Tooltip.Root>
		<Tooltip.Trigger onclick={() => precision.toggle()}>
			{#snippet child({ props })}
				<Button
					{...props}
					variant={precision.enabled ? "secondary" : "outline"}
					size="icon"
					aria-label={t(msg("snap_menu"))}
					aria-pressed={precision.enabled}
				>
					<Magnet />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom"
			>{t(msg("snap_menu_hint", { key: "S" }))}</Tooltip.Content
		>
	</Tooltip.Root>
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					size="icon"
					class="w-6"
					aria-label={`${t(msg("snap_menu"))}…`}
				>
					<span aria-hidden="true" class="text-xs">▾</span>
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="start" class="flex w-72 flex-col gap-3 text-sm">
			<div class="flex items-center gap-2">
				<Checkbox
					id="{id}-enabled"
					checked={precision.enabled}
					onCheckedChange={() => precision.toggle()}
				/>
				<Label for="{id}-enabled">{t(msg("snap_enabled"))}</Label>
			</div>
			<fieldset class="flex flex-col gap-2 ps-6" disabled={!precision.enabled}>
				{#each SNAP_OPTIONS as option (option)}
					<div class="flex items-center gap-2">
						<Checkbox
							id="{id}-{option}"
							checked={precision.options[option]}
							disabled={!precision.enabled}
							onCheckedChange={(on) => precision.setOption(option, on === true)}
						/>
						<Label for="{id}-{option}">{t(OPTION_LABELS[option])}</Label>
					</div>
				{/each}
			</fieldset>
			<div class="flex flex-col gap-1.5">
				<span id="{id}-step" class="font-medium"
					>{t(msg("snap_angle_step"))}</span
				>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					size="sm"
					aria-labelledby="{id}-step"
					disabled={!precision.snaps("angles")}
					value={String(precision.angleStep)}
					onValueChange={(value) =>
						value && precision.setAngleStep(Number(value))}
				>
					{#each ANGLE_STEPS as step (step)}
						<ToggleGroup.Item value={String(step)} class="px-1.5 tabular-nums"
							>{step}°</ToggleGroup.Item
						>
					{/each}
				</ToggleGroup.Root>
			</div>
			<div class="flex flex-col gap-1.5">
				<span id="{id}-units" class="font-medium">{t(msg("snap_units"))}</span>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					size="sm"
					aria-labelledby="{id}-units"
					value={precision.units}
					onValueChange={(value) =>
						(value === "metric" || value === "imperial") &&
						precision.setUnits(value)}
				>
					<ToggleGroup.Item value="metric"
						>{t(msg("units_metric"))}</ToggleGroup.Item
					>
					<ToggleGroup.Item value="imperial"
						>{t(msg("units_imperial"))}</ToggleGroup.Item
					>
				</ToggleGroup.Root>
			</div>
			<p class="text-xs text-muted-foreground">{t(msg("snap_note"))}</p>
		</Popover.Content>
	</Popover.Root>
</ButtonGroup.Root>
