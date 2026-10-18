<script lang="ts">
	import { iconUrl } from "#lib/map/style/icons.ts";

	interface Props {
		/** iD's icon name (`maki-toilet`); a blank space of the same size when unknown. */
		icon: string | undefined;
		size: number;
	}

	let { icon, size }: Props = $props();

	const url = $derived(iconUrl(icon));
</script>

{#if url}
	<img src={url} alt="" width={size} height={size} class="shrink-0 dark:invert">
{:else}
	<span class="shrink-0" style:width="{size}px"></span>
{/if}
