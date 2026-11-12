<script lang="ts">
	import type { Measure } from "#lib/edit/precision/feedback.ts";
	import type { TypedInput } from "#lib/edit/precision/typed.ts";
	import { type Message, msg, t } from "#lib/i18n/messages.ts";
	import type { Loc } from "#lib/osm/entity.ts";
	import { formatAngle, formatLength, type Units } from "#lib/units/length.ts";

	interface Props {
		measures: readonly Measure[];
		/** What is being typed (C.2), shown under the pointer's label. */
		input?: TypedInput;
		/** What the snap means (C.4: "Parallel", "In line with a corner"…), under the pointer's label. */
		inference?: Message;
		/** Screen pixels of a position on the map (read again when `camera` changes). */
		project: (loc: Loc) => { x: number; y: number };
		units: Units;
		/** Anything that changes with the camera, so labels follow the map. */
		camera?: unknown;
	}

	let { measures, input, inference, project, units, camera }: Props = $props();

	/** A scale factor to three places at most: 1.25, 0.5. */
	const formatFactor = (factor: number) =>
		String(Math.round(factor * 1000) / 1000);

	const labels = $derived.by(() => {
		void camera;
		return measures.map((m) => {
			const { x, y } = project(m.at);
			const size =
				m.depth === undefined
					? formatLength(m.length, units)
					: `${formatLength(m.length, units)} × ${formatLength(m.depth, units)}`;
			const text =
				m.shows === "angle"
					? formatAngle(m.angle ?? 0)
					: m.shows === "factor"
						? `× ${formatFactor(m.factor ?? 1)}`
						: m.angle === undefined
							? size
							: `${size} · ${formatAngle(m.angle)}`;
			return { x, y, text, pointer: m.pointer ?? false };
		});
	});
</script>

<!-- Lengths next to the pointer while drawing, and along the sides of a dragged corner (C.1). -->
{#each labels as label, i (i)}
	<output
		class={[
			"pointer-events-none absolute z-10 flex flex-col rounded-md bg-popover px-1.5 py-0.5 text-xs whitespace-nowrap text-popover-foreground tabular-nums shadow-sm ring-1 ring-foreground/10",
			!label.pointer && "-translate-x-1/2 -translate-y-1/2",
		]}
		style:left="{label.pointer ? label.x + 16 : label.x}px"
		style:top="{label.pointer ? label.y + 16 : label.y}px"
	>
		<span data-testid={label.pointer ? "measure-pointer" : "measure-side"}
			>{label.text}</span
		>
		{#if label.pointer && inference}
			<span class="font-medium text-primary" data-testid="inference"
				>{t(inference)}</span
			>
		{/if}
		{#if label.pointer && input}
			<span class="mt-0.5 flex gap-2 border-t pt-0.5" data-testid="typed-input">
				<span
					class={input.field === "length"
						? "font-semibold"
						: "text-muted-foreground"}
					>{t(msg("typed_length"))}
					{input.length}
					{#if input.field === "length"}
						<span aria-hidden="true">▏</span>
					{/if}</span
				>
				{#if input.angle || input.field === "angle"}
					<span
						class={input.field === "angle"
							? "font-semibold"
							: "text-muted-foreground"}
						>{t(msg("typed_angle"))}
						{input.angle}°
						{#if input.field === "angle"}
							<span aria-hidden="true">▏</span>
						{/if}</span
					>
				{/if}
			</span>
		{/if}
	</output>
{/each}
