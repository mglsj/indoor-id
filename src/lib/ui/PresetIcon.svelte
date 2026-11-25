<script lang="ts">
	import CircleDashed from "@lucide/svelte/icons/circle-dashed";
	import { iconUrl } from "#lib/map/style/icons.ts";

	interface Props {
		/** iD's icon name (`maki-toilet`); a placeholder of the same size when unknown (A.5). */
		icon: string | undefined;
		size: number;
	}

	let { icon, size }: Props = $props();

	const url = $derived(iconUrl(icon));
</script>

{#if url}
	<!-- Sized by style: Tailwind's base sets `height: auto`, which let tall icons (Temaki's
	     latrine, 22 × 48) stretch their row. -->
	<img
		src={url}
		alt=""
		width={size}
		height={size}
		style:width="{size}px"
		style:height="{size}px"
		class="shrink-0 object-contain dark:invert"
	>
{:else}
	<!-- A placeholder, so names line up in lists (A.5). -->
	<span
		class="flex shrink-0 items-center justify-center text-muted-foreground"
		style:width="{size}px"
		style:height="{size}px"
		data-testid="preset-icon-placeholder"
		aria-hidden="true"
	>
		<CircleDashed size={Math.round(size * 0.75)} />
	</span>
{/if}
