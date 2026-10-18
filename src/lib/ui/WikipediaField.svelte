<script lang="ts">
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { Tags } from "#lib/osm/tags.ts";
	import type { Field } from "#lib/presets/presets.ts";
	import { cleanValue } from "#lib/presets/text.ts";
	import {
		parseWikipediaTag,
		parseWikipediaUrl,
		type WikipediaSite,
		wikipediaLanguage,
		wikipediaUrl,
	} from "#lib/presets/wiki.ts";
	import {
		type FieldContext,
		fieldInputId,
		type MixedValues,
		NOT_MIXED,
		type TagPatch,
	} from "#lib/ui/field-context.ts";
	import SearchCombo from "#lib/ui/SearchCombo.svelte";

	interface Props {
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

	const ENGLISH: WikipediaSite = ["English", "English", "en"];

	/** The Wikipedias, from wmf-sitematrix (as iD), loaded with the field. */
	let sites = $state.raw<readonly WikipediaSite[]>([ENGLISH]);
	import("wmf-sitematrix/data/wikipedia.min.json").then(
		(module) => (sites = module.default as unknown as WikipediaSite[]),
	);

	const key = $derived(field.key ?? "wikipedia");
	const value = $derived(tags[key] ?? "");
	const parsed = $derived(parseWikipediaTag(value));
	const tagSite = $derived(
		parsed ? sites.find((site) => site[2] === parsed.lang) : undefined,
	);
	/** The language chosen in the field, before a title is typed. */
	let chosen = $state<WikipediaSite | undefined>();
	const site = $derived(tagSite ?? chosen ?? ENGLISH);
	const title = $derived(
		tagSite && parsed
			? parsed.title + (parsed.anchor ? `#${parsed.anchor}` : "")
			: value,
	);
	const link = $derived(
		tagSite && parsed
			? wikipediaUrl(parsed.lang, parsed.title, parsed.anchor)
			: value
				? `https://en.wikipedia.org/w/index.php?fulltext=1&search=${encodeURIComponent(value)}`
				: null,
	);

	function searchLanguages(query: string) {
		const q = query.toLowerCase();
		return sites
			.filter((s) => s.some((part) => part.toLowerCase().includes(q)))
			.map(([english, own, code]) => ({
				key: code,
				label: own,
				description: english,
			}));
	}

	async function searchTitles(query: string) {
		const text = query || tags.name || "";
		const titles = (await context.searchWikipedia?.(site[2], text)) ?? [];
		return titles.map((t) => ({ key: t, label: t }));
	}

	/** Sets the article; then, as iD, the Wikidata item of a new title, in the same step. */
	function setTitle(text: string, lang: WikipediaSite, lookUpItem: boolean) {
		let articleTitle = text;
		let articleSite = lang;
		const pasted = parseWikipediaUrl(text);
		const pastedSite = pasted && sites.find((s) => s[2] === pasted.lang);
		if (pasted && pastedSite) {
			articleTitle = pasted.title;
			articleSite = pastedSite;
		}
		chosen = articleSite;
		const next = articleTitle
			? cleanValue(`${articleSite[2]}:${articleTitle}`)
			: undefined;
		if (next === (value || undefined)) return;
		onchange({ [key]: next });
		const wikidata = context.wikidata;
		if (!lookUpItem || !next || !wikidata) return;
		context.amend?.(
			wikidata
				.itemsByTitle(articleSite[2], articleTitle)
				.then((qids) => (current: Tags) => {
					const qid = qids[0];
					if (current.wikidata === qid) return null;
					const updated: Record<string, string> = { ...current };
					// An article without an item takes the old item off (as iD).
					if (qid) updated.wikidata = qid;
					else delete updated.wikidata;
					return updated;
				}),
		);
	}
</script>

<div class="flex items-center gap-1">
	<SearchCombo
		id={`${fieldInputId(field)}-lang`}
		class="w-28 shrink-0"
		value={site[1]}
		lang={site[2]}
		ariaLabel="Wikipedia language"
		placeholder="Language"
		readonly={locked}
		search={searchLanguages}
		onchoose={(item) => {
			const found = sites.find((s) => s[2] === item.key);
			if (found) setTitle(title, found, false);
		}}
		oncommit={(text) => {
			const found = wikipediaLanguage(sites, text);
			if (found) setTitle(title, found, false);
		}}
	/>
	<SearchCombo
		id={fieldInputId(field)}
		class="flex-1"
		value={title}
		lang={site[2]}
		placeholder={mixed.has(key)
			? t(msg("field_multiple_values"))
			: "Article title"}
		readonly={locked}
		search={searchTitles}
		onchoose={(item) => setTitle(item.key, site, true)}
		oncommit={(text) => setTitle(text, site, true)}
	/>
	{#if link}
		<Button
			variant="ghost"
			size="icon-sm"
			href={link}
			target="_blank"
			rel="noopener noreferrer"
			aria-label="View on wikipedia.org"
			title="View on wikipedia.org"
		>
			<ExternalLink />
		</Button>
	{/if}
</div>
