<script lang="ts" module>
	/** An option as the list shows it. */
	export interface ComboOption {
		readonly key: string;
		readonly label: string;
		readonly description?: string;
		/** The tooltip. */
		readonly title?: string;
		/** A raw tag value, in monospace. */
		readonly mono?: boolean;
	}
</script>

<script lang="ts">
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import type { ComboState } from "#lib/ui/combobox.svelte.ts";
	import { cn } from "#lib/utils.ts";

	interface Props {
		/** The listbox's id (the input's `aria-controls`); options are `${id}-${index}`. */
		id: string;
		label: string | undefined;
		options: readonly ComboOption[];
		combo: ComboState;
		/** The input's wrapper, under which the list opens; clicks in it keep the list open. */
		anchor: HTMLElement | undefined;
		onchoose: (index: number) => void;
		class?: string;
	}

	let {
		id,
		label,
		options,
		combo,
		anchor,
		onchoose,
		class: className,
	}: Props = $props();

	// The highlighted option stays in view as the keys move it.
	$effect(() => {
		if (combo.open && combo.highlighted >= 0) {
			document
				.getElementById(`${id}-${combo.highlighted}`)
				?.scrollIntoView({ block: "nearest" });
		}
	});
</script>

<Popover.Root
	open={combo.open && options.length > 0}
	onOpenChange={(next) => {
		if (!next) combo.open = false;
	}}
>
	<Popover.Content
		customAnchor={anchor}
		side="bottom"
		align="start"
		trapFocus={false}
		onOpenAutoFocus={(event) => event.preventDefault()}
		onCloseAutoFocus={(event) => event.preventDefault()}
		onInteractOutside={(event) => {
			if (anchor?.contains(event.target as Node)) event.preventDefault();
		}}
		class={cn(
			"max-h-64 w-(--bits-popover-anchor-width) gap-0 overflow-y-auto p-1",
			className,
		)}
	>
		<div {id} role="listbox" aria-label={label}>
			{#each options as option, i (option.key)}
				<div
					id={`${id}-${i}`}
					role="option"
					aria-selected={i === combo.highlighted}
					tabindex="-1"
					title={option.title}
					class={[
						"flex cursor-default flex-col rounded-sm px-2 py-1.5 text-sm",
						i === combo.highlighted ? "bg-muted" : "hover:bg-muted/60",
					]}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => onchoose(i)}
					onkeydown={() => {}}
				>
					<span class={[option.mono && "font-mono text-xs"]}
						>{option.label}</span
					>
					{#if option.description}
						<span class="text-xs text-muted-foreground"
							>{option.description}</span
						>
					{/if}
				</div>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
