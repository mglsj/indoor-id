/**
 * Wikidata and Wikipedia, as iD's `services/wikidata.js` and `wikipedia.js` use them: searching
 * items and articles, reading an item, and the article of an item (and the other way round).
 * IndoorID is in English: labels, descriptions and articles are asked for in English first.
 */

export const DEFAULT_WIKIDATA_URL = "https://www.wikidata.org/w/api.php";
/** `{lang}` is the Wikipedia's language (`fr`). */
export const DEFAULT_WIKIPEDIA_URL = "https://{lang}.wikipedia.org/w/api.php";

/** Languages asked for, in order (iD's `languagesToQuery`). */
const LANGUAGES = ["en"];

export interface WikidataItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly aliases: readonly string[];
}

interface LangValue {
	readonly value: string;
	readonly language: string;
}

/** An item as `wbgetentities` returns it (the parts used here). */
export interface WikidataEntity {
	readonly id?: string;
	readonly labels?: Readonly<Record<string, LangValue>>;
	readonly descriptions?: Readonly<Record<string, LangValue>>;
	readonly sitelinks?: Readonly<Record<string, { readonly title: string }>>;
}

export interface WikidataOptions {
	readonly baseUrl?: string;
	readonly fetch?: typeof fetch;
}

export class Wikidata {
	readonly #baseUrl: string;
	readonly #fetch: typeof fetch;
	readonly #entities = new Map<string, Promise<WikidataEntity>>();

	constructor({
		baseUrl = DEFAULT_WIKIDATA_URL,
		fetch = globalThis.fetch,
	}: WikidataOptions = {}) {
		this.#baseUrl = baseUrl;
		this.#fetch = fetch;
	}

	/** Items matching `query`, the best first. */
	async search(query: string): Promise<WikidataItem[]> {
		if (!query.trim()) return [];
		const result = (await this.#get({
			action: "wbsearchentities",
			format: "json",
			formatversion: "2",
			search: query,
			type: "item",
			language: LANGUAGES[0] as string,
			uselang: LANGUAGES[0] as string,
			limit: "10",
			origin: "*",
		})) as {
			search?: {
				id: string;
				display?: { label?: LangValue; description?: LangValue };
				label?: string;
				aliases?: string[];
			}[];
		};
		return (result.search ?? []).map((item) => {
			const description = item.display?.description?.value;
			return {
				id: item.id,
				label: item.display?.label?.value ?? item.label ?? item.id,
				...(description ? { description } : {}),
				aliases: item.aliases ?? [],
			};
		});
	}

	/** An item, with its labels, descriptions, claims and Wikipedia links; asked once. */
	entity(qid: string): Promise<WikidataEntity> {
		let entity = this.#entities.get(qid);
		if (!entity) {
			entity = this.#get({
				action: "wbgetentities",
				format: "json",
				formatversion: "2",
				ids: qid,
				props: "labels|descriptions|claims|sitelinks",
				sitefilter: LANGUAGES.map((l) => `${l}wiki`).join("|"),
				languages: LANGUAGES.join("|"),
				languagefallback: "1",
				origin: "*",
			}).then(
				(result) =>
					(result as { entities?: Record<string, WikidataEntity> }).entities?.[
						qid
					] ?? {},
			);
			this.#entities.set(qid, entity);
			entity.catch(() => this.#entities.delete(qid));
		}
		return entity;
	}

	/** Items whose Wikipedia article in `lang` is `title`. */
	async itemsByTitle(lang: string, title: string): Promise<string[]> {
		if (!title) return [];
		const result = (await this.#get({
			action: "wbgetentities",
			format: "json",
			formatversion: "2",
			sites: `${lang.replaceAll("-", "_")}wiki`,
			titles: title,
			languages: "en",
			origin: "*",
		})) as { entities?: Record<string, unknown> };
		return Object.keys(result.entities ?? {}).filter((id) => /^Q\d+$/.test(id));
	}

	async #get(params: Record<string, string>): Promise<unknown> {
		const response = await this.#fetch(
			`${this.#baseUrl}?${new URLSearchParams(params)}`,
		);
		if (!response.ok) throw new Error(`Wikidata: HTTP ${response.status}`);
		const result = (await response.json()) as { error?: { info?: string } };
		if (result.error) throw new Error(`Wikidata: ${result.error.info}`);
		return result;
	}
}

/** The best of a label or description set: in English, else any (iD's `entityPropertyForDisplay`). */
export function inLanguage(
	values: Readonly<Record<string, LangValue>> | undefined,
): LangValue | undefined {
	if (!values) return undefined;
	for (const lang of LANGUAGES) {
		if (values[lang]?.value) return values[lang];
	}
	return Object.values(values)[0];
}

/**
 * The `wikipedia` tag for an item: its English article, else any; null when it has none (the tag
 * goes), undefined when its links aren't known (the tag stays). As iD's wikidata field.
 */
export function wikipediaFromSitelinks(
	entity: WikidataEntity,
): string | null | undefined {
	const links = entity.sitelinks;
	if (!links) return undefined;
	const langs = [...LANGUAGES];
	for (const values of [entity.labels, entity.descriptions]) {
		const first = values && Object.keys(values)[0];
		if (first && !langs.includes(first)) langs.push(first);
	}
	for (const lang of langs) {
		const link = links[`${lang.replaceAll("-", "_")}wiki`];
		if (link) return `${lang}:${link.title}`;
	}
	const site = Object.keys(links).find(
		(s) => s.endsWith("wiki") && s !== "commonswiki" && s !== "specieswiki",
	);
	if (!site) return null;
	return `${site.slice(0, -4).replaceAll("_", "-")}:${links[site]?.title}`;
}

/**
 * Wikipedia article titles for `query` in a language: suggestions for a short text, a full-text
 * search for a longer one (as iD).
 */
export async function searchWikipedia(
	lang: string,
	query: string,
	{
		template = DEFAULT_WIKIPEDIA_URL,
		fetch = globalThis.fetch,
	}: { template?: string; fetch?: typeof globalThis.fetch } = {},
): Promise<string[]> {
	if (!query) return [];
	const base = template.replace("{lang}", lang || "en");
	const search = query.length > 7;
	const params: Record<string, string> = search
		? {
				action: "query",
				list: "search",
				srlimit: "10",
				srinfo: "suggestion",
				format: "json",
				origin: "*",
				srsearch: query,
			}
		: {
				action: "opensearch",
				namespace: "0",
				suggest: "",
				format: "json",
				origin: "*",
				search: query,
			};
	const response = await fetch(`${base}?${new URLSearchParams(params)}`);
	if (!response.ok) throw new Error(`Wikipedia: HTTP ${response.status}`);
	const result = (await response.json()) as unknown;
	if (search) {
		const found = (result as { query?: { search?: { title: string }[] } }).query
			?.search;
		return (found ?? []).map((d) => d.title);
	}
	return Array.isArray(result)
		? ((result[1] as string[] | undefined) ?? [])
		: [];
}
