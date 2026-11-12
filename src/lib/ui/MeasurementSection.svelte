<script lang="ts">
	import { setSideLength } from "#lib/actions/transform.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import { measure } from "#lib/edit/precision/measure.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { EntityId, WayId } from "#lib/osm/entity.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import { getPrecision } from "#lib/state/precision.svelte.ts";
	import InspectorSection from "#lib/ui/InspectorSection.svelte";
	import { formatArea, formatLength, parseLength } from "#lib/units/length.ts";

	interface Props {
		/** The selected feature: a way is measured, anything else shows nothing. */
		id: EntityId;
	}

	let { id }: Props = $props();
	const editor = getEditor();
	const precision = getPrecision();

	const measured = $derived(measure(editor.graph, id));
	const length = (metres: number) => formatLength(metres, precision.units);

	/** Sets a side's length as typed (C.6): its second end moves along it. */
	function setSide(index: number, input: HTMLInputElement) {
		const metres = parseLength(input.value, precision.units);
		const side = measured?.sides[index];
		if (
			metres &&
			metres > 0 &&
			side !== undefined &&
			Math.abs(metres - side) > 1e-4
		)
			editor.history.perform(
				setSideLength(id as WayId, index, metres),
				msg("undo_side_length"),
			);
		// Shows the length as it now is (or was, when nothing valid was typed).
		const now = measure(editor.graph, id)?.sides[index];
		if (now !== undefined) input.value = length(now);
	}
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
					<ol class="flex flex-wrap gap-1.5">
						{#each measured.sides as side, i (i)}
							<li>
								<Input
									class="h-7 w-24 tabular-nums"
									aria-label={t(msg("measure_side", { n: String(i + 1) }))}
									value={length(side)}
									onchange={(event) => setSide(i, event.currentTarget)}
									onkeydown={(event) => {
										if (event.key === "Enter") event.currentTarget.blur();
									}}
								/>
							</li>
						{/each}
					</ol>
				</dd>
			{/if}
		</dl>
	</InspectorSection>
{/if}
