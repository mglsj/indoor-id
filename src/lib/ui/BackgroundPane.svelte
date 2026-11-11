<script lang="ts">
	/**
	 * The background settings, in a pane on the right of the map as iD's: the vector map,
	 * Esri's imagery or a custom tile URL, and the imagery's offset.
	 */
	import ArrowDown from "@lucide/svelte/icons/arrow-down";
	import ArrowLeft from "@lucide/svelte/icons/arrow-left";
	import ArrowRight from "@lucide/svelte/icons/arrow-right";
	import ArrowUp from "@lucide/svelte/icons/arrow-up";
	import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
	import X from "@lucide/svelte/icons/x";
	import { type Component, untrack } from "svelte";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import * as RadioGroup from "#lib/components/shadcn/radio-group/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import {
		type BackgroundId,
		customImagery,
		ESRI_IMAGERY,
	} from "#lib/map/backgrounds.ts";
	import {
		type BackgroundSettings,
		formatOffset,
		parseOffset,
	} from "#lib/state/background.svelte.ts";

	interface Props {
		settings: BackgroundSettings;
		onclose: () => void;
	}

	let { settings, onclose }: Props = $props();

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

	const NUDGES: {
		key:
			| "background_move_west"
			| "background_move_north"
			| "background_move_south"
			| "background_move_east";
		icon: Component;
		east: number;
		north: number;
	}[] = [
		{ key: "background_move_west", icon: ArrowLeft, east: -1, north: 0 },
		{ key: "background_move_north", icon: ArrowUp, east: 0, north: 1 },
		{ key: "background_move_south", icon: ArrowDown, east: 0, north: -1 },
		{ key: "background_move_east", icon: ArrowRight, east: 1, north: 0 },
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
			<RadioGroup.Root
				value={settings.id}
				onValueChange={(id) => settings.choose(id as BackgroundId)}
			>
				{@render option(
					"map",
					t(msg("background_map")),
					t(msg("background_map_hint")),
				)}
				{#each ESRI_IMAGERY as imagery (imagery.id)}
					{@render option(imagery.id, imagery.name)}
				{/each}
				{@render option("custom", t(msg("background_custom")))}
			</RadioGroup.Root>
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
			<Field.Legend variant="label">{t(msg("background_offset"))}</Field.Legend>
			<Field.Description>
				{imageryShown
					? t(msg("background_offset_hint"))
					: t(msg("background_offset_map"))}
			</Field.Description>
			<div class="flex items-center gap-1">
				{#each NUDGES as nudge (nudge.key)}
					{@const Icon = nudge.icon}
					<Button
						variant="outline"
						size="icon-sm"
						aria-label={t(msg(nudge.key))}
						title={t(msg(nudge.key))}
						disabled={!imageryShown}
						onclick={(event: MouseEvent) => {
							const step = event.shiftKey ? BIG_STEP : STEP;
							offsetDraft = null;
							settings.nudge(nudge.east * step, nudge.north * step);
						}}
					>
						<Icon />
					</Button>
				{/each}
				<Button
					variant="ghost"
					size="sm"
					class="ml-auto"
					disabled={!imageryShown || !moved}
					onclick={() => {
						offsetDraft = null;
						settings.setOffset({ east: 0, north: 0 });
					}}
				>
					<RotateCcw data-icon="inline-start" />
					{t(msg("background_offset_reset"))}
				</Button>
			</div>
			<Field.Field data-invalid={offsetInvalid || undefined}>
				<Field.Label for="background-offset"
					>{t(msg("background_offset_field"))}</Field.Label
				>
				<Input
					id="background-offset"
					inputmode="decimal"
					class="tabular-nums"
					disabled={!imageryShown}
					aria-invalid={offsetInvalid || undefined}
					value={offsetText}
					oninput={(event) => (offsetDraft = event.currentTarget.value)}
					onchange={applyOffset}
					onkeydown={(event) => {
						if (event.key === "Enter") applyOffset();
						if (event.key === "Escape") offsetDraft = null;
					}}
				/>
				{#if offsetInvalid}
					<Field.Error>{t(msg("background_offset_invalid"))}</Field.Error>
				{/if}
			</Field.Field>
		</Field.Set>
	</div>
</aside>

{#snippet option(value: BackgroundId, name: string, hint?: string)}
	{@const id = `background-${value}`}
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
