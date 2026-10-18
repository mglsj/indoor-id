/**
 * Value suggestions from taginfo, as iD's `services/taginfo.js` asks for them: the values used
 * on features of the same geometry, the most used first, without rare or odd ones. Answers are
 * cached for the session; a longer query is answered from a shorter one that got every value.
 */
import type { PresetGeometry } from "#lib/presets/presets.ts";

export const DEFAULT_TAGINFO_URL = "https://taginfo.openstreetmap.org/api/4/";

export interface TaginfoValue {
	readonly value: string;
	/** Taginfo's description of the value, or the value. */
	readonly title: string;
}

export interface TaginfoOptions {
	readonly baseUrl?: string;
	readonly fetch?: typeof fetch;
	/** Language of the descriptions. */
	readonly lang?: string;
}

/** Results per request; a shorter query with fewer results holds all of a longer one's. */
const PAGE = 25;

const SORT: Partial<Record<PresetGeometry, string>> = {
	point: "count_nodes",
	vertex: "count_nodes",
	area: "count_ways",
	line: "count_ways",
};
const FILTER: Partial<Record<PresetGeometry, string>> = {
	point: "nodes",
	vertex: "nodes",
	area: "ways",
	line: "ways",
};

/** Keys whose values aren't worth suggesting (names, addresses), as iD. */
const EXCLUDED_KEYS =
	/^(addr:.+|postal_code|via|((int_|loc_|nat_|official_|old_|ref_|reg_|short_|full_|sorting_|alt_|artist_|long_|bridge:|tunnel:)?name(:left|:right)?(:[a-z]+)?))$/;
/** Keys whose values may have capitals (iD's `allowUpperCaseTagValues`). */
const UPPERCASE_KEYS =
	/network|taxon|genus|species|brand|grape_variety|royal_cypher|listed_status|booth|rating|stars|:output|_hours|_times|_ref|manufacturer|country|target|brewery|cai_scale|traffic_sign/;

interface Page<T> {
	data: T[];
}

export class Taginfo {
	readonly #baseUrl: string;
	readonly #fetch: typeof fetch;
	readonly #lang: string;
	/** Answers by URL, kept for the session. */
	readonly #cache = new Map<string, Promise<TaginfoValue[]>>();
	readonly #done = new Map<string, TaginfoValue[]>();
	/** The most used keys: their values stress taginfo and suggest little (iD #3955). */
	#popular: Promise<Set<string>> | undefined;

	constructor({
		baseUrl = DEFAULT_TAGINFO_URL,
		fetch = globalThis.fetch,
		lang = "en",
	}: TaginfoOptions = {}) {
		this.#baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
		this.#fetch = fetch;
		this.#lang = lang;
	}

	/** Values of `key` starting with or containing `query`, for features of `geometry`. */
	async values({
		key,
		query,
		geometry,
	}: {
		key: string;
		query: string;
		geometry: PresetGeometry;
	}): Promise<TaginfoValue[]> {
		if (EXCLUDED_KEYS.test(key) || (await this.#popularKeys()).has(key))
			return [];
		const params = {
			key,
			query,
			...(FILTER[geometry] ? { filter: FILTER[geometry] } : {}),
		};
		const allowUpperCase = UPPERCASE_KEYS.test(key);
		return this.#get<{ value: string; count: number; description?: string }>(
			"key/values",
			params,
			geometry,
			true,
			(data) =>
				data
					.filter(
						(d) =>
							!/[;,]/.test(d.value) &&
							(allowUpperCase || !/[A-Z*]/.test(d.value)) &&
							d.count > 100,
					)
					.map((d) => ({ value: d.value, title: d.description || d.value })),
		);
	}

	/** Keys one level under the prefix `query` ends at (`payment:c` → `payment:cash`). */
	multikeys({
		query,
		geometry,
	}: {
		query: string;
		geometry: PresetGeometry;
	}): Promise<TaginfoValue[]> {
		const prefix = query.toLowerCase();
		return this.#get<{ key: string }>(
			"keys/all",
			{ query },
			geometry,
			false,
			(data) =>
				data
					.filter((d) => {
						const key = d.key.toLowerCase();
						return (
							key.startsWith(prefix) && !key.slice(prefix.length).includes(":")
						);
					})
					.map((d) => ({ value: d.key, title: d.key })),
		);
	}

	/**
	 * Keys starting with or containing `query`, used more than 2,500 times or documented on
	 * the wiki, those without `:` first (iD's `keys`).
	 */
	keys({
		query,
		geometry,
	}: {
		query: string;
		geometry: PresetGeometry;
	}): Promise<TaginfoValue[]> {
		return this.#get<{ key: string; count_all?: number; in_wiki?: boolean }>(
			"keys/all",
			{ query },
			geometry,
			true,
			(data) =>
				data
					.filter(
						(d) =>
							(Number(d.count_all) > 2500 || d.in_wiki) &&
							!/^(hashtags?|created_by)$/.test(d.key),
					)
					.sort(
						(a, b) => Number(a.key.includes(":")) - Number(b.key.includes(":")),
					)
					.map((d) => ({ value: d.key, title: d.key })),
			10,
		);
	}

	/**
	 * Roles used in relations of `type` by members of `geometry` (iD's `roles`): without empty
	 * ones or those with capitals, `*`, `;` or `,`; those starting with `query` first.
	 */
	async roles({
		type,
		query,
		geometry,
	}: {
		type: string;
		query: string;
		geometry: PresetGeometry;
	}): Promise<TaginfoValue[]> {
		const members =
			geometry === "point" || geometry === "vertex"
				? "node"
				: geometry === "relation"
					? "relation"
					: "way";
		const found = await this.#get<Record<string, unknown> & { role: string }>(
			"relation/roles",
			{ rtype: type, query, sortname: `count_${members}_members` },
			geometry,
			false,
			(data) =>
				data
					.filter(
						(d) =>
							d.role !== "" &&
							!/[A-Z*;,]/.test(d.role) &&
							Number(d[`count_${members}_members_fraction`]) > 0,
					)
					.map((d) => ({ value: d.role, title: d.role })),
		);
		return [
			...found.filter((r) => r.value.startsWith(query)),
			...found.filter((r) => !r.value.startsWith(query)),
		];
	}

	#popularKeys(): Promise<Set<string>> {
		this.#popular ??= this.#json<{ key: string }>(
			this.#url("keys/all", {
				rp: "100",
				sortname: "values_all",
				sortorder: "desc",
				page: "1",
				lang: this.#lang,
			}),
		)
			.then(
				(data) =>
					new Set(
						data.map((d) => d.key).filter((key) => key !== "opening_hours"),
					),
			)
			.catch(() => new Set<string>());
		return this.#popular;
	}

	#get<T>(
		path: string,
		params: Record<string, string>,
		geometry: PresetGeometry,
		/** Whether a shorter query's complete answer can stand for this one. */
		shortens: boolean,
		convert: (data: T[]) => TaginfoValue[],
		page = PAGE,
	): Promise<TaginfoValue[]> {
		const url = (query: string) =>
			this.#url(path, {
				...params,
				query,
				sortname: params.sortname ?? SORT[geometry] ?? "count_all",
				sortorder: "desc",
				page: "1",
				rp: String(page),
				lang: this.#lang,
			});
		const query = params.query ?? "";
		const exact = url(query);
		const cached = this.#cache.get(exact);
		if (cached) return cached;
		if (shortens) {
			for (let n = query.length - 1; n >= 0; n--) {
				const shorter = this.#done.get(url(query.slice(0, n)));
				if (shorter && shorter.length < page) return Promise.resolve(shorter);
			}
		}
		const answer = this.#json<T>(exact).then(convert);
		this.#cache.set(exact, answer);
		answer.then(
			(values) => this.#done.set(exact, values),
			() => this.#cache.delete(exact),
		);
		return answer;
	}

	#url(path: string, params: Record<string, string>): string {
		return `${this.#baseUrl}${path}?${new URLSearchParams(params)}`;
	}

	async #json<T>(url: string): Promise<T[]> {
		const response = await this.#fetch(url);
		if (!response.ok) throw new Error(`taginfo: HTTP ${response.status}`);
		return ((await response.json()) as Page<T>).data;
	}
}
