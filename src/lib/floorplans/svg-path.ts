/**
 * The parts of SVG that vector plans need, without a browser: path data (every command,
 * absolute and relative, arcs as Béziers), transform lists, basic shapes as path data, and the
 * styles that decide what is painted (presentation attributes and the `style` attribute,
 * inherited). Stylesheets (`<style>`, classes) aren't read. Pure.
 */
import type { VectorBuilder } from "./vector.ts";

/** `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** A path command, absolute and untransformed. */
export type PathCommand =
	| { readonly c: "M" | "L"; readonly x: number; readonly y: number }
	| {
			readonly c: "C";
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
			readonly x: number;
			readonly y: number;
	  }
	| {
			readonly c: "Q";
			readonly x1: number;
			readonly y1: number;
			readonly x: number;
			readonly y: number;
	  }
	| { readonly c: "Z" };

/** `m` applied after `n`. */
export function multiply(m: Matrix, n: Matrix): Matrix {
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5],
	];
}

/** Reads path data; a mistake ends the path where it is, as browsers do. */
export function parsePathData(d: string): PathCommand[] {
	const commands: PathCommand[] = [];
	let i = 0;
	const space = () => {
		while (i < d.length && /[\s,]/.test(d[i] ?? "")) i++;
	};
	const number = (): number | null => {
		space();
		const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
		if (!match) return null;
		i += match[0].length;
		return Number(match[0]);
	};
	const flag = (): number | null => {
		space();
		const f = d[i];
		if (f !== "0" && f !== "1") return null;
		i++;
		return Number(f);
	};
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	/** The last curve's second control point, for smooth curves. */
	let lastCubic: [number, number] | null = null;
	let lastQuad: [number, number] | null = null;
	let command = "";
	while (true) {
		space();
		if (i >= d.length) break;
		const letter = d[i] ?? "";
		if (/[a-zA-Z]/.test(letter)) {
			command = letter;
			i++;
		} else if (!command || command === "z" || command === "Z") {
			break;
		}
		const relative = command === command.toLowerCase();
		const ox = relative ? x : 0;
		const oy = relative ? y : 0;
		const upper = command.toUpperCase();
		const read = (count: number): number[] | null => {
			const values: number[] = [];
			for (let k = 0; k < count; k++) {
				const v = number();
				if (v === null) return null;
				values.push(v);
			}
			return values;
		};
		let cubic: [number, number] | null = null;
		let quad: [number, number] | null = null;
		if (upper === "Z") {
			commands.push({ c: "Z" });
			x = startX;
			y = startY;
		} else if (upper === "M" || upper === "L") {
			const v = read(2);
			if (!v) break;
			x = ox + (v[0] ?? 0);
			y = oy + (v[1] ?? 0);
			commands.push({ c: upper, x, y });
			if (upper === "M") {
				startX = x;
				startY = y;
				// Further pairs after a move are lines.
				command = relative ? "l" : "L";
			}
		} else if (upper === "H" || upper === "V") {
			const v = read(1);
			if (!v) break;
			if (upper === "H") x = ox + (v[0] ?? 0);
			else y = oy + (v[0] ?? 0);
			commands.push({ c: "L", x, y });
		} else if (upper === "C" || upper === "S") {
			const v = read(upper === "C" ? 6 : 4);
			if (!v) break;
			const [x1, y1]: [number, number] =
				upper === "C"
					? [ox + (v[0] ?? 0), oy + (v[1] ?? 0)]
					: lastCubic
						? [2 * x - lastCubic[0], 2 * y - lastCubic[1]]
						: [x, y];
			const k = upper === "C" ? 2 : 0;
			const x2 = ox + (v[k] ?? 0);
			const y2 = oy + (v[k + 1] ?? 0);
			x = ox + (v[k + 2] ?? 0);
			y = oy + (v[k + 3] ?? 0);
			commands.push({ c: "C", x1, y1, x2, y2, x, y });
			cubic = [x2, y2];
		} else if (upper === "Q" || upper === "T") {
			const v = read(upper === "Q" ? 4 : 2);
			if (!v) break;
			let x1 = x;
			let y1 = y;
			if (upper === "Q") {
				x1 = ox + (v[0] ?? 0);
				y1 = oy + (v[1] ?? 0);
			} else if (lastQuad) {
				x1 = 2 * x - lastQuad[0];
				y1 = 2 * y - lastQuad[1];
			}
			const k = upper === "Q" ? 2 : 0;
			x = ox + (v[k] ?? 0);
			y = oy + (v[k + 1] ?? 0);
			commands.push({ c: "Q", x1, y1, x, y });
			quad = [x1, y1];
		} else if (upper === "A") {
			const radii = read(3);
			const large = flag();
			const sweep = flag();
			const end = read(2);
			if (!radii || large === null || sweep === null || !end) break;
			const tx = ox + (end[0] ?? 0);
			const ty = oy + (end[1] ?? 0);
			commands.push(
				...arcToCubics(
					x,
					y,
					radii[0] ?? 0,
					radii[1] ?? 0,
					radii[2] ?? 0,
					large,
					sweep,
					tx,
					ty,
				),
			);
			x = tx;
			y = ty;
		} else {
			break;
		}
		lastCubic = cubic;
		lastQuad = quad;
	}
	return commands;
}

/**
 * An elliptical arc as cubic Béziers of at most 90° each (SVG implementation notes, F.6.5).
 * A zero radius makes a line; radii too small to reach the end are scaled up.
 */
function arcToCubics(
	x0: number,
	y0: number,
	rxIn: number,
	ryIn: number,
	degrees: number,
	large: number,
	sweep: number,
	x: number,
	y: number,
): PathCommand[] {
	if (x0 === x && y0 === y) return [];
	let rx = Math.abs(rxIn);
	let ry = Math.abs(ryIn);
	if (rx === 0 || ry === 0) return [{ c: "L", x, y }];
	const phi = (degrees * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const dx = (x0 - x) / 2;
	const dy = (y0 - y) / 2;
	const x1 = cos * dx + sin * dy;
	const y1 = -sin * dx + cos * dy;
	const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}
	const sign = large === sweep ? -1 : 1;
	const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
	const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
	const k = sign * Math.sqrt(Math.max(0, num / den));
	const cx1 = (k * rx * y1) / ry;
	const cy1 = (-k * ry * x1) / rx;
	const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2;
	const cy = sin * cx1 + cos * cy1 + (y0 + y) / 2;
	const angle = (ux: number, uy: number, vx: number, vy: number) =>
		Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
	const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
	let delta = angle(
		(x1 - cx1) / rx,
		(y1 - cy1) / ry,
		(-x1 - cx1) / rx,
		(-y1 - cy1) / ry,
	);
	if (!sweep && delta > 0) delta -= 2 * Math.PI;
	if (sweep && delta < 0) delta += 2 * Math.PI;
	const n = Math.ceil(Math.abs(delta) / (Math.PI / 2));
	const step = delta / n;
	const t = (4 / 3) * Math.tan(step / 4);
	const point = (a: number): [number, number] => [
		cx + rx * cos * Math.cos(a) - ry * sin * Math.sin(a),
		cy + rx * sin * Math.cos(a) + ry * cos * Math.sin(a),
	];
	const derivative = (a: number): [number, number] => [
		-rx * cos * Math.sin(a) - ry * sin * Math.cos(a),
		-rx * sin * Math.sin(a) + ry * cos * Math.cos(a),
	];
	const result: PathCommand[] = [];
	for (let s = 0; s < n; s++) {
		const a1 = theta + s * step;
		const a2 = a1 + step;
		const [px1, py1] = point(a1);
		const [dx1, dy1] = derivative(a1);
		const [px2, py2] = s === n - 1 ? [x, y] : point(a2);
		const [dx2, dy2] = derivative(a2);
		result.push({
			c: "C",
			x1: px1 + t * dx1,
			y1: py1 + t * dy1,
			x2: px2 - t * dx2,
			y2: py2 - t * dy2,
			x: px2,
			y: py2,
		});
	}
	return result;
}

/** Feeds path commands to a builder, placed by `m`. */
export function applyTo(
	builder: VectorBuilder,
	commands: readonly PathCommand[],
	m: Matrix,
): void {
	const px = (x: number, y: number) => m[0] * x + m[2] * y + m[4];
	const py = (x: number, y: number) => m[1] * x + m[3] * y + m[5];
	for (const cmd of commands) {
		switch (cmd.c) {
			case "M":
				builder.moveTo(px(cmd.x, cmd.y), py(cmd.x, cmd.y));
				break;
			case "L":
				builder.lineTo(px(cmd.x, cmd.y), py(cmd.x, cmd.y));
				break;
			case "C":
				builder.cubicTo(
					px(cmd.x1, cmd.y1),
					py(cmd.x1, cmd.y1),
					px(cmd.x2, cmd.y2),
					py(cmd.x2, cmd.y2),
					px(cmd.x, cmd.y),
					py(cmd.x, cmd.y),
				);
				break;
			case "Q":
				builder.quadTo(
					px(cmd.x1, cmd.y1),
					py(cmd.x1, cmd.y1),
					px(cmd.x, cmd.y),
					py(cmd.x, cmd.y),
				);
				break;
			case "Z":
				builder.close();
				break;
		}
	}
}

/** Reads a transform list; one it can't read counts as no transform. */
export function parseTransform(value: string | null | undefined): Matrix {
	let m = IDENTITY;
	for (const [, name, list] of (value ?? "").matchAll(
		/([a-zA-Z]+)\s*\(([^)]*)\)/g,
	)) {
		const a = (list ?? "")
			.trim()
			.split(/[\s,]+/)
			.filter(Boolean)
			.map(Number);
		if (a.some((v) => !Number.isFinite(v))) return IDENTITY;
		const [p = 0, q, r] = a;
		const rad = (deg: number) => (deg * Math.PI) / 180;
		let t: Matrix;
		switch (name) {
			case "matrix":
				if (a.length !== 6) return IDENTITY;
				t = a as unknown as Matrix;
				break;
			case "translate":
				t = [1, 0, 0, 1, p, q ?? 0];
				break;
			case "scale":
				t = [p, 0, 0, q ?? p, 0, 0];
				break;
			case "rotate": {
				const c = Math.cos(rad(p));
				const s = Math.sin(rad(p));
				const cx = q ?? 0;
				const cy = r ?? 0;
				t = [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
				break;
			}
			case "skewX":
				t = [1, 0, Math.tan(rad(p)), 1, 0, 0];
				break;
			case "skewY":
				t = [1, Math.tan(rad(p)), 0, 1, 0, 0];
				break;
			default:
				return IDENTITY;
		}
		m = multiply(m, t);
	}
	return m;
}

/** A length in user units: px by default; pt, pc, mm, cm and in converted at 96 px an inch. */
export function parseLength(
	value: string | null | undefined,
	fallback = 0,
): number {
	const match =
		/^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/.exec(
			value ?? "",
		);
	if (!match) return fallback;
	const units: Record<string, number> = {
		px: 1,
		pt: 96 / 72,
		pc: 16,
		mm: 96 / 25.4,
		cm: 96 / 2.54,
		in: 96,
	};
	return Number(match[1]) * (units[match[2] ?? "px"] ?? 1);
}

type Attributes = Readonly<Record<string, string | null | undefined>>;

/** A basic shape (`rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`) as path data. */
export function shapePath(tag: string, attrs: Attributes): string {
	const n = (name: string) => parseLength(attrs[name]);
	switch (tag) {
		case "rect": {
			const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
			return w > 0 && h > 0 ? `M${x} ${y}H${x + w}V${y + h}H${x}Z` : "";
		}
		case "circle":
		case "ellipse": {
			const [cx, cy] = [n("cx"), n("cy")];
			const rx = tag === "circle" ? n("r") : n("rx");
			const ry = tag === "circle" ? n("r") : n("ry");
			if (!(rx > 0 && ry > 0)) return "";
			const arc = (x: number, y: number) => `A${rx} ${ry} 0 0 1 ${x} ${y}`;
			return `M${cx + rx} ${cy}${arc(cx, cy + ry)}${arc(cx - rx, cy)}${arc(cx, cy - ry)}${arc(cx + rx, cy)}Z`;
		}
		case "line":
			return `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`;
		case "polyline":
		case "polygon": {
			const values = (attrs.points ?? "")
				.trim()
				.split(/[\s,]+/)
				.filter(Boolean)
				.map(Number);
			if (values.length < 4 || values.some((v) => !Number.isFinite(v)))
				return "";
			const pairs: string[] = [];
			for (let i = 0; i + 1 < values.length; i += 2)
				pairs.push(`${values[i]} ${values[i + 1]}`);
			return `M${pairs.join("L")}${tag === "polygon" ? "Z" : ""}`;
		}
		default:
			return "";
	}
}

/** What decides how an element is painted, inherited from its parents. */
export interface SvgStyle {
	/** A paint: a colour as written, `none`, or `url(…)`. */
	readonly fill: string;
	readonly stroke: string;
	readonly strokeWidth: number;
	/** Group opacity, multiplied down from the parents. */
	readonly opacity: number;
	readonly fillOpacity: number;
	readonly strokeOpacity: number;
	/** The `color` property, which `currentColor` stands for. */
	readonly color: string;
	/** `visibility`, which children may set back to visible. */
	readonly visible: boolean;
	/** Whether a parent or the element has `display: none`. */
	readonly displayed: boolean;
	/** Nothing of it is painted. */
	readonly hidden: boolean;
	/** Text's font size in user units. */
	readonly fontSize: number;
	/** Where text sits from its position: starting there, centred on it, or ending there. */
	readonly textAnchor: TextAnchor;
}

export type TextAnchor = "start" | "middle" | "end";
const ANCHORS = new Set<string>(["start", "middle", "end"]);

export const INITIAL_STYLE: SvgStyle = {
	fill: "black",
	stroke: "none",
	strokeWidth: 1,
	opacity: 1,
	fillOpacity: 1,
	strokeOpacity: 1,
	color: "black",
	visible: true,
	displayed: true,
	hidden: false,
	fontSize: 16,
	textAnchor: "start",
};

/** An element's style: its attributes, overridden by its `style` attribute, over its parent's. */
export function resolveStyle(parent: SvgStyle, attrs: Attributes): SvgStyle {
	const own = new Map<string, string>();
	for (const name of [
		"fill",
		"stroke",
		"stroke-width",
		"opacity",
		"fill-opacity",
		"stroke-opacity",
		"color",
		"display",
		"visibility",
		"font-size",
		"text-anchor",
	]) {
		const value = attrs[name]?.trim();
		if (value) own.set(name, value);
	}
	for (const declaration of (attrs.style ?? "").split(";")) {
		const colon = declaration.indexOf(":");
		if (colon < 0) continue;
		const name = declaration.slice(0, colon).trim().toLowerCase();
		const value = declaration
			.slice(colon + 1)
			.replace(/!important/i, "")
			.trim();
		if (value) own.set(name, value);
	}
	const get = (name: string) => {
		const value = own.get(name);
		return value === "inherit" ? undefined : value;
	};
	const ratio = (name: string, inherited: number) => {
		const value = get(name);
		if (value === undefined) return inherited;
		const n = value.endsWith("%")
			? Number.parseFloat(value) / 100
			: Number(value);
		return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : inherited;
	};
	const color = get("color") ?? parent.color;
	const paint = (name: string, inherited: string) => {
		const value = get(name) ?? inherited;
		return value.toLowerCase() === "currentcolor" ? color : value;
	};
	const visibility = get("visibility");
	const visible =
		visibility === undefined ? parent.visible : visibility === "visible";
	const displayed = parent.displayed && get("display") !== "none";
	const width = get("stroke-width");
	const anchor = get("text-anchor");
	return {
		fill: paint("fill", parent.fill),
		stroke: paint("stroke", parent.stroke),
		strokeWidth:
			width === undefined
				? parent.strokeWidth
				: parseLength(width, parent.strokeWidth),
		opacity: parent.opacity * ratio("opacity", 1),
		fillOpacity: ratio("fill-opacity", parent.fillOpacity),
		strokeOpacity: ratio("stroke-opacity", parent.strokeOpacity),
		color,
		visible,
		displayed,
		hidden: !(visible && displayed),
		fontSize: fontSizeOf(get("font-size"), parent.fontSize),
		textAnchor:
			anchor && ANCHORS.has(anchor)
				? (anchor as TextAnchor)
				: parent.textAnchor,
	};
}

/** A font size: a length, or em and % of the parent's. */
function fontSizeOf(value: string | undefined, parent: number): number {
	if (value === undefined) return parent;
	const relative = /^\s*([\d.]+)\s*(em|%)\s*$/.exec(value);
	if (relative) {
		const n = Number(relative[1]);
		return relative[2] === "em" ? n * parent : (n / 100) * parent;
	}
	const size = parseLength(value, parent);
	return size > 0 ? size : parent;
}
