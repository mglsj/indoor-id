<script lang="ts" module>
	/** A search result: what it is (`Q19675`, `fr`), and how it reads. */
	export interface SearchItem {
		readonly key: string;
		readonly label: string;
		readonly description?: string;
		readonly title?: string;
	}
</script>

<script lang="ts">
	import ComboList from "#lib/ui/ComboList.svelte";
	import { Combobox } from "#lib/ui/combobox.svelte.ts";
	import { cn } from "#lib/utils.ts";

	interface Props {
		id: string;
		/** What the input shows when not typing. */
		value: string;
		placeholder?: string;
		/** The input's name when no label points at it. */
		ariaLabel?: string;
		/** The language of the text shown (for scripts and screen readers). */
		lang?: string;
		readonly?: boolean;
		/** Results for what was typed ("" when nothing was: the field picks a hint). */
		search: (
			query: string,
		) => Promise<readonly SearchItem[]> | readonly SearchItem[];
		/** A result chosen (click, Enter or Tab on a highlighted one). */
		onchoose: (item: SearchItem) => void;
		/** Text accepted without choosing a result (Enter, leaving the field), when typed. */
		oncommit?: (text: string) => void;
		class?: string;
	}

	let {
		id,
		value,
		placeholder,
		ariaLabel,
		lang,
		readonly = false,
		search,
		onchoose,
		oncommit,
		class: className,
	}: Props = $props();

	const listId = $derived(`${id}-list`);
	let input = $state<HTMLInputElement>();
	let wrap = $state<HTMLDivElement>();
	const combo = new Combobox<readonly SearchItem[]>({
		search: (query) => search(query),
		failed: [],
		onresult: () => (combo.highlighted = -1),
	});
	const items = $derived(combo.result ?? []);
	/** Whether the text was typed since the field got focus. */
	let dirty = false;

	$effect(() => () => combo.dispose());

	function choose(item: SearchItem) {
		dirty = false;
		combo.open = false;
		onchoose(item);
		if (input) input.value = item.label;
	}

	function commit() {
		combo.open = false;
		if (!input || !dirty) return;
		dirty = false;
		oncommit?.(input.value.trim());
		input.value = value;
	}

	/**
	 * Enter without a highlighted result: once the search for the typed text has answered,
	 * the result named exactly that is chosen, else the text is kept as typed.
	 */
	async function enter() {
		combo.open = false;
		if (!input || !dirty) return commit();
		const typed = input.value.trim();
		const results = await combo.settle();
		// Left or typed on meanwhile: that wins.
		if (!dirty || input?.value.trim() !== typed) return;
		const exact = results?.find(
			(item) => item.label.toLowerCase() === typed.toLowerCase(),
		);
		if (exact) choose(exact);
		else commit();
	}

	function onkeydown(event: KeyboardEvent) {
		if (readonly) return;
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp":
				event.preventDefault();
				if (!combo.open) {
					combo.open = true;
					combo.find(dirty && input ? input.value : "", { wait: false });
					return;
				}
				combo.move(event.key === "ArrowDown" ? 1 : -1, items.length);
				break;
			case "Enter":
			case "Tab": {
				const item = combo.open ? items[combo.highlighted] : undefined;
				if (event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
				}
				if (item) choose(item);
				else if (event.key === "Enter") void enter();
				break;
			}
			case "Escape":
				if (combo.escape()) event.stopPropagation();
				break;
		}
	}
</script>

<div bind:this={wrap} class={cn("min-w-0", className)}>
	<input
		bind:this={input}
		{id}
		type="text"
		role="combobox"
		autocomplete="off"
		dir="auto"
		{lang}
		aria-label={ariaLabel}
		aria-autocomplete="list"
		aria-expanded={combo.open && items.length > 0}
		aria-controls={listId}
		aria-activedescendant={combo.open && combo.highlighted >= 0
			? `${listId}-${combo.highlighted}`
			: undefined}
		{value}
		{placeholder}
		{readonly}
		class="flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
		onfocus={(event) => {
			dirty = false;
			// As iD: the whole value is selected, ready to be replaced.
			event.currentTarget.select();
		}}
		oninput={(event) => {
			dirty = true;
			const text = event.currentTarget.value;
			combo.open = text !== "";
			combo.find(text);
		}}
		{onkeydown}
		onblur={commit}
	>
</div>

<ComboList
	id={listId}
	label={ariaLabel ?? placeholder}
	options={items.map((item) => ({
		key: item.key,
		label: item.label,
		description: item.description,
		title: item.title,
	}))}
	{combo}
	anchor={wrap}
	onchoose={(i) => {
		const item = items[i];
		if (item) choose(item);
	}}
	class="min-w-56"
/>
