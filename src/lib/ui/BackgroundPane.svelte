<script lang="ts">
	/**
	 * The background settings, in a pane on the right of the map as iD's: the vector map,
	 * Esri's imagery, a custom tile URL or a solid colour, and the imagery's offset (iD's
	 * Imagery Offset section: a gray area to drag, arrows around it and the value in it).
	 */
	import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
	import Undo2 from "@lucide/svelte/icons/undo-2";
	import X from "@lucide/svelte/icons/x";
	import { onDestroy, untrack } from "svelte";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import * as RadioGroup from "#lib/components/shadcn/radio-group/index.ts";
	import { Slider } from "#lib/components/shadcn/slider/index.ts";
	import { formatCombo, isMac } from "#lib/edit/keys.ts";
	import { type Message, msg, t } from "#lib/i18n/messages.ts";
	import {
		type BackgroundId,
		customImagery,
		ESRI_IMAGERY,
		type ImageryDisplay,
	} from "#lib/map/backgrounds.ts";
	import type { AreaFill } from "#lib/map/style/colors.ts";
	import {
		type BackgroundSettings,
		formatOffset,
		parseOffset,
	} from "#lib/state/background.svelte.ts";

	interface Props {
		settings: BackgroundSettings;
		/** Whether the area fill is offered (the editor's; the viewer fills areas whole). */
		showFill?: boolean;
		/** Ground metres per screen pixel at the map's centre, for dragging the offset. */
		metresPerPixel?: () => number;
		onclose: () => void;
	}

	let {
		settings,
		showFill = false,
		metresPerPixel = () => 0,
		onclose,
	}: Props = $props();

	const DISPLAY: {
		name: keyof ImageryDisplay;
		label: Message;
		min: number;
	}[] = [
		{ name: "brightness", label: msg("imagery_brightness"), min: 0.25 },
		{ name: "contrast", label: msg("imagery_contrast"), min: 0 },
		{ name: "saturation", label: msg("imagery_saturation"), min: 0 },
	];
	const displayChanged = $derived(
		DISPLAY.some(({ name }) => settings.display[name] !== 1),
	);

	/**
	 * iD's drag to move the imagery: it follows a quarter of the pointer's moves, for fine
	 * control. Moves are applied once per frame: only the tiles' URL changes, and they are
	 * drawn again from the tiles already loaded.
	 */
	const DRAG_SLOWDOWN = 4;
	let dragging: { id: number; x: number; y: number } | null = null;
	let pending = { east: 0, north: 0 };
	let frame: number | undefined;

	function flushDrag() {
		frame = undefined;
		if (pending.east === 0 && pending.north === 0) return;
		offsetDraft = null;
		settings.nudge(pending.east, pending.north);
		pending = { east: 0, north: 0 };
	}

	function startDrag(event: PointerEvent) {
		if (event.button !== 0 || !imageryShown) return;
		// The value field inside the area is typed in, not dragged.
		if (event.target instanceof HTMLInputElement) return;
		dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function moveDrag(event: PointerEvent) {
		if (!dragging || event.pointerId !== dragging.id) return;
		const metres = metresPerPixel() / DRAG_SLOWDOWN;
		pending.east += (event.clientX - dragging.x) * metres;
		pending.north -= (event.clientY - dragging.y) * metres;
		dragging = { ...dragging, x: event.clientX, y: event.clientY };
		frame ??= requestAnimationFrame(flushDrag);
	}

	function endDrag(event: PointerEvent) {
		if (!dragging || event.pointerId !== dragging.id) return;
		dragging = null;
		if (frame !== undefined) cancelAnimationFrame(frame);
		flushDrag();
	}

	/** iD's arrows: a press moves the imagery once, and again and again while held. */
	const REPEAT_AFTER = 500;
	const REPEAT_EVERY = 100;
	let repeat: ReturnType<typeof setTimeout> | undefined;

	function nudgeBy(east: number, north: number, far: boolean) {
		const step = far ? BIG_STEP : STEP;
		offsetDraft = null;
		settings.nudge(east * step, north * step);
	}

	function startNudge(event: PointerEvent, east: number, north: number) {
		if (event.button !== 0 || !imageryShown) return;
		event.preventDefault();
		const far = event.shiftKey;
		nudgeBy(east, north, far);
		stopNudge();
		repeat = setTimeout(function again() {
			nudgeBy(east, north, far);
			repeat = setTimeout(again, REPEAT_EVERY);
		}, REPEAT_AFTER);
	}

	function stopNudge() {
		clearTimeout(repeat);
		repeat = undefined;
	}

	onDestroy(() => {
		stopNudge();
		if (frame !== undefined) cancelAnimationFrame(frame);
	});

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

	/** Metres moved by a nudge button, and with Shift. */
	const STEP = 0.5;
	const BIG_STEP = 5;

	const PLACEHOLDERS = [
		"{z}",
		"{x}",
		"{y}",
		"{-y}",
		"{quadkey}",
		"{switch:a,b}",
	];

	/** The custom URL being typed, applied on Enter or when the field is left. */
	let customDraft = $state(untrack(() => settings.custom));
	const customInvalid = $derived(
		settings.id === "custom" &&
			settings.custom !== "" &&
			customImagery(settings.custom) === null,
	);

	/** The offset being typed; shown from the settings while the field isn't edited. */
	let offsetDraft = $state<string | null>(null);
	const offsetText = $derived(offsetDraft ?? formatOffset(settings.offset));
	const offsetInvalid = $derived(
		offsetDraft !== null && parseOffset(offsetDraft) === null,
	);
	const imageryShown = $derived(settings.imagery !== null);
	const moved = $derived(
		settings.offset.east !== 0 || settings.offset.north !== 0,
	);

	function applyCustom() {
		settings.setCustom(customDraft);
	}

	function applyOffset() {
		const offset = offsetDraft === null ? null : parseOffset(offsetDraft);
		if (offset) {
			settings.setOffset(offset);
			offsetDraft = null;
		}
	}

	/** The arrows around the gray area, as iD's, with the grid cell each one sits in. */
	const NUDGES: {
		key:
			| "background_move_west"
			| "background_move_north"
			| "background_move_south"
			| "background_move_east";
		east: number;
		north: number;
		/** The triangle's rotation from pointing up. */
		turn: number;
		cell: string;
	}[] = [
		{
			key: "background_move_north",
			east: 0,
			north: 1,
			turn: 0,
			cell: "col-start-2 row-start-1",
		},
		{
			key: "background_move_west",
			east: -1,
			north: 0,
			turn: -90,
			cell: "col-start-1 row-start-2",
		},
		{
			key: "background_move_east",
			east: 1,
			north: 0,
			turn: 90,
			cell: "col-start-3 row-start-2",
		},
		{
			key: "background_move_south",
			east: 0,
			north: -1,
			turn: 180,
			cell: "col-start-2 row-start-3",
		},
	];
</script>

<aside
	aria-label={t(msg("background"))}
	data-testid="background-pane"
	class="flex h-full w-full flex-col border-l bg-background shadow-lg"
>
	<header class="flex items-center gap-2 border-b py-2 pr-2 pl-4">
		<h2 class="flex-1 text-sm font-semibold">{t(msg("background"))}</h2>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={t(msg("background_close"))}
			onclick={onclose}
		>
			<X />
		</Button>
	</header>

	<div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
		<Field.Set>
			<Field.Legend variant="label">{t(msg("background_choice"))}</Field.Legend>
			{#if showFill}
				<Field.Description>
					{t(
						msg("background_swap_hint", { key: formatCombo("Mod+B", isMac()) }),
					)}
				</Field.Description>
			{/if}
			<RadioGroup.Root
				value={settings.id}
				onValueChange={(id) => settings.choose(id as BackgroundId)}
			>
				{@render option("background", "map", t(msg("background_map")))}
				{#each ESRI_IMAGERY as imagery (imagery.id)}
					{@render option("background", imagery.id, imagery.name)}
				{/each}
				{@render option("background", "custom", t(msg("background_custom")))}
				{@render option("background", "solid", t(msg("background_solid")))}
			</RadioGroup.Root>
			{#if settings.id === "solid"}
				<Field.Field orientation="horizontal">
					<input
						id="background-solid-color"
						type="color"
						class="h-9 w-14 shrink-0 cursor-pointer rounded-md border bg-background p-1"
						value={settings.solidColor}
						oninput={(event) =>
							settings.setSolidColor(event.currentTarget.value)}
					>
					<Field.Label for="background-solid-color" class="font-normal"
						>{t(msg("background_solid_color"))}</Field.Label
					>
				</Field.Field>
			{/if}
			{#if settings.id === "custom"}
				<Field.Field data-invalid={customInvalid || undefined}>
					<Field.Label for="background-custom-url"
						>{t(msg("background_custom_url"))}</Field.Label
					>
					<Input
						id="background-custom-url"
						type="url"
						placeholder="https://tiles.example.org/{"{z}"}/{"{x}"}/{"{y}"}.png"
						spellcheck={false}
						aria-invalid={customInvalid || undefined}
						bind:value={customDraft}
						onchange={applyCustom}
						onkeydown={(event) => {
							if (event.key === "Enter") applyCustom();
						}}
					/>
					{#if customInvalid}
						<Field.Error>{t(msg("background_custom_invalid"))}</Field.Error>
					{:else}
						<Field.Description>
							{t(msg("background_custom_hint"))}
							{#each PLACEHOLDERS as placeholder (placeholder)}
								<code class="mx-0.5 rounded bg-muted px-1 font-mono text-xs"
									>{placeholder}</code
								>
							{/each}
						</Field.Description>
					{/if}
				</Field.Field>
			{/if}
		</Field.Set>

		<Field.Set disabled={!imageryShown}>
			<Field.Legend variant="label">{t(msg("imagery_display"))}</Field.Legend>
			{#each DISPLAY as { name, label, min } (name)}
				<Field.Field>
					<div class="flex items-center justify-between">
						<Field.Label for="imagery-{name}">{t(label)}</Field.Label>
						<span class="text-sm text-muted-foreground tabular-nums"
							>{Math.round(settings.display[name] * 100)}%</span
						>
					</div>
					<Slider
						id="imagery-{name}"
						type="single"
						{min}
						max={2}
						step={0.05}
						disabled={!imageryShown}
						value={settings.display[name]}
						onValueChange={(value: number) => settings.setDisplay(name, value)}
					/>
				</Field.Field>
			{/each}
			<Button
				variant="ghost"
				size="sm"
				class="self-end"
				disabled={!imageryShown || !displayChanged}
				onclick={() => {
					for (const { name } of DISPLAY) settings.setDisplay(name, 1);
				}}
			>
				<RotateCcw data-icon="inline-start" />
				{t(msg("imagery_display_reset"))}
			</Button>
		</Field.Set>

		<Field.Set disabled={!imageryShown}>
			<Field.Legend variant="label">{t(msg("background_offset"))}</Field.Legend>
			<div
				class={[
					"flex flex-col gap-3 rounded-md border p-3",
					!imageryShown && "opacity-50",
				]}
			>
				<Field.Description>
					{imageryShown
						? t(msg("background_offset_hint"))
						: t(msg("background_offset_map"))}
				</Field.Description>
				<div
					class="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] grid-rows-[2rem_auto_2.5rem] items-center justify-items-center"
				>
					{#each NUDGES as nudge (nudge.key)}
						<button
							type="button"
							class={[
								"flex size-8 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none",
								nudge.cell,
							]}
							aria-label={t(msg(nudge.key))}
							title={t(msg(nudge.key))}
							disabled={!imageryShown}
							onpointerdown={(event) =>
								startNudge(event, nudge.east, nudge.north)}
							onpointerup={stopNudge}
							onpointerleave={stopNudge}
							onpointercancel={stopNudge}
							onclick={(event) => {
								// Keyboard presses; pointer presses moved it on pointerdown.
								if (event.detail === 0)
									nudgeBy(nudge.east, nudge.north, event.shiftKey);
							}}
						>
							<svg
								viewBox="0 0 10 10"
								class="size-2.5 fill-current"
								style:rotate="{nudge.turn}deg"
								aria-hidden="true"
							>
								<path d="M5 1.5 9.5 8.5H.5Z" />
							</svg>
						</button>
					{/each}
					<div
						role="application"
						aria-label={t(msg("background_offset_drag"))}
						aria-disabled={!imageryShown}
						data-testid="offset-drag"
						class={[
							"col-start-2 row-start-2 flex h-24 w-full touch-none items-center justify-center rounded-md border bg-muted select-none",
							imageryShown && "cursor-move",
						]}
						onpointerdown={startDrag}
						onpointermove={moveDrag}
						onpointerup={endDrag}
						onpointercancel={endDrag}
					>
						<Input
							id="background-offset"
							inputmode="decimal"
							class="h-10 w-3/5 bg-background text-center tabular-nums"
							disabled={!imageryShown}
							aria-label={t(msg("background_offset_field"))}
							title={t(msg("background_offset_field"))}
							aria-invalid={offsetInvalid || undefined}
							value={offsetText}
							oninput={(event) => (offsetDraft = event.currentTarget.value)}
							onchange={applyOffset}
							onkeydown={(event) => {
								if (event.key === "Enter") applyOffset();
								if (event.key === "Escape") offsetDraft = null;
							}}
						/>
					</div>
					<Button
						variant="secondary"
						size="icon"
						class="col-start-3 row-start-3 mt-2 size-10"
						aria-label={t(msg("background_offset_reset"))}
						title={t(msg("background_offset_reset"))}
						disabled={!imageryShown || !moved}
						onclick={() => {
							offsetDraft = null;
							settings.setOffset({ east: 0, north: 0 });
						}}
					>
						<Undo2 />
					</Button>
				</div>
				{#if offsetInvalid}
					<Field.Error>{t(msg("background_offset_invalid"))}</Field.Error>
				{/if}
			</div>
		</Field.Set>

		{#if showFill}
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
			</Field.Set>
		{/if}
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
