/**
 * Translations of a localized field (`name:fr`), as iD's `ui/fields/localized.js`, with
 * languages named by the browser (`Intl.DisplayNames`) instead of iD's language list.
 */
import type { Tags } from "#lib/osm/tags.ts";
import type { TagPatch } from "./combo.ts";
import type { Field } from "./presets.ts";

/** `name:fr`, `name:zh-Hant`: a key and a BCP 47 language (iD's `LANGUAGE_SUFFIX_REGEX`). */
const LANGUAGE_SUFFIX =
	/^(.*):([a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?(?:-[a-z][a-z0-9]{4,7}|-[0-9][a-z0-9]{3})?)$/;

export interface Translation {
	readonly lang: string;
	readonly value: string;
}

/** The field's key in other languages, in the tags' order. */
export function translations(field: Field, tags: Tags): Translation[] {
	const result: Translation[] = [];
	for (const [key, value] of Object.entries(tags)) {
		const match = key.match(LANGUAGE_SUFFIX);
		if (match && match[1] === field.key && match[2]) {
			result.push({ lang: match[2], value });
		}
	}
	return result;
}

/** Tags for a translation typed in `lang` (it was in `oldLang`); an empty value removes it. */
export function translationPatch(
	field: Field,
	oldLang: string | undefined,
	lang: string,
	value: string,
): TagPatch {
	const patch: TagPatch = {};
	if (oldLang && oldLang !== lang) patch[`${field.key}:${oldLang}`] = undefined;
	if (lang) patch[`${field.key}:${lang}`] = value || undefined;
	return patch;
}

/** ISO 639-1 languages, and the scripts and variants OSM names use most. */
const CODES =
	"aa ab af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu ast be-tarask ckb fil haw hsb nds sr-Latn yue zh-Hans zh-Hant";

const englishNames = new Intl.DisplayNames(["en"], { type: "language" });

/** A language's English name, or its code when unknown. */
export function languageName(code: string): string {
	try {
		return englishNames.of(code) ?? code;
	} catch {
		return code;
	}
}

/** A language's name in itself (Deutsch), when known. */
function nativeName(code: string): string | undefined {
	try {
		const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
		return name && name !== code ? name : undefined;
	} catch {
		return undefined;
	}
}

export interface LanguageOption {
	readonly code: string;
	/** English name. */
	readonly label: string;
	readonly native?: string;
}

let options: LanguageOption[] | undefined;

/** Languages to choose from, by English name. */
export function languageOptions(): readonly LanguageOption[] {
	options ??= CODES.split(" ")
		.map((code) => {
			const native = nativeName(code);
			return {
				code,
				label: languageName(code),
				...(native && native !== languageName(code) ? { native } : {}),
			};
		})
		.filter((l) => l.label !== l.code)
		.sort((a, b) => a.label.localeCompare(b.label));
	return options;
}

/** The code for a language typed by name, own name or code; anything else in lowercase. */
export function languageCode(typed: string): string {
	const text = typed.trim().toLowerCase();
	const found = languageOptions().find(
		(l) =>
			l.label.toLowerCase() === text ||
			l.native?.toLowerCase() === text ||
			l.code.toLowerCase() === text,
	);
	return found ? found.code : text;
}
