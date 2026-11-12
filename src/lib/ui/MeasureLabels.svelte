<script lang="ts">
	import type { Measure } from "#lib/edit/precision/feedback.ts";
	import type { Loc } from "#lib/osm/entity.ts";
	import { formatAngle, formatLength, type Units } from "#lib/units/length.ts";

	interface Props {
		measures: readonly Measure[];
		/** Screen pixels of a position on the map (read again when `camera` changes). */
		project: (loc: Loc) => { x: number; y: number };
		units: Units;
		/** Anything that changes with the camera, so labels follow the map. */
		camera?: unknown;
	}

	let { measures, project, units, camera }: Props = $props();

	const labels = $derived.by(() => {
		void camera;
		return measures.map((m) => {
			const { x, y } = project(m.at);
			const text =
				m.angle === undefined
					? formatLength(m.length, units)
					: `${formatLength(m.length, units)} · ${formatAngle(m.angle)}`;
			return { x, y, text, pointer: m.pointer ?? false };
		});
	});
</script>

<!-- Lengths next to the pointer while drawing, and along the sides of a dragged corner (C.1). -->
{#each labels as label, i (i)}
	<output
		data-testid={label.pointer ? "measure-pointer" : "measure-side"}
		class={[
			"pointer-events-none absolute z-10 rounded-md bg-popover px-1.5 py-0.5 text-xs whitespace-nowrap text-popover-foreground tabular-nums shadow-sm ring-1 ring-foreground/10",
			!label.pointer && "-translate-x-1/2 -translate-y-1/2",
		]}
		style:left="{label.pointer ? label.x + 16 : label.x}px"
		style:top="{label.pointer ? label.y + 16 : label.y}px"
	>
		{label.text}
	</output>
{/each}
