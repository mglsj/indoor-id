<script lang="ts">
	import { measure } from "#lib/edit/precision/measure.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { EntityId } from "#lib/osm/entity.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import { getPrecision } from "#lib/state/precision.svelte.ts";
	import InspectorSection from "#lib/ui/InspectorSection.svelte";
	import { formatArea, formatLength } from "#lib/units/length.ts";

	interface Props {
		/** The selected feature: a way is measured, anything else shows nothing. */
		id: EntityId;
	}

	let { id }: Props = $props();
	const editor = getEditor();
	const precision = getPrecision();

	const measured = $derived(measure(editor.graph, id));
	const length = (metres: number) => formatLength(metres, precision.units);
</script>

{#if measured}
	<InspectorSection
		id="measurements"
		title={t(msg("measure_section"))}
		defaultOpen={false}
	>
		<dl
			class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums"
			data-testid="measurements"
		>
			{#if measured.area !== undefined}
				<dt class="text-muted-foreground">{t(msg("measure_area"))}</dt>
				<dd>{formatArea(measured.area, precision.units)}</dd>
				<dt class="text-muted-foreground">{t(msg("measure_perimeter"))}</dt>
				<dd>{length(measured.length)}</dd>
			{:else}
				<dt class="text-muted-foreground">{t(msg("measure_length"))}</dt>
				<dd>{length(measured.length)}</dd>
			{/if}
			{#if measured.sides.length > 1}
				<dt class="text-muted-foreground">{t(msg("measure_sides"))}</dt>
				<dd>
					<ol class="flex flex-wrap gap-x-3">
						{#each measured.sides as side, i (i)}
							<li>{length(side)}</li>
						{/each}
					</ol>
				</dd>
			{/if}
		</dl>
	</InspectorSection>
{/if}
