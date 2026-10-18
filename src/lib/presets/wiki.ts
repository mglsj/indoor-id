/**
 * Wikipedia tag values (iD's `ui/fields/wikipedia.js`) and what the ⓘ tag reference documents for
 * a field or a feature type (iD's `ui/field.js` and `presetPreset.reference`).
 */
import type { Tags } from "#lib/osm/tags.ts";
import type { Field, Preset } from "./presets.ts";

/** A Wikipedia: [English name, own name, code], as wmf-sitematrix lists them. */
export type WikipediaSite = readonly [string, string, string];

/** `fr:Musée du Louvre#Histoire` → its language, title and section; null otherwise. */
export function parseWikipediaTag(
	value: string,
): { lang: string; title: string; anchor?: string } | null {
	const m = value.match(/^([^:]+):([^#]+)(?:#(.+))?$/);
	if (!m) return null;
	return {
		lang: m[1] as string,
		title: m[2] as string,
		...(m[3] ? { anchor: m[3] } : {}),
	};
}

/** The article's address. */
export function wikipediaUrl(
	lang: string,
	title: string,
	anchor?: string,
): string {
	const encode = (s: string) => encodeURIComponent(s.replace(/ /g, "_"));
	return `https://${lang}.wikipedia.org/wiki/${encode(title)}${anchor ? `#${encode(anchor)}` : ""}`;
}

/**
 * The language and title of a pasted article address (titles normalized as MediaWiki does:
 * spaces, a capital first letter), or null.
 */
export function parseWikipediaUrl(
	text: string,
): { lang: string; title: string } | null {
	const m = text.match(
		/https?:\/\/([-a-z]+)\.wikipedia\.org\/(?:wiki|\1-[-a-z]+)\/([^#]+)(?:#(.+))?/,
	);
	if (!m) return null;
	let title = decodeURIComponent(m[2] as string).replace(/_/g, " ");
	if (m[3]) title += `#${decodeURIComponent(m[3]).replace(/_/g, " ")}`;
	return {
		lang: m[1] as string,
		title: title.slice(0, 1).toUpperCase() + title.slice(1),
	};
}

/** The Wikipedia typed: by English name, own name or code. */
export function wikipediaLanguage(
	sites: readonly WikipediaSite[],
	typed: string,
): WikipediaSite | undefined {
	const text = typed.trim().toLowerCase();
	return sites.find(
		([english, own, code]) =>
			english.toLowerCase() === text ||
			own.toLowerCase() === text ||
			code === text,
	);
}

/** A key, and maybe a value, the OSM wiki documents. */
export interface TagReference {
	readonly key: string;
	readonly value?: string;
}

/** What a field's ⓘ documents: its key (`payment:*` for a multiCombo) and the value set. */
export function fieldReference(field: Field, tags: Tags): TagReference | null {
	if (field.reference?.key) {
		const { key, value } = field.reference;
		return value ? { key, value } : { key };
	}
	if (!field.key) return null;
	const key =
		field.type === "multiCombo" ? field.key.replace(/:$/, ":*") : field.key;
	const value = tags[key];
	return value ? { key, value } : { key };
}

/** What a feature type's ⓘ documents: its main tag, or its key when any value goes. */
export function presetReference(preset: Preset): TagReference | null {
	const key =
		preset.reference?.key ?? Object.keys(preset.tags).find((k) => k !== "name");
	if (!key) return null;
	const value = preset.reference?.value ?? preset.tags[key];
	return !value || value === "*" ? { key } : { key, value };
}
