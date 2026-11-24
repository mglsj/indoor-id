/**
 * Checks a translation (`messages/{locale}.json`) against the English messages (P6): the
 * same keys, the same `{param}`s. Paraglide compiles a message it can't read into nothing, and
 * a param English doesn't give into an empty gap, so the unit test runs this on every file.
 * Plural forms are variants, as in `en.json` (`declarations`, `selectors`, `match`). Pure.
 */

type Value = unknown;

/** The texts of a message: itself, or each branch of its variants. */
function textsOf(value: Value): string[] | null {
	if (typeof value === "string") return [value];
	if (!Array.isArray(value)) return null;
	const texts: string[] = [];
	for (const variant of value) {
		const match = (variant as { match?: unknown } | null)?.match;
		if (typeof match !== "object" || match === null) return null;
		for (const text of Object.values(match)) {
			if (typeof text !== "string") return null;
			texts.push(text);
		}
	}
	return texts;
}

/** The `{param}` names in a message's texts. */
function paramsOf(texts: readonly string[]): Set<string> {
	return new Set(
		texts.flatMap((text) =>
			[...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ""),
		),
	);
}

/** What is wrong with a translation, against the English messages; empty when it is fine. */
export function checkTranslation(
	english: Readonly<Record<string, Value>>,
	translation: Readonly<Record<string, Value>>,
): string[] {
	const problems: string[] = [];
	for (const [key, value] of Object.entries(translation)) {
		if (key === "$schema") continue;
		if (!(key in english)) {
			problems.push(`${key}: no such message in English`);
			continue;
		}
		const texts = textsOf(value);
		if (texts === null) {
			problems.push(`${key}: not text or variants`);
			continue;
		}
		const given = paramsOf(textsOf(english[key]) ?? []);
		for (const param of paramsOf(texts)) {
			if (!given.has(param)) problems.push(`${key}: unknown {${param}}`);
		}
	}
	return problems;
}
