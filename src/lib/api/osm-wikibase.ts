/**
 * Tag documentation from the OSM wiki's data items (Wikibase), as iD's `services/osm_wikibase.js`
 * gives it to the ⓘ tag reference: a description, an image and the wiki page, in English.
 */

export const DEFAULT_OSM_WIKI_URL = "https://wiki.openstreetmap.org/w/api.php";

/** What the ⓘ reference shows. */
export interface TagDocs {
	/** The data item's page (`Tag:amenity=cafe`). */
	readonly title: string;
	readonly description: string;
	/** Where the description is edited. */
	readonly editUrl: string;
	readonly imageUrl?: string;
	/** The wiki page about the tag or key. */
	readonly wiki?: { readonly title: string; readonly url: string };
}

interface Claim {
	readonly rank?: string;
	readonly mainsnak: {
		readonly datavalue: {
			readonly type?: string;
			readonly value: unknown;
		};
	};
}

interface DataItem {
	readonly title: string;
	readonly descriptions: Readonly<
		Record<string, { readonly language: string; readonly value: string }>
	>;
	readonly claims: Readonly<Record<string, readonly Claim[]>>;
}

const LANGUAGE = "en";

/** `Key:level`, `Tag:indoor=room`: the wiki's titles, with spaces for underscores. */
function sitelink(key: string, value?: string): string {
	return (value ? `Tag:${key}=${value}` : `Key:${key}`)
		.replace(/_/g, " ")
		.trim();
}

export class OsmWikibase {
	readonly #api: string;
	/** `https://…/wiki/`, for the pages. */
	readonly #pages: string;
	readonly #fetch: typeof fetch;
	/** Data items by title; null when the wiki has none. */
	readonly #items = new Map<string, DataItem | null>();

	constructor({
		baseUrl = DEFAULT_OSM_WIKI_URL,
		fetch = globalThis.fetch,
	}: { baseUrl?: string; fetch?: typeof globalThis.fetch } = {}) {
		this.#api = baseUrl;
		this.#pages = baseUrl.replace(/\/w\/api\.php$/, "/wiki/");
		this.#fetch = fetch;
	}

	/** The documentation of a tag, or of its key when the tag has none; null when neither has. */
	async docs({
		key,
		value,
	}: {
		key: string;
		value?: string;
	}): Promise<TagDocs | null> {
		const keyTitle = sitelink(key);
		const tagTitle = value ? sitelink(key, value) : undefined;
		await this.#load([keyTitle, ...(tagTitle ? [tagTitle] : [])]);
		const keyItem = this.#items.get(keyTitle) ?? null;
		const tagItem = tagTitle ? (this.#items.get(tagTitle) ?? null) : null;
		const item = tagItem ?? keyItem;
		if (!item) return null;

		const description =
			item.descriptions[LANGUAGE] ?? Object.values(item.descriptions)[0];
		const commons = preferred(item, "P4");
		const wikiImage = commons ? undefined : preferred(item, "P28");
		const image = commons ?? wikiImage;
		const imageRoot = commons
			? "https://commons.wikimedia.org/w/index.php"
			: `${this.#pages.replace(/\/wiki\/$/, "")}/w/index.php`;
		// The tag's page in English, else the key's.
		const page = [tagItem, keyItem]
			.map((i) => (i ? pages(i)[LANGUAGE] : undefined))
			.find(Boolean);
		return {
			title: item.title,
			description: description?.value ?? "",
			editUrl: `${this.#pages}${item.title}`,
			...(typeof image === "string"
				? {
						imageUrl: `${imageRoot}?${new URLSearchParams({
							title: `Special:Redirect/file/${image}`,
							width: "400",
						})}`,
					}
				: {}),
			...(page ? { wiki: { title: page, url: `${this.#pages}${page}` } } : {}),
		};
	}

	async #load(titles: string[]): Promise<void> {
		const missing = titles.filter((t) => !this.#items.has(t));
		if (missing.length === 0) return;
		const params = new URLSearchParams({
			action: "wbgetentities",
			sites: "wiki",
			titles: missing.join("|"),
			languages: LANGUAGE,
			languagefallback: "1",
			origin: "*",
			format: "json",
		});
		const response = await this.#fetch(`${this.#api}?${params}`);
		if (!response.ok) throw new Error(`OSM wiki: HTTP ${response.status}`);
		const result = (await response.json()) as {
			success?: number;
			entities?: Record<
				string,
				| (DataItem & { sitelinks?: { wiki?: { title: string } } })
				| { missing: "" }
			>;
		};
		if (!result.success) throw new Error("OSM wiki: no data");
		for (const title of missing) this.#items.set(title, null);
		for (const entity of Object.values(result.entities ?? {})) {
			if ("missing" in entity) continue;
			const title = entity.sitelinks?.wiki?.title;
			if (title) this.#items.set(title, { ...entity, title });
		}
	}
}

/** A claim's preferred value (iD's `claimToValue` without the per-language qualifier). */
function preferred(item: DataItem, property: string): unknown {
	const claims = item.claims[property] ?? [];
	const claim = claims.find((c) => c.rank === "preferred") ?? claims[0];
	const value = claim?.mainsnak.datavalue.value;
	return typeof value === "object" && value && "id" in value ? value.id : value;
}

/** The wiki pages of an item by language (its P31 claims). */
function pages(item: DataItem): Record<string, string> {
	const result: Record<string, string> = {};
	for (const claim of item.claims.P31 ?? []) {
		const value = claim.mainsnak.datavalue.value as {
			language: string;
			text: string;
		};
		result[value.language] = value.text;
	}
	return result;
}

export type WikiTextPart =
	| { readonly text: string }
	| { readonly tag: string; readonly href: string };

/** A description with its `key:level` and `tag:indoor=room` mentions as links (as iD). */
export function linkifyWikiText(text: string): WikiTextPart[] {
	const parts: WikiTextPart[] = [];
	const segments = text.split(/(key|tag):([\w-]+)(=([\w-]+))?/g);
	for (let i = 0; i < segments.length; i += 5) {
		const [plain, , key, , value] = segments.slice(i);
		if (plain) parts.push({ text: plain });
		if (key) {
			parts.push({
				tag: `${key}=${value || "*"}`,
				href: `https://wiki.openstreetmap.org/wiki/${sitelink(key, value)}`,
			});
		}
	}
	return parts;
}
