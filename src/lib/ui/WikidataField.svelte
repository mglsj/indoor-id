<script lang="ts">
	import Copy from "@lucide/svelte/icons/copy";
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import {
		inLanguage,
		type WikidataEntity,
		wikipediaFromSitelinks,
	} from "#lib/api/wikidata.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as InputGroup from "#lib/components/shadcn/input-group/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import { cleanValue } from "#lib/presets/text.ts";
	import {
		type FieldContext,
		fieldInputId,
		type MixedValues,
		NOT_MIXED,
		type TagPatch,
	} from "#lib/ui/field-context.ts";
	import SearchCombo from "#lib/ui/SearchCombo.svelte";

	interface Props {
		/** A wikidata field (`wikidata`, `brand:wikidata`…), with its wikipedia key. */
		field: Field;
		tags: Tags;
		/** Keys whose values differ between the features edited. */
		mixed?: MixedValues;
		context: FieldContext;
		locked: boolean;
		onchange: (patch: TagPatch) => void;
	}

	let {
		field,
		tags,
		mixed = NOT_MIXED,
		context,
		locked,
		onchange,
	}: Props = $props();

	const key = $derived(field.key ?? "wikidata");
	const qid = $derived(tags[key] ?? "");
	const isQid = $derived(/^Q\d+$/.test(qid));
	/** The wikipedia key kept in step with the item (`wikipedia`, `brand:wikipedia`). */
	const wikipediaKey = $derived(
		field.keys?.find((k) => k.includes("wikipedia")),
	);
	/** The tag searched for when nothing is typed: the name, or the brand's… (as iD). */
	const hintKey = $derived(key === "wikidata" ? "name" : key.split(":")[0]);

	let entity = $state.raw<WikidataEntity | null>(null);
	$effect(() => {
		// The item behind the tag, read from Wikidata.
		const wikidata = context.wikidata;
		entity = null;
		if (!isQid || !wikidata) return;
		const asked = qid;
		wikidata
			.entity(asked)
			.then((found) => {
				if (asked === qid) entity = found;
			})
			.catch(() => {});
	});
	const label = $derived(inLanguage(entity?.labels));
	const description = $derived(inLanguage(entity?.descriptions));
	const link = $derived(
		isQid
			? `https://wikidata.org/wiki/${qid}`
			: qid
				? `https://wikidata.org/wiki/Special:Search?search=${encodeURIComponent(qid)}`
				: null,
	);

	async function search(query: string) {
		const text = query || (hintKey ? tags[hintKey] : undefined) || "";
		const items = (await context.wikidata?.search(text)) ?? [];
		return items.map((item) => ({
			key: item.id,
			label: item.label,
			...(item.description ? { description: item.description } : {}),
			title:
				item.id + (item.aliases.length ? ` (${item.aliases.join(", ")})` : ""),
		}));
	}

	function choose(id: string) {
		onchange({ [key]: id });
		const wikidata = context.wikidata;
		const wikiKey = wikipediaKey;
		if (!wikidata || !wikiKey) return;
		// Then the item's article, in the same undo step (as iD).
		context.amend?.(
			wikidata.entity(id).then((found) => (current: Tags) => {
				const article = wikipediaFromSitelinks(found);
				if (article === undefined) return null;
				const next: Record<string, string> = { ...current };
				if (article === null) {
					if (!next[wikiKey]) return null;
					delete next[wikiKey];
				} else {
					next[wikiKey] = cleanValue(article);
				}
				return next;
			}),
		);
	}
</script>

<div class="flex flex-col gap-1.5">
	<div class="flex items-center gap-1">
		<SearchCombo
			id={fieldInputId(field)}
			class="flex-1"
			value={label?.value ?? qid}
			lang={label?.language}
			placeholder={mixed.has(key)
				? t(msg("field_multiple_values"))
				: "Search Wikidata"}
			readonly={locked}
			{search}
			onchoose={(item) => choose(item.key)}
		/>
		{#if link}
			<Button
				variant="ghost"
				size="icon-sm"
				href={link}
				target="_blank"
				rel="noopener noreferrer"
				aria-label="View on wikidata.org"
				title="View on wikidata.org"
			>
				<ExternalLink />
			</Button>
		{/if}
	</div>
	{#if entity}
		{#each [
			["Description", description?.value],
			["Identifier", entity.id],
		] as [name, text] (name)}
			{#if text}
				<div class="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2">
					<span class="text-sm text-muted-foreground">{name}</span>
					<InputGroup.Root>
						<InputGroup.Input
							value={text}
							readonly
							aria-label={`Wikidata ${name?.toLowerCase()}`}
						/>
						<InputGroup.Addon align="inline-end">
							<InputGroup.Button
								size="icon-xs"
								aria-label={`Copy the ${name?.toLowerCase()}`}
								title="Copy"
								onclick={() => navigator.clipboard.writeText(text)}
							>
								<Copy />
							</InputGroup.Button>
						</InputGroup.Addon>
					</InputGroup.Root>
				</div>
			{/if}
		{/each}
	{/if}
</div>
