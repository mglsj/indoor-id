<script lang="ts">
	/**
	 * A status pill at the bottom middle of the map (A.2): a hint, the load status, a note. Round
	 * on one line, less round once its text wraps.
	 */
	import type { Snippet } from "svelte";

	interface Props {
		testid?: string;
		/** Errors are drawn in the destructive colour. */
		tone?: "normal" | "error";
		children: Snippet;
	}

	let { testid, tone = "normal", children }: Props = $props();

	let height = $state(0);
	/** One line of `text-sm` with `py-1.5` is 32px: taller, it wrapped. */
	const wrapped = $derived(height > 40);
</script>

<p
	role="status"
	data-testid={testid}
	bind:clientHeight={height}
	class={[
		"flex max-w-full items-center justify-center gap-1.5 bg-popover px-4 py-1.5 text-center text-sm shadow-md ring-1 ring-foreground/10",
		wrapped ? "rounded-lg" : "rounded-full",
		tone === "error" ? "text-destructive" : "text-popover-foreground",
	]}
>
	{@render children()}
</p>
