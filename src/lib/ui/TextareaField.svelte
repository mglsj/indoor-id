<script lang="ts">
	import * as InputGroup from "#lib/components/shadcn/input-group/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import { cleanValue, textPatch, textValue } from "#lib/presets/text.ts";
	import {
		fieldInputId,
		type MixedValues,
		NOT_MIXED,
		type TagPatch,
	} from "#lib/ui/field-context.ts";
	import LengthIndicator from "#lib/ui/LengthIndicator.svelte";

	interface Props {
		field: Field;
		tags: Tags;
		/** Keys whose values differ between the features edited. */
		mixed?: MixedValues;
		locked: boolean;
		/** A change; `live` while typing (kept as typed, one undo step with the final value). */
		onchange: (patch: TagPatch, live?: boolean) => void;
	}

	let { field, tags, mixed = NOT_MIXED, locked, onchange }: Props = $props();

	const current = $derived(textValue(field, tags, mixed));
	let typed = $derived(current.value);

	/** Whether text was applied while typing: leaving the field then ends that undo step. */
	let appliedLive = false;

	/** Each keystroke applied as typed, as iD; an emptied field waits until it is left. */
	function applyTyped(text: string) {
		if (locked || current.mixed || !cleanValue(text)) return;
		appliedLive = true;
		onchange(textPatch(field, tags, text), true);
	}

	function commit(target: HTMLTextAreaElement) {
		appliedLive = false;
		const value = cleanValue(target.value);
		if (!value && current.mixed) return;
		target.value = value;
		typed = value;
		// Even unchanged: leaving the field ends the undo step typing made.
		onchange(textPatch(field, tags, value));
	}
</script>

<InputGroup.Root data-disabled={locked}>
	<InputGroup.Textarea
		id={fieldInputId(field)}
		rows={3}
		dir="auto"
		value={current.value}
		placeholder={current.mixed
			? t(msg("field_multiple_values"))
			: (field.placeholder ?? "Unknown")}
		readonly={locked}
		oninput={(event) => {
			typed = event.currentTarget.value;
			applyTyped(typed);
		}}
		onchange={(event) => commit(event.currentTarget)}
		onblur={(event) => {
			// No change event for text typed back as it was: still the end of the edit.
			if (appliedLive) commit(event.currentTarget);
		}}
	/>
	<InputGroup.Addon align="block-end" class="justify-end">
		<LengthIndicator value={typed} />
	</InputGroup.Addon>
</InputGroup.Root>
