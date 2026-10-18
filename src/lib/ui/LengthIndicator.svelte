<script lang="ts">
	import { charCount, MAX_CHARS } from "#lib/presets/text.ts";

	interface Props {
		/** The value being typed. */
		value: string;
	}

	let { value }: Props = $props();

	const count = $derived(charCount(value.trim()));
</script>

<!-- As iD: shown from 80 % of OSM's 255 characters; what goes beyond is cut when saved. -->
{#if count > MAX_CHARS * 0.8}
	<span
		class={[
			"text-xs tabular-nums",
			count > MAX_CHARS
				? "font-medium text-destructive"
				: "text-muted-foreground",
		]}
		title={count > MAX_CHARS
			? `OSM keeps ${MAX_CHARS} characters: the rest will be cut`
			: undefined}
		aria-live="polite"
		>{count}/{MAX_CHARS}</span
	>
{/if}
