<script lang="ts">
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { type Snippet, untrack } from "svelte";
	import * as Collapsible from "#lib/components/shadcn/collapsible/index.ts";

	interface Props {
		/** Name the open or closed state is remembered under, in this browser. */
		id: string;
		/** Heading, which opens and closes the section: "Tags (3)". */
		title: string;
		/** Whether the section starts open when the user never chose. */
		defaultOpen?: boolean;
		/** Open whatever was remembered (the tags of a feature without a matching type). */
		forceOpen?: boolean;
		children: Snippet;
	}

	let {
		id,
		title,
		defaultOpen = true,
		forceOpen = false,
		children,
	}: Props = $props();

	const headingId = $props.id();
	const key = $derived(`indoorid.inspector.${id}`);
	// Read once: the section's state then follows the user's clicks.
	let open = $state(
		untrack(() => forceOpen || (remembered(key) ?? defaultOpen)),
	);

	/** The remembered state, or null; storage can be unavailable (private windows). */
	function remembered(storageKey: string): boolean | null {
		try {
			const value = localStorage.getItem(storageKey);
			return value === null ? null : value === "open";
		} catch {
			return null;
		}
	}

	function onOpenChange(next: boolean) {
		open = next;
		try {
			localStorage.setItem(key, next ? "open" : "closed");
		} catch {
			// Not remembered, but still toggled.
		}
	}
</script>

<Collapsible.Root {open} {onOpenChange}>
	<section aria-labelledby={headingId} class="border-b">
		<h3>
			<Collapsible.Trigger
				id={headingId}
				class="flex w-full items-center gap-1 px-4 py-3 text-left text-sm font-semibold outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<ChevronRight
					class={[
						"size-4 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-90",
					]}
				/>
				{title}
			</Collapsible.Trigger>
		</h3>
		<Collapsible.Content class="px-4 pb-4"
			>{@render children()}</Collapsible.Content
		>
	</section>
</Collapsible.Root>
