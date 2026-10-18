/**
 * Presets: named feature types ("Room", "Toilets") with their tags and fields, from iD's
 * tagging schema (see scripts/build-presets.ts) plus `overlay.json`.
 */
import { isArea } from "#lib/osm/area.ts";
import type { Tags } from "#lib/osm/tags.ts";

/** Geometry as presets see it: a node on a way is a vertex. */
export type PresetGeometry = "point" | "vertex" | "line" | "area" | "relation";

export interface Preset {
	readonly id: string;
	readonly name: string;
	readonly terms: readonly string[];
	/** Other names of the feature type, searched like its name. */
	readonly aliases?: readonly string[];
	readonly icon?: string;
	readonly geometry: readonly PresetGeometry[];
	readonly tags: Tags;
	/** Tags set when choosing the preset (default: `tags`). */
	readonly addTags?: Tags;
	/** Tags removed when leaving the preset (default: `addTags`). */
	readonly removeTags?: Tags;
	readonly matchScore?: number;
	readonly searchable?: boolean;
	readonly fields: readonly string[];
	readonly moreFields: readonly string[];
	/** What its ⓘ documents, when not its main tag. */
	readonly reference?: { readonly key?: string; readonly value?: string };
}

export interface FieldOption {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

/**
 * When a field applies (iD's `prerequisiteTag`): `key` set (to `value`, one of `values`, not
 * `valueNot`, none of `valuesNot`), or `keyNot` unset.
 */
export interface PrerequisiteTag {
	readonly key?: string;
	readonly value?: string;
	readonly values?: readonly string[];
	readonly valueNot?: string;
	readonly valuesNot?: readonly string[];
	readonly keyNot?: string;
}

/** A field of iD's schema, as the feature editor uses it. */
export interface Field {
	readonly id: string;
	readonly key?: string;
	readonly keys?: readonly string[];
	/** `combo`, `semiCombo`, `check`, `text`, `number`… (see iD's `modules/ui/fields`). */
	readonly type: string;
	readonly label: string;
	readonly placeholder?: string;
	readonly options: readonly FieldOption[];
	/** Other words to find the field by in "Add field". */
	readonly terms: readonly string[];
	/** Can be added to any feature (name, note, fixme…). */
	readonly universal: boolean;
	readonly prerequisiteTag?: PrerequisiteTag;
	/** Values typed are turned into snake_case (`Fast Food` → `fast_food`). */
	readonly snakeCase: boolean;
	/** Values typed keep their case. */
	readonly caseSensitive: boolean;
	/** Values other than the options can be typed. */
	readonly customValues: boolean;
	/** Values used elsewhere (taginfo) are suggested. */
	readonly autoSuggestions: boolean;
	/** A `;` list may repeat a value. */
	readonly allowDuplicates: boolean;
	readonly increment?: number;
	readonly minValue?: number;
	readonly maxValue?: number;
	/** Link for identifier values: `{value}` is replaced. */
	readonly urlFormat?: string;
	/** Regular expression a value must match to be linked. */
	readonly pattern?: string;
	/** What the ⓘ help shows, when not the field's key. */
	readonly reference?: { readonly key?: string; readonly value?: string };
	/** Value set when the field is added. */
	readonly default?: string;
	/** Geometries the field applies to, when not all of its preset's. */
	readonly geometry?: readonly PresetGeometry[];
	/** Names of an access field's rows, by key (`foot`: "Foot"). */
	readonly types?: Readonly<Record<string, string>>;
	/** Placeholders of an address field's parts (`street`: "Street"). */
	readonly placeholders?: Readonly<Record<string, string>>;
}

/** A group of presets offered together in the feature type list ("Building Features"). */
export interface PresetCategory {
	readonly id: string;
	readonly name: string;
	readonly icon?: string;
	readonly members: readonly Preset[];
}

/** A category as stored: its members by preset id. */
export interface CategoryData {
	readonly id: string;
	readonly name: string;
	readonly icon?: string;
	readonly members: readonly string[];
}

/** Keys a change of type never drops, whatever fields the new type has. */
const LEVEL_KEYS = ["level", "level:ref", "repeat_on"];

/** Presets offered before typing a search, by geometry: the common indoor ones. */
export const DEFAULT_PRESETS: Record<PresetGeometry, readonly string[]> = {
	area: [
		"indoor/room",
		"indoor/corridor",
		"indoor/area",
		"indoor/stairs",
		"indoor/elevator",
		"indoor/level",
		"amenity/toilets",
	],
	line: ["indoor/wall", "highway/corridor", "highway/steps", "highway/footway"],
	vertex: ["door", "entrance", "highway/elevator"],
	point: [
		"amenity/toilets",
		"amenity/vending_machine",
		"amenity/bench",
		"highway/elevator",
	],
	relation: [],
};

const FALLBACKS: Record<PresetGeometry, string> = {
	point: "point",
	vertex: "point",
	line: "line",
	area: "area",
	relation: "relation",
};

export class PresetIndex {
	readonly #presets: readonly Preset[];
	readonly #searchText: ReadonlyMap<Preset, SearchText>;
	readonly #categories: readonly PresetCategory[];
	readonly #byId: ReadonlyMap<string, Preset>;
	readonly #fields: ReadonlyMap<string, Field>;
	/** Positions of the presets with tags, by their first key: only those can match. */
	readonly #byKey = new Map<string, number[]>();
	readonly #matches = new WeakMap<Tags, Map<PresetGeometry, Preset>>();

	constructor(
		presets: readonly Preset[],
		fields: readonly Field[],
		categories: readonly CategoryData[] = [],
	) {
		this.#presets = presets;
		this.#searchText = new Map(presets.map((p) => [p, searchText(p)]));
		this.#byId = new Map(presets.map((p) => [p.id, p]));
		this.#fields = new Map(fields.map((f) => [f.id, f]));
		this.#categories = categories.map((c) => ({
			...c,
			members: c.members.flatMap((id) => this.#byId.get(id) ?? []),
		}));
		presets.forEach((preset, i) => {
			const [key] = Object.keys(preset.tags);
			if (key === undefined) return;
			const positions = this.#byKey.get(key);
			if (positions) positions.push(i);
			else this.#byKey.set(key, [i]);
		});
	}

	preset(id: string): Preset | undefined {
		return this.#byId.get(id);
	}

	field(id: string): Field | undefined {
		return this.#fields.get(id);
	}

	/** Whether a preset is the generic one of a geometry ("Point", "Line", "Area"…). */
	isFallback(preset: Preset): boolean {
		return Object.values(FALLBACKS).includes(preset.id);
	}

	/** Fields that can be added to any feature, by label. */
	universalFields(): Field[] {
		return [...this.#fields.values()]
			.filter((f) => f.universal)
			.sort((a, b) => a.label.localeCompare(b.label));
	}

	/** Categories of the feature type list, with their presets. */
	categories(): readonly PresetCategory[] {
		return this.#categories;
	}

	/** The fields of a preset, then its optional "more" fields, skipping unknown ones. */
	fieldsOf(preset: Preset): { fields: Field[]; moreFields: Field[] } {
		const resolve = (ids: readonly string[]) =>
			ids
				.map((id) => this.#fields.get(id))
				.filter((f): f is Field => f !== undefined);
		return {
			fields: resolve(preset.fields),
			moreFields: resolve(preset.moreFields),
		};
	}

	/**
	 * The best preset for these tags, or the generic one for the geometry. Results are cached
	 * by tags object, which is never mutated, so redrawing the map after an edit is cheap.
	 */
	match(tags: Tags, geometry: PresetGeometry): Preset {
		let byGeometry = this.#matches.get(tags);
		if (!byGeometry) {
			byGeometry = new Map();
			this.#matches.set(tags, byGeometry);
		}
		let preset = byGeometry.get(geometry);
		if (!preset) {
			preset = this.#match(tags, geometry);
			byGeometry.set(geometry, preset);
		}
		return preset;
	}

	#match(tags: Tags, geometry: PresetGeometry): Preset {
		// Presets whose first key is in the tags, in schema order (it breaks ties).
		const positions = Object.keys(tags)
			.flatMap((key) => this.#byKey.get(key) ?? [])
			.sort((a, b) => a - b);
		let best: Preset | undefined;
		let bestScore = 0;
		for (const i of positions) {
			const preset = this.#presets[i] as Preset;
			if (!preset.geometry.includes(geometry)) continue;
			const score = matchScore(preset, tags);
			if (score > bestScore) {
				best = preset;
				bestScore = score;
			}
		}
		return best ?? this.#fallback(geometry);
	}

	/**
	 * Searchable presets for the geometry matching the query, ranked as iD ranks them: names and
	 * aliases starting with it (or a word in them starting with it), the same without accents,
	 * search terms, tag values, names a typo or two away, `key=value`, and presets whose name is
	 * in the query; the generic preset of the geometry comes last.
	 */
	search(query: string, geometry: PresetGeometry, limit = 50): Preset[] {
		const value = query.toLowerCase().trim();
		if (!value) return [];
		const pool = this.#presets.filter(
			(p) => p.searchable !== false && p.geometry.includes(geometry),
		);
		const text = (p: Preset) => this.#searchText.get(p) ?? searchText(p);
		// At the start of the text or of a word in it ("office" finds "Law Office").
		const leading = (a: string) => {
			const index = a.indexOf(value);
			return index === 0 || (index > 0 && a[index - 1] === " ");
		};
		const inQuery = (a: string) => {
			if (!a) return false;
			const index = value.indexOf(a);
			return index === 0 || (index > 0 && value[index - 1] === " ");
		};
		const byName =
			(name: "name" | "stripped", aliases: "aliases" | "aliasesStripped") =>
			(a: Preset, b: Preset) => {
				const closest = (p: Preset) => {
					const names = [text(p)[name], ...text(p)[aliases]];
					return (
						names.find((n) => n === value) ??
						names
							.filter((n) => n.includes(value))
							.sort((x, y) => x.length - y.length)[0] ??
						text(p)[name]
					);
				};
				const [ca, cb] = [closest(a), closest(b)];
				if (ca === value) return -1;
				if (cb === value) return 1;
				return (
					(b.matchScore ?? 1) - (a.matchScore ?? 1) ||
					ca.indexOf(value) - cb.indexOf(value) ||
					ca.length - cb.length
				);
			};
		const near = (a: string) =>
			editDistance(value, a) + Math.min(value.length - a.length, 0) < 3;
		const tagPairs = (tags: Tags | undefined) =>
			Object.entries(tags ?? {}).map(([k, v]) => `${k}=${v}`);

		const results = [
			...pool
				.filter((p) => leading(text(p).name) || text(p).aliases.some(leading))
				.sort(byName("name", "aliases")),
			...pool
				.filter(
					(p) =>
						leading(text(p).stripped) || text(p).aliasesStripped.some(leading),
				)
				.sort(byName("stripped", "aliasesStripped")),
			...pool.filter((p) => text(p).terms.some(leading)),
			...pool.filter((p) =>
				Object.values(p.tags).some((v) => v !== "*" && leading(v)),
			),
			...pool
				.map((p) => ({ p, d: editDistance(value, text(p).name) }))
				.filter(({ p }) => near(text(p).name))
				.sort((a, b) => a.d - b.d)
				.map(({ p }) => p),
			...pool.filter((p) => text(p).terms.some(near)),
			...(value.includes("=")
				? [
						...pool.filter((p) => tagPairs(p.tags).includes(value)),
						...pool.filter((p) => tagPairs(p.tags).some(leading)),
						...pool.filter((p) => tagPairs(p.addTags).includes(value)),
						...pool.filter((p) => tagPairs(p.addTags).some(leading)),
					]
				: []),
			...pool.filter((p) => {
				const t = text(p);
				return [t.name, ...t.aliases, ...t.terms, t.stripped].some(inQuery);
			}),
		].slice(0, limit - 1);
		results.push(this.#fallback(geometry));
		return [...new Set(results)];
	}

	/**
	 * The feature type list before a search: the recently chosen presets (`recent`, by id), the
	 * indoor defaults and the categories for the geometry, the generic preset, and the feature's
	 * `current` one when the list doesn't have it.
	 */
	listFor(
		geometry: PresetGeometry,
		recent: readonly string[],
		current?: Preset,
	): (Preset | PresetCategory)[] {
		const items: (Preset | PresetCategory)[] = [];
		const seen = new Set<string>();
		const add = (item: Preset | PresetCategory | undefined) => {
			if (!item || seen.has(item.id)) return;
			seen.add(item.id);
			items.push(item);
		};
		const forGeometry = (id: string) => {
			const preset = this.#byId.get(id);
			return preset?.geometry.includes(geometry) ? preset : undefined;
		};
		for (const id of recent) add(forGeometry(id));
		for (const id of DEFAULT_PRESETS[geometry]) add(forGeometry(id));
		for (const category of this.#categories) {
			if (category.members.some((p) => p.geometry.includes(geometry))) {
				add(category);
			}
		}
		add(this.#fallback(geometry));
		add(current);
		return items;
	}

	/**
	 * Tags after changing a feature's preset from `from` to `to`, as iD's `actionChangePreset`:
	 * the old preset's tags and field defaults go, and the values of its fields the new one has
	 * no field for (unless the old preset still matches what is left: a building becoming a
	 * school keeps its building fields); then the new preset's tags, `area=yes` when needed and
	 * its field defaults are set. Other tags stay.
	 *
	 * Two IndoorID rules on top: `level`, `level:ref` and `repeat_on` always stay, and a feature
	 * with a level or an `indoor` tag doesn't get a `building` default (a room becoming a cafe).
	 */
	changePreset(
		tags: Tags,
		from: Preset | undefined,
		to: Preset | undefined,
		geometry: PresetGeometry,
	): Tags {
		let result: Tags = { ...tags };
		const keep: string[] = [...LEVEL_KEYS];
		const indoor =
			tags.level !== undefined ||
			tags.indoor !== undefined ||
			(to?.addTags ?? to?.tags)?.indoor !== undefined;
		if (to) {
			keep.push(...Object.keys(to.addTags ?? to.tags));
			if (from) {
				// Going to a parent preset drops what defined the sub-preset (pizza → restaurant).
				const wasSubPreset = from.id.startsWith(to.id);
				for (const key of this.#fieldKeys(to, geometry)) {
					if (!wasSubPreset || from.tags[key] === undefined) keep.push(key);
				}
				if (from.id !== to.id) {
					const dropped = this.#fieldKeys(from).filter(
						(k) => !keep.includes(k),
					);
					let reduced: Tags = Object.fromEntries(
						Object.entries(result).filter(([k]) => !dropped.includes(k)),
					);
					reduced = this.#unsetTags(from, reduced, geometry, keep);
					reduced = this.#setTags(to, reduced, geometry, indoor);
					if (matchScore(from, reduced) === -1) result = reduced;
				}
			}
		}
		if (from) result = this.#unsetTags(from, result, geometry, keep);
		if (to) result = this.#setTags(to, result, geometry, indoor);
		return result;
	}

	/** Keys of a preset's fields and more fields (for `geometry` only, when given). */
	#fieldKeys(preset: Preset, geometry?: PresetGeometry): string[] {
		const { fields, moreFields } = this.fieldsOf(preset);
		return [...fields, ...moreFields]
			.filter((f) => !geometry || !f.geometry || f.geometry.includes(geometry))
			.flatMap((f) => [...(f.key ? [f.key] : []), ...(f.keys ?? [])]);
	}

	#unsetTags(
		preset: Preset,
		tags: Tags,
		geometry: PresetGeometry,
		keep: readonly string[],
	): Tags {
		const result: Record<string, string> = { ...tags };
		const removed = preset.removeTags ?? preset.addTags ?? preset.tags;
		for (const key of Object.keys(removed)) {
			if (!keep.includes(key)) delete result[key];
		}
		for (const field of this.fieldsOf(preset).fields) {
			if (
				field.key &&
				field.default !== undefined &&
				(!field.geometry || field.geometry.includes(geometry)) &&
				result[field.key] === field.default &&
				!keep.includes(field.key)
			) {
				delete result[field.key];
			}
		}
		delete result.area;
		return result;
	}

	#setTags(
		preset: Preset,
		tags: Tags,
		geometry: PresetGeometry,
		indoor: boolean,
	): Tags {
		const result: Record<string, string> = { ...tags };
		const added = preset.addTags ?? preset.tags;
		for (const [key, value] of Object.entries(added)) {
			if (value !== "*") result[key] = value;
			// Any value of the preset's own tag becomes yes; an extra one keeps its value.
			else if (preset.tags[key] !== undefined || !result[key])
				result[key] = "yes";
		}
		if (!("area" in added)) {
			delete result.area;
			// A closed way stays an area: say so when the tags alone wouldn't.
			const areaByTags = isArea(
				Object.fromEntries(
					Object.entries(added).map(([k, v]) => [k, v === "*" ? "yes" : v]),
				),
			);
			if (
				geometry === "area" &&
				(preset.geometry.includes("line") || !areaByTags)
			) {
				result.area = "yes";
			}
		}
		for (const field of this.fieldsOf(preset).fields) {
			if (
				field.key &&
				field.default !== undefined &&
				(!field.geometry || field.geometry.includes(geometry)) &&
				!result[field.key] &&
				// A room becoming a cafe doesn't become a building (iD's `building_area_yes`).
				!(indoor && field.key === "building")
			) {
				result[field.key] = field.default;
			}
		}
		return result;
	}

	#fallback(geometry: PresetGeometry): Preset {
		const id = FALLBACKS[geometry];
		return (
			this.#byId.get(id) ?? {
				id,
				name: id,
				terms: [],
				geometry: [geometry],
				tags: {},
				fields: [],
				moreFields: [],
			}
		);
	}
}

/**
 * How well a preset fits tags, as in iD: each preset tag must be present; an exact value counts
 * `matchScore`, a `*` value half of it. Generic presets without tags score 0 (fallbacks only).
 */
function matchScore(preset: Preset, tags: Tags): number {
	const weight = preset.matchScore ?? 1;
	let score = 0;
	for (const [key, value] of Object.entries(preset.tags)) {
		if (tags[key] === value) score += weight;
		else if (value === "*" && tags[key] !== undefined) score += weight / 2;
		else return -1;
	}
	return score;
}

/** A preset's names, terms and tag values, lowercased once for search. */
interface SearchText {
	readonly name: string;
	readonly stripped: string;
	readonly aliases: readonly string[];
	readonly aliasesStripped: readonly string[];
	readonly terms: readonly string[];
}

function searchText(preset: Preset): SearchText {
	const name = preset.name.toLowerCase();
	const aliases = (preset.aliases ?? []).map((a) => a.toLowerCase());
	return {
		name,
		stripped: stripAccents(name),
		aliases,
		aliasesStripped: aliases.map(stripAccents),
		terms: preset.terms.map((t) => t.toLowerCase()),
	};
}

function stripAccents(text: string): string {
	return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** Levenshtein distance: the edits turning one text into the other. */
function editDistance(a: string, b: string): number {
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				(previous[j] ?? 0) + 1,
				(current[j - 1] ?? 0) + 1,
				(previous[j - 1] ?? 0) + cost,
			);
		}
		previous = current;
	}
	return previous[b.length] ?? 0;
}
