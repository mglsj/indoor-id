<script lang="ts">
	import List from "@lucide/svelte/icons/list";
	import TextCursor from "@lucide/svelte/icons/text-cursor-input";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { tick } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import type { TagDocs } from "#lib/api/osm-wikibase.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Textarea } from "#lib/components/shadcn/textarea/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import { reconcileRows, renameTag, type TagRow } from "#lib/osm/tag-rows.ts";
	import { formatTagText, parseTagText } from "#lib/osm/tag-text.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import type { SuggestedValue } from "#lib/presets/combo.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import { cleanValue } from "#lib/presets/text.ts";
	import type { TagReference as Reference } from "#lib/presets/wiki.ts";
	import ComboField from "#lib/ui/ComboField.svelte";
	import type { FieldContext } from "#lib/ui/field-context.ts";
	import InfoButton from "#lib/ui/InfoButton.svelte";
	import TagReference from "#lib/ui/TagReference.svelte";

	interface Props {
		tags: Tags;
		/** Called with all the tags once the user changed one. */
		onchange: (tags: Tags) => void;
		/** Keys used elsewhere for what was typed (taginfo), already filtered. */
		suggestKeys?: (query: string) => Promise<readonly SuggestedValue[]>;
		/** Values used elsewhere for a key. */
		suggestValues?: (
			key: string,
			query: string,
		) => Promise<readonly SuggestedValue[]>;
		/** The OSM wiki's documentation, for each row's ⓘ. */
		docs?: (reference: Reference) => Promise<TagDocs | null>;
	}

	let { tags, onchange, suggestKeys, suggestValues, docs }: Props = $props();

	const VIEW_KEY = "indoorid.tag-view";
	/** List or text, remembered in this browser (as iD). */
	let view = $state<"list" | "text">(rememberedView());
	function rememberedView(): "list" | "text" {
		try {
			return localStorage.getItem(VIEW_KEY) === "text" ? "text" : "list";
		} catch {
			return "list";
		}
	}
	function setView(next: string) {
		if (next !== "list" && next !== "text") return;
		view = next;
		try {
			localStorage.setItem(VIEW_KEY, next);
		} catch {
			// Not remembered, but still switched.
		}
	}

	/** The rows shown so far: they keep their place while the user edits. */
	let rows: TagRow[] = [];
	const shown = $derived.by(() => {
		rows = reconcileRows(rows, tags);
		return rows;
	});
	/** Rows whose ⓘ documentation is open, by id. */
	const documented = new SvelteSet<number>();
	const asked = new Map<string, Promise<TagDocs | null>>();
	function docsOf(key: string, value: string | undefined) {
		const id = `${key}=${value ?? ""}`;
		let found = asked.get(id);
		if (!found && docs) {
			found = docs(value ? { key, value } : { key });
			asked.set(id, found);
		}
		return found;
	}

	/** The ids ComboField gives the row's inputs (from the fields below). */
	const keyId = (row: TagRow) => `field-tag-key-${row.id}`;
	const valueId = (row: TagRow) => `field-tag-value-${row.id}`;
	const input = (id: string) =>
		document.getElementById(id) as HTMLInputElement | null;

	/** The key input of a row, as a combo asking taginfo for keys. */
	const keyField = (row: TagRow): Field => ({
		id: `tag-key-${row.id}`,
		type: "combo",
		label: "Key",
		placeholder: row.key ? undefined : "Add new tag",
		options: [],
		terms: [],
		universal: false,
		snakeCase: false,
		caseSensitive: true,
		customValues: true,
		autoSuggestions: true,
		allowDuplicates: false,
	});
	const valueField = (row: TagRow): Field => ({
		...keyField(row),
		id: `tag-value-${row.id}`,
		label: "Value",
		placeholder: undefined,
	});
	const keyContext: FieldContext = {
		deprecated: () => [],
		get suggest() {
			const keys = suggestKeys;
			return keys ? (_: Field, query: string) => keys(query) : undefined;
		},
	};
	const valueContext = (row: TagRow): FieldContext => ({
		deprecated: () => [],
		get suggest() {
			const values = suggestValues;
			return values && row.key
				? (_: Field, query: string) => values(row.key, query)
				: undefined;
		},
	});

	/**
	 * The key typed in the new-tag row, waiting for its value: the editor keeps no tag without
	 * a value (OSM refuses them), where iD adds `key=` at once.
	 */
	let pendingKey = $state("");

	function changeKey(row: TagRow, typed: string | undefined) {
		const key = typed ? cleanValue(typed) : "";
		const field = input(keyId(row));
		const current = row.key || pendingKey;
		if (key === current) return;
		if (!key) {
			// A tag's key can't be emptied here: its bin removes the tag.
			if (row.key && field) field.value = row.key;
			else pendingKey = "";
			return;
		}
		if (tags[key] !== undefined) {
			// That key is set already: go to its row (as iD), once Tab has moved focus.
			if (field) field.value = current;
			const existing = shown.find((r) => r.key === key);
			const other = existing && input(valueId(existing));
			setTimeout(() => {
				other?.focus();
				other?.select();
			});
			return;
		}
		if (row.key) {
			rows = rows.map((r) => (r.id === row.id ? { ...r, key } : r));
			onchange(renameTag(tags, row.key, key));
			return;
		}
		// A new tag: added once it has a value.
		const value = cleanValue(input(valueId(row))?.value ?? "");
		if (value) addTag(row, key, value);
		else pendingKey = key;
	}

	function addTag(row: TagRow, key: string, value: string) {
		pendingKey = "";
		rows = rows.map((r) => (r.id === row.id ? { ...r, key } : r));
		onchange({ ...tags, [key]: value });
	}

	function changeValue(row: TagRow, typed: string | undefined) {
		const value = cleanValue(typed ?? "");
		if (!row.key) {
			if (pendingKey && value) addTag(row, pendingKey, value);
			return;
		}
		if (value === tags[row.key]) return;
		// An emptied value takes the tag off: the editor keeps no tag without a value.
		onchange({ ...tags, [row.key]: value });
	}

	function remove(row: TagRow) {
		const { [row.key]: _, ...rest } = tags;
		documented.delete(row.id);
		onchange(rest);
	}

	/** iD's keys: = or Enter at the end of a key goes to its value; Enter in a value, to the next row. */
	async function onkeydown(
		event: KeyboardEvent,
		row: TagRow,
		part: "key" | "value",
	) {
		const target = event.target as HTMLInputElement;
		if (target.selectionEnd !== target.value.length) return;
		if (part === "key" && (event.key === "=" || event.key === "Enter")) {
			if (event.key === "=") event.preventDefault();
			input(valueId(row))?.focus();
		} else if (part === "value" && event.key === "Enter") {
			// Once the input's own Enter has saved the value, and the rows are drawn again.
			await new Promise((resolve) => setTimeout(resolve));
			await tick();
			const at = shown.findIndex((r) => r.id === row.id);
			const next = shown[at + 1];
			if (next) input(keyId(next))?.focus();
		}
	}

	function changeText(text: string) {
		const parsed = parseTagText(text);
		const next: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			const k = cleanValue(key);
			if (k) next[k] = cleanValue(value);
		}
		const same =
			Object.keys(next).length === Object.keys(tags).length &&
			Object.entries(next).every(([k, v]) => tags[k] === v);
		if (!same) onchange(next);
	}
</script>

<div class="flex flex-col gap-2">
	<ToggleGroup.Root
		type="single"
		size="sm"
		variant="outline"
		value={view}
		onValueChange={setView}
		aria-label="Tag view"
		class="self-end"
	>
		<ToggleGroup.Item value="list" aria-label="List view" title="List">
			<List />
		</ToggleGroup.Item>
		<ToggleGroup.Item value="text" aria-label="Text view" title="Text">
			<TextCursor />
		</ToggleGroup.Item>
	</ToggleGroup.Root>

	{#if view === "text"}
		<!-- Sorted by key, unlike the list (and iD's text view, which follows the list). -->
		<label for="raw-tags" class="sr-only">Tags</label>
		<Textarea
			id="raw-tags"
			rows={Math.max(3, shown.length + 1)}
			spellcheck="false"
			placeholder="key=value"
			class="font-mono text-xs"
			value={formatTagText(tags)}
			onchange={(event) => changeText(event.currentTarget.value)}
		/>
	{:else}
		<ul aria-label="Tags" class="flex flex-col gap-1">
			{#each shown as row (row.id)}
				<li class="flex flex-col gap-1">
					<div
						class="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto_auto] items-center gap-1"
					>
						<div onkeydowncapture={(event) => onkeydown(event, row, "key")}>
							<ComboField
								field={keyField(row)}
								value={row.key || pendingKey || undefined}
								context={keyContext}
								locked={false}
								raw
								ariaLabel={row.key ? `Key ${row.key}` : "New tag key"}
								onchange={(typed) => changeKey(row, typed)}
							/>
						</div>
						<div onkeydowncapture={(event) => onkeydown(event, row, "value")}>
							<ComboField
								field={valueField(row)}
								value={row.key ? tags[row.key] : undefined}
								context={valueContext(row)}
								locked={false}
								raw
								ariaLabel={row.key || pendingKey
									? `Value of ${row.key || pendingKey}`
									: "New tag value"}
								onchange={(typed) => changeValue(row, typed)}
							/>
						</div>
						{#if row.key && docs}
							<InfoButton
								label={`${row.key}=${tags[row.key] ?? ""}`}
								expanded={documented.has(row.id)}
								ontoggle={() =>
									documented.has(row.id)
										? documented.delete(row.id)
										: documented.add(row.id)}
							/>
						{:else}
							<span class="size-6"></span>
						{/if}
						{#if row.key}
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Remove tag ${row.key}`}
								title="Remove"
								class="text-muted-foreground hover:text-destructive"
								onclick={() => remove(row)}
							>
								<Trash2 />
							</Button>
						{:else}
							<span class="size-6"></span>
						{/if}
					</div>
					{#if row.key && documented.has(row.id)}
						{@const found = docsOf(row.key, tags[row.key])}
						{#if found}
							<TagReference docs={found} />
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
