/**
 * Values of iD's text-like fields (`ui/fields/input.js`, `textarea.js`): cleaning what is typed,
 * fields with several keys, numbers within bounds and their steppers, and outside links.
 */
import type { Tags } from "#lib/osm/tags.ts";
import type { TagPatch } from "./combo.ts";
import type { Field } from "./presets.ts";

/** Longest tag value OSM takes, in characters. */
export const MAX_CHARS = 255;

/** Characters (code points), as OSM counts them. */
export function charCount(value: string): number {
	return Array.from(value).length;
}

/** A value as stored: trimmed, in Unicode's canonical form, at most 255 characters. */
export function cleanValue(value: string): string {
	return Array.from(value.trim().normalize("NFC")).slice(0, MAX_CHARS).join("");
}

/**
 * The field's value: one of its keys set (`phone` or `contact:phone`), or mixed when they
 * differ, or when the features edited (`mixed`, see `combineTags`) have different values.
 */
export function textValue(
	field: Field,
	tags: Tags,
	mixed?: ReadonlyMap<string, unknown>,
): { value: string; mixed: boolean } {
	const keys = field.keys ?? (field.key ? [field.key] : []);
	if (keys.some((key) => mixed?.has(key))) return { value: "", mixed: true };
	const values = new Set(
		keys.map((key) => tags[key]).filter((v): v is string => v !== undefined),
	);
	if (values.size > 1) return { value: "", mixed: true };
	return { value: [...values][0] ?? "", mixed: false };
}

/** Tags for a new value: written to the keys already set, else to the field's key (as iD). */
export function textPatch(field: Field, tags: Tags, value: string): TagPatch {
	const set = (field.keys ?? []).filter((key) => tags[key] !== undefined);
	const keys = set.length > 0 ? set : field.key ? [field.key] : [];
	return Object.fromEntries(keys.map((key) => [key, value || undefined]));
}

/** iD's compass points, for direction fields. */
const CARDINAL: Record<string, number> = {
	north: 0,
	n: 0,
	northnortheast: 22,
	nne: 22,
	northeast: 45,
	ne: 45,
	eastnortheast: 67,
	ene: 67,
	east: 90,
	e: 90,
	eastsoutheast: 112,
	ese: 112,
	southeast: 135,
	se: 135,
	southsoutheast: 157,
	sse: 157,
	south: 180,
	s: 180,
	southsouthwest: 202,
	ssw: 202,
	southwest: 225,
	sw: 225,
	westsouthwest: 247,
	wsw: 247,
	west: 270,
	w: 270,
	westnorthwest: 292,
	wnw: 292,
	northwest: 315,
	nw: 315,
	northnorthwest: 337,
	nnw: 337,
};

const isDirection = (field: Field) =>
	(field.key ?? "").split(":").includes("direction");

/** A plain number (`-1.50`), with its decimals; undefined for anything else. */
function parseNumber(
	text: string,
): { num: number; digits: number } | undefined {
	const v = text.trim();
	if (!/^-?(\d+\.?\d*|\.\d+)$/.test(v)) return undefined;
	return {
		num: Number(v),
		digits: v.includes(".") ? (v.split(".")[1]?.length ?? 0) : 0,
	};
}

function clamp(field: Field, num: number): number {
	let result = num;
	if (field.minValue !== undefined) result = Math.max(result, field.minValue);
	if (field.maxValue !== undefined) result = Math.min(result, field.maxValue);
	return result;
}

/** A number field's value as typed: each number of a `;` list within bounds, the rest as is. */
export function numberValue(field: Field, typed: string): string {
	if (!typed) return typed;
	return typed
		.split(";")
		.map((part) => {
			const parsed = parseNumber(part);
			return parsed ? clamp(field, parsed.num).toFixed(parsed.digits) : part;
		})
		.join(";");
}

/** The value after a − or + click: each number moved by `step` (an empty value counts as 0). */
export function stepNumber(
	field: Field,
	current: string | undefined,
	step: number,
): string {
	return (current || "0")
		.split(";")
		.map((part) => {
			const compass = isDirection(field)
				? CARDINAL[part.trim().toLowerCase()]
				: undefined;
			const parsed =
				compass !== undefined ? { num: compass, digits: 0 } : parseNumber(part);
			if (!parsed) return part;
			let num = parsed.num + step;
			if (isDirection(field)) num = ((num % 360) + 360) % 360;
			return clamp(field, num).toFixed(parsed.digits);
		})
		.join(";");
}

/** Whether the steppers can change the value: it has a number (or nothing). */
export function canStep(field: Field, current: string | undefined): boolean {
	return (current || "0")
		.split(";")
		.some(
			(part) =>
				parseNumber(part) !== undefined ||
				(isDirection(field) && part.trim().toLowerCase() in CARDINAL),
		);
}

const isWebLink = (value: string) => {
	try {
		return new URL(value).protocol.startsWith("http");
	} catch {
		return false;
	}
};

/** Where the field's link button goes: the website, the identifier's page, or YoHours. */
export function externalLink(field: Field, value: string): string | null {
	const v = value.trim();
	if (field.type === "schedule") {
		return `https://projets.pavie.info/yohours/?oh=${encodeURIComponent(v)}`;
	}
	if (!v) return null;
	if (field.type === "url") return isWebLink(v) ? v : null;
	if (field.type === "identifier" && field.pattern && field.urlFormat) {
		if (isWebLink(v)) return v;
		const id = v.match(new RegExp(field.pattern))?.[0];
		return id
			? field.urlFormat.replace("{value}", encodeURIComponent(id))
			: null;
	}
	return null;
}

/** A date the date picker can show: `2024`, `2024-03` or `2024-03-15`. */
export function isDateLike(value: string): boolean {
	return /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/.test(value);
}
