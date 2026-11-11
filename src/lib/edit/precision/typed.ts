/**
 * Values typed while drawing (C.2), SketchUp's measurements box without a field to click:
 * after the first corner, digits and unit characters go to a small input at the pointer;
 * Tab moves to an angle; Enter places the next corner. What can be typed:
 *
 * - a length, `3.2`, `320 cm`, `12'6"` (in the units setting when bare);
 * - `@dx,dy` or `dx;dy`: an offset along the frame's axes (CAD's relative coordinates), or a
 *   rectangle's width and depth.
 */
import type { Loc } from "#lib/osm/entity.ts";
import { fromLocal } from "#lib/osm/geometry.ts";
import { parseLength, type Units } from "#lib/units/length.ts";
import { bearingOf, type Frame, fromFrame, normalizeAngle } from "./frame.ts";

export type TypedValue =
	| { readonly kind: "length"; readonly metres: number }
	| { readonly kind: "pair"; readonly x: number; readonly y: number };

/** What the typed text says, or null while it doesn't read as a value. */
export function parseTyped(text: string, units: Units): TypedValue | null {
	let rest = text.trim();
	const at = rest.startsWith("@");
	if (at) rest = rest.slice(1);
	const separator = rest.includes(";") ? ";" : at ? "," : null;
	if (separator) {
		const parts = rest.split(separator);
		if (parts.length !== 2) return null;
		const x = parseLength(parts[0] ?? "", units);
		const y = parseLength(parts[1] ?? "", units);
		return x === null || y === null ? null : { kind: "pair", x, y };
	}
	if (at) return null;
	const metres = parseLength(rest, units);
	return metres === null ? null : { kind: "length", metres };
}

/** Degrees typed in the angle field (`90`, `22.5°`, `-45`), or null. */
export function parseAngle(text: string): number | null {
	const match = /^\s*(-?\d+(?:[.,]\d+)?)\s*°?\s*$/.exec(text);
	return match ? Number((match[1] ?? "").replace(",", ".")) : null;
}

/** Characters a value can start with. */
const FIRST = /^[\d.,@-]$/;
/** Characters that may follow (unit letters, feet and inches marks, separators). */
const NEXT = /^[\d.,@;'"′″ /a-zA-Z-]$/;

export type TypedField = "length" | "angle";

/** The typed text, the angle, and which one keys go to. */
export interface TypedInput {
	readonly length: string;
	readonly angle: string;
	readonly field: TypedField;
}

export const EMPTY_INPUT: TypedInput = {
	length: "",
	angle: "",
	field: "length",
};

/** Whether anything was typed. */
export function isTyping(input: TypedInput): boolean {
	return input.length !== "" || input.angle !== "";
}

/**
 * The input after a key, or null when the key isn't for it (a shortcut, Enter, Escape).
 * `angles`: whether Tab may move to an angle field.
 */
export function typeKey(
	input: TypedInput,
	event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
	angles = true,
): TypedInput | null {
	if (event.ctrlKey || event.metaKey || event.altKey) return null;
	const typing = isTyping(input);
	if (event.key === "Tab") {
		if (!typing || !angles) return null;
		return { ...input, field: input.field === "length" ? "angle" : "length" };
	}
	if (event.key === "Backspace") {
		if (!typing) return null;
		const text = input[input.field];
		if (text === "" && input.field === "angle")
			return { ...input, field: "length" };
		return { ...input, [input.field]: text.slice(0, -1) };
	}
	if (event.key.length !== 1) return null;
	const text = input[input.field];
	const allowed =
		input.field === "angle"
			? /^[\d.,°-]$/.test(event.key)
			: (text === "" ? FIRST : NEXT).test(event.key);
	if (!allowed) return null;
	// A first letter (a shortcut) never starts a value.
	if (!typing && !FIRST.test(event.key)) return null;
	return { ...input, [input.field]: text + event.key };
}

export interface TypedCorner {
	readonly value: TypedValue;
	/** Degrees typed in the angle field, if any. */
	readonly angle?: number | null;
	/** The corner the new side starts from. */
	readonly from: Loc;
	/** The corner before it: a typed angle is then the angle between the two sides. */
	readonly previous?: Loc;
	readonly frame: Frame;
	/** Where the side points now (the snapped pointer, or a point on the locked direction). */
	readonly toward: Loc;
}

/**
 * Where a typed value puts the next corner: a length along the side's direction now (or at
 * the typed angle, on the pointer's side of the previous side), or an offset along the
 * frame's axes.
 */
export function typedCorner({
	value,
	angle,
	from,
	previous,
	frame,
	toward,
}: TypedCorner): Loc {
	if (value.kind === "pair") {
		return fromFrame({ origin: from, angle: frame.angle }, [value.x, value.y]);
	}
	const pointing =
		toward[0] === from[0] && toward[1] === from[1]
			? frame.angle
			: bearingOf(from, toward);
	let direction = pointing;
	if (angle !== null && angle !== undefined) {
		if (previous) {
			const back = bearingOf(from, previous);
			const left = back + angle;
			const right = back - angle;
			direction =
				Math.abs(normalizeAngle(left - pointing)) <=
				Math.abs(normalizeAngle(right - pointing))
					? left
					: right;
		} else direction = frame.angle + angle;
	}
	const r = (direction * Math.PI) / 180;
	return fromLocal(from, [
		value.metres * Math.cos(r),
		value.metres * Math.sin(r),
	]);
}
