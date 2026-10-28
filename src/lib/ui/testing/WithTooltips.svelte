<!-- Component tests: renders a component inside the tooltip provider the layout gives the app. -->
<script lang="ts" generics="P extends Record<string, unknown>">
	import type { Component } from "svelte";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";

	interface Props {
		component: Component<P>;
		props: P;
	}

	let { component: Inner, props }: Props = $props();
</script>

<Tooltip.Provider delayDuration={0}><Inner {...props} /></Tooltip.Provider>
