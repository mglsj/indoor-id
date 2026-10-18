<script lang="ts">
	import Info from "@lucide/svelte/icons/info";
	import { Button } from "#lib/components/shadcn/button/index.ts";

	interface Props {
		/** What it documents ("Room", "Room Number"). */
		label: string;
		/** Whether its documentation is shown. */
		expanded: boolean;
		ontoggle: () => void;
	}

	let { label, expanded, ontoggle }: Props = $props();
</script>

<!-- iD's ⓘ: shows the OSM wiki's documentation below. -->
<Button
	variant="ghost"
	size="icon-xs"
	aria-label={`Documentation of ${label}`}
	aria-expanded={expanded}
	title="Information"
	class={[expanded ? "text-foreground" : "text-muted-foreground"]}
	onclick={(event) => {
		event.stopPropagation();
		ontoggle();
	}}
	onpointerdown={(event) => event.stopPropagation()}
>
	<Info />
</Button>
