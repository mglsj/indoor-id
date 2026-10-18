/**
 * The raw tag editor's text form, as iD's: one `key=value` per line, a key or value quoted as
 * JSON when it holds `=` or characters JSON escapes.
 */
import type { Tags } from "./tags.ts";

function stringify(text: string): string {
	const escaped = JSON.stringify(text).slice(1, -1);
	return escaped !== text || text.includes("=") ? `"${escaped}"` : text;
}

function unstringify(text: string): string {
	if (text.length > 1 && text.startsWith('"') && text.endsWith('"')) {
		try {
			return JSON.parse(text) as string;
		} catch {
			return text;
		}
	}
	return text;
}

/** The tags as text: in `order` (the rows shown), then the other keys sorted. */
export function formatTagText(
	tags: Tags,
	order: readonly string[] = [],
): string {
	const keys = [
		...order.filter((key) => tags[key] !== undefined),
		...Object.keys(tags)
			.filter((key) => !order.includes(key))
			.sort(),
	];
	return keys
		.map((key) => {
			const value = tags[key] as string;
			return `${stringify(key)}=${value ? stringify(value) : ""}`;
		})
		.join("\n");
}

/** Reads `key=value` lines; `key=` gives an empty value, lines without a key are skipped. */
export function parseTagText(text: string): Tags {
	const tags: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const m = line.match(/^\s*([^=]+)=(.*)$/);
		if (!m) continue;
		const key = unstringify((m[1] as string).trim());
		if (key) tags[key] = unstringify((m[2] as string).trim());
	}
	return tags;
}
