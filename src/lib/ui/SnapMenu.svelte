<script lang="ts" module>
	import type { FramePick } from "#lib/edit/modes/frame-pick.ts";
	import type { BuildingFrame } from "#lib/state/frames.svelte.ts";

	/** The drawing frame in the middle of the map, and what can be done to it (C.3). */
	export interface FrameControls {
		readonly current: BuildingFrame | null;
		/** Floor plans on the shown level whose angle can be taken. */
		readonly plans: readonly { name: string; angle: number }[];
		onangle(angle: number): void;
		onreset(): void;
		onpick(pick: FramePick): void;
		onturn(): void;
		onnorth(): void;
	}

	/** The shown level's construction guides (C.5): how many, shown or not, and their pane. */
	export interface GuideControls {
		readonly count: number;
		readonly shown: boolean;
		onshow(shown: boolean): void;
		/** Opens the guides pane, which lists them. */
		onmanage(): void;
	}
</script>

<script lang="ts">
	import Grid3x3 from "@lucide/svelte/icons/grid-3x3";
	import Magnet from "@lucide/svelte/icons/magnet";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import { Label } from "#lib/components/shadcn/label/index.ts";
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import { Separator } from "#lib/components/shadcn/separator/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";
	import { type Message, msg, t } from "#lib/i18n/messages.ts";
	import {
		ANGLE_STEPS,
		type PrecisionSettings,
		SNAP_OPTIONS,
		type SnapOption,
	} from "#lib/state/precision.svelte.ts";
	import { formatAngle, formatLength, parseLength } from "#lib/units/length.ts";

	interface Props {
		precision: PrecisionSettings;
		frame?: FrameControls;
		guides?: GuideControls;
		/** The menu opened or closed (the frame is worked out while it is open). */
		onopenchange?: (open: boolean) => void;
	}

	let { precision, frame, guides, onopenchange }: Props = $props();
	let open = $state(false);
	let angleText = $state("");
	let minorText = $state("");
	let majorText = $state("");

	function opened(next: boolean) {
		open = next;
		onopenchange?.(next);
		if (next) {
			angleText = frame?.current
				? String(round(frame.current.frame.angle))
				: "";
			minorText = formatLength(precision.gridMinor, precision.units);
			majorText = formatLength(precision.gridMajor, precision.units);
		}
	}

	const round = (n: number) => Math.round(n * 100) / 100;

	function applyAngle() {
		const angle = Number(angleText.replace(",", "."));
		if (Number.isFinite(angle)) frame?.onangle(angle);
	}

	function applySpacing() {
		const minor = parseLength(minorText, precision.units);
		const major = parseLength(majorText, precision.units);
		if (
			minor === null ||
			major === null ||
			!precision.setGridSpacing(minor, major)
		) {
			minorText = formatLength(precision.gridMinor, precision.units);
			majorText = formatLength(precision.gridMajor, precision.units);
		}
	}

	function pick(kind: FramePick) {
		opened(false);
		frame?.onpick(kind);
	}
	const id = $props.id();

	const OPTION_LABELS: Record<SnapOption, Message> = {
		points: msg("snap_points"),
		midpoints: msg("snap_midpoints"),
		planVertices: msg("snap_plan_vertices"),
		angles: msg("snap_angles"),
		grid: msg("snap_grid"),
		extensions: msg("snap_extensions"),
		parallels: msg("snap_parallels"),
		tracking: msg("snap_tracking"),
		intersections: msg("snap_intersections"),
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
	<Tooltip.Root>
		<Tooltip.Trigger onclick={() => precision.toggleGrid()}>
			{#snippet child({ props })}
				<Button
					{...props}
					variant={precision.grid ? "secondary" : "outline"}
					size="icon"
					aria-label={t(msg("grid_show"))}
					aria-pressed={precision.grid}
				>
					<Grid3x3 />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom"
			>{t(msg("grid_show_hint", { key: "G" }))}</Tooltip.Content
		>
	</Tooltip.Root>
	<Popover.Root bind:open={() => open, opened}>
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
		<Popover.Content
			align="start"
			class="flex max-h-(--bits-popover-content-available-height) w-80 flex-col gap-3 overflow-y-auto text-sm"
		>
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
			<Separator />
			<div class="flex items-center gap-2">
				<Checkbox
					id="{id}-grid"
					checked={precision.grid}
					onCheckedChange={() => precision.toggleGrid()}
				/>
				<Label for="{id}-grid">{t(msg("grid_show"))} (G)</Label>
			</div>
			<form
				class="grid grid-cols-2 gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					applySpacing();
				}}
			>
				<Label class="flex flex-col items-start gap-1 text-xs"
					>{t(msg("grid_minor"))}
					<Input bind:value={minorText} onchange={applySpacing} class="h-7" />
				</Label>
				<Label class="flex flex-col items-start gap-1 text-xs"
					>{t(msg("grid_major"))}
					<Input bind:value={majorText} onchange={applySpacing} class="h-7" />
				</Label>
			</form>
			{#if frame}
				<Separator />
				<section class="flex flex-col gap-2" aria-labelledby="{id}-frame">
					<h3 id="{id}-frame" class="font-medium">{t(msg("frame_section"))}</h3>
					{#if frame.current}
						<p class="text-xs text-muted-foreground" data-testid="frame-state">
							{t(
								frame.current.set
									? msg("frame_set", {
											angle: formatAngle(frame.current.frame.angle),
										})
									: msg("frame_auto", {
											angle: formatAngle(frame.current.frame.angle),
										}),
							)}
						</p>
						<form
							class="flex items-end gap-2"
							onsubmit={(event) => {
								event.preventDefault();
								applyAngle();
							}}
						>
							<Label class="flex flex-1 flex-col items-start gap-1 text-xs"
								>{t(msg("frame_angle"))}
								<Input bind:value={angleText} inputmode="decimal" class="h-7" />
							</Label>
							<Button type="submit" variant="outline" size="sm">OK</Button>
						</form>
						<div class="flex flex-wrap gap-1.5">
							<Button variant="outline" size="sm" onclick={() => pick("align")}
								>{t(msg("frame_align"))}</Button
							>
							<Button variant="outline" size="sm" onclick={() => pick("origin")}
								>{t(msg("frame_origin"))}</Button
							>
							{#each frame.plans as plan (plan.name)}
								<Button
									variant="outline"
									size="sm"
									onclick={() => frame.onangle(plan.angle)}
									>{t(msg("frame_plan", { name: plan.name }))}</Button
								>
							{/each}
							{#if frame.current.set}
								<Button
									variant="outline"
									size="sm"
									onclick={() => frame.onreset()}
									>{t(msg("frame_reset"))}</Button
								>
							{/if}
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">{t(msg("frame_none"))}</p>
					{/if}
					<div class="flex flex-wrap gap-1.5">
						<Button variant="outline" size="sm" onclick={() => frame.onturn()}
							>{t(msg("frame_turn"))}</Button
						>
						<Button variant="outline" size="sm" onclick={() => frame.onnorth()}
							>{t(msg("frame_north"))}</Button
						>
					</div>
				</section>
			{/if}
			{#if guides}
				<Separator />
				<section class="flex flex-col gap-2" aria-labelledby="{id}-guides">
					<h3 id="{id}-guides" class="font-medium">
						{t(msg("guides_section"))}
					</h3>
					<p class="text-xs text-muted-foreground" data-testid="guides-count">
						{t(msg("guides_count", { count: String(guides.count) }))}
					</p>
					<div class="flex items-center gap-2">
						<Checkbox
							id="{id}-guides-shown"
							checked={guides.shown}
							onCheckedChange={(on) => guides.onshow(on === true)}
						/>
						<Label for="{id}-guides-shown">{t(msg("guides_show"))}</Label>
					</div>
					<Button
						variant="outline"
						size="sm"
						class="self-start"
						onclick={() => {
							opened(false);
							guides.onmanage();
						}}
						>{t(msg("guides_manage"))}</Button
					>
				</section>
			{/if}
		</Popover.Content>
	</Popover.Root>
</ButtonGroup.Root>
