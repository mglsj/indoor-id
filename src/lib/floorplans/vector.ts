/**
 * Vector floor plans: the stroked and filled paths of a PDF page or an SVG drawing, flattened
 * into line segments and triangles in plan units (PDF points, SVG user units, y down), ready
 * for the GPU. `VectorBuilder` takes paths already placed in plan units and paints them; the
 * PDF and SVG readers (`vector-pdf.ts`, `vector-svg.ts`) walk their files into it. Pure.
 */
import earcut from "earcut";
import type { PlanSize } from "./content.ts";

/** Curves are cut into segments straying at most this far from them, in plan units. */
export const FLATNESS = 0.1;

/** Red, green, blue and alpha, 0 to 255. */
export type Rgba = readonly [number, number, number, number];

export interface VectorStyle {
	readonly color: Rgba;
	/** Line width in plan units; 0 for a hairline (one device pixel at any zoom). */
	readonly width: number;
	/** Index in `VectorContent.layers`, or -1 outside any layer. */
	readonly layer: number;
}

/** A CAD layer (a PDF's optional content group). */
export interface VectorLayer {
	readonly id: string;
	readonly name: string;
	/** Whether the file shows it at first. */
	readonly visible: boolean;
}

export interface VectorContent {
	readonly size: PlanSize;
	/** Stroked line segments: x0, y0, x1, y1 each. */
	readonly segments: Float32Array;
	/** Each segment's style, an index in `styles`. */
	readonly segmentStyles: Uint32Array;
	/** Filled triangles: three x, y vertices each. Drawn under the segments. */
	readonly triangles: Float32Array;
	/** Each triangle's style. */
	readonly triangleStyles: Uint32Array;
	readonly styles: readonly VectorStyle[];
	/** Text, drawn as map labels. */
	readonly texts: readonly VectorText[];
	/** The layers used, in the file's order. */
	readonly layers: readonly VectorLayer[];
}

/** A line of text in plan units. */
export interface VectorText {
	readonly text: string;
	/** The middle of the text: halfway along its line, half a capital's height up. */
	readonly x: number;
	readonly y: number;
	/** The font size (an em). */
	readonly size: number;
	/** The way it reads, in degrees clockwise from the plan's x axis (y runs down). */
	readonly angle: number;
	/** Index in `VectorContent.layers`, or -1 outside any layer. */
	readonly layer: number;
}

/** Text while building: its layer still named by id. */
export type PaintText = Omit<VectorText, "layer"> & {
	readonly layer: string | null;
};

/** A style while building: its layer still named by id. */
export interface PaintStyle {
	readonly color: Rgba;
	readonly width: number;
	readonly layer: string | null;
}

/** Collects paths, then paints them as segments or triangles. */
export class VectorBuilder {
	readonly #segments: number[] = [];
	readonly #segmentStyles: number[] = [];
	readonly #triangles: number[] = [];
	readonly #triangleStyles: number[] = [];
	readonly #styles: PaintStyle[] = [];
	readonly #styleIndex = new Map<string, number>();
	readonly #texts: PaintText[] = [];
	/** The path being built: its subpaths as flat x, y lists, each with whether it closed. */
	#rings: { points: number[]; closed: boolean }[] = [];
	#x = 0;
	#y = 0;

	moveTo(x: number, y: number): void {
		this.#rings.push({ points: [x, y], closed: false });
		this.#x = x;
		this.#y = y;
	}

	lineTo(x: number, y: number): void {
		const ring = this.#rings.at(-1);
		if (ring) ring.points.push(x, y);
		else this.#rings.push({ points: [x, y], closed: false });
		this.#x = x;
		this.#y = y;
	}

	/** A cubic Bézier from the current point, cut by Wang's formula to stay within FLATNESS. */
	cubicTo(
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		x: number,
		y: number,
	): void {
		const x0 = this.#x;
		const y0 = this.#y;
		const d = Math.max(
			Math.hypot(x0 - 2 * x1 + x2, y0 - 2 * y1 + y2),
			Math.hypot(x1 - 2 * x2 + x, y1 - 2 * y2 + y),
		);
		const n = pieces(Math.sqrt((0.75 * d) / FLATNESS));
		for (let i = 1; i <= n; i++) {
			const t = i / n;
			const u = 1 - t;
			const a = u * u * u;
			const b = 3 * u * u * t;
			const c = 3 * u * t * t;
			const e = t * t * t;
			this.lineTo(
				a * x0 + b * x1 + c * x2 + e * x,
				a * y0 + b * y1 + c * y2 + e * y,
			);
		}
	}

	/** A quadratic Bézier from the current point. */
	quadTo(x1: number, y1: number, x: number, y: number): void {
		const x0 = this.#x;
		const y0 = this.#y;
		const d = Math.hypot(x0 - 2 * x1 + x, y0 - 2 * y1 + y);
		const n = pieces(Math.sqrt((0.25 * d) / FLATNESS));
		for (let i = 1; i <= n; i++) {
			const t = i / n;
			const u = 1 - t;
			this.lineTo(
				u * u * x0 + 2 * u * t * x1 + t * t * x,
				u * u * y0 + 2 * u * t * y1 + t * t * y,
			);
		}
	}

	/** Closes the current subpath back to its start. */
	close(): void {
		const ring = this.#rings.at(-1);
		if (!ring) return;
		ring.closed = true;
		const [x = 0, y = 0] = ring.points;
		this.#x = x;
		this.#y = y;
	}

	/** Strokes the path built so far (it stays, to be filled too). */
	stroke(style: PaintStyle): void {
		const index = this.#style(style);
		for (const { points, closed } of this.#rings) {
			const n = points.length;
			for (let i = 2; i < n; i += 2) {
				this.#segment(
					points[i - 2],
					points[i - 1],
					points[i],
					points[i + 1],
					index,
				);
			}
			if (closed && n >= 4) {
				this.#segment(
					points[n - 2],
					points[n - 1],
					points[0],
					points[1],
					index,
				);
			}
		}
	}

	/**
	 * Fills the path built so far. Rings inside an odd number of others are holes (the even-odd
	 * rule, which plans' non-zero fills match in practice).
	 */
	fill(style: PaintStyle): void {
		const index = this.#style(style);
		const rings = this.#rings
			.map((r) => r.points)
			.filter((p) => p.length >= 6 && area(p) !== 0);
		for (const { outer, holes } of nest(rings)) {
			const flat = [...outer];
			const starts: number[] = [];
			for (const hole of holes) {
				starts.push(flat.length / 2);
				for (const v of hole) flat.push(v);
			}
			const corners = earcut(flat, starts);
			for (let i = 0; i < corners.length; i += 3) {
				for (let k = 0; k < 3; k++) {
					const v = corners[i + k] ?? 0;
					this.#triangles.push(flat[2 * v] ?? 0, flat[2 * v + 1] ?? 0);
				}
				this.#triangleStyles.push(index);
			}
		}
	}

	/** Adds a line of text. */
	text(text: PaintText): void {
		this.#texts.push(text);
	}

	/** Drops the path built so far, painted or not. */
	clear(): void {
		this.#rings = [];
	}

	/**
	 * The content painted, measured `size`; `layers` lists the file's layers in order, of which
	 * those used are kept.
	 */
	build(
		size: PlanSize,
		layers: ReadonlyMap<string, { name: string; visible: boolean }> = new Map(),
	): VectorContent {
		const order = [...layers.keys()];
		const used = [
			...new Set(
				[...this.#styles, ...this.#texts].flatMap((s) =>
					s.layer === null ? [] : [s.layer],
				),
			),
		].sort((a, b) => rank(order, a) - rank(order, b));
		const index = (layer: string | null) =>
			layer === null ? -1 : used.indexOf(layer);
		return {
			size,
			segments: new Float32Array(this.#segments),
			segmentStyles: new Uint32Array(this.#segmentStyles),
			triangles: new Float32Array(this.#triangles),
			triangleStyles: new Uint32Array(this.#triangleStyles),
			styles: this.#styles.map(({ color, width, layer }) => ({
				color,
				width,
				layer: index(layer),
			})),
			texts: this.#texts.map((t) => ({ ...t, layer: index(t.layer) })),
			layers: used.map((id) => ({
				id,
				name: layers.get(id)?.name ?? id,
				visible: layers.get(id)?.visible ?? true,
			})),
		};
	}

	#segment(x0 = 0, y0 = 0, x1 = 0, y1 = 0, style: number): void {
		if (x0 === x1 && y0 === y1) return;
		this.#segments.push(x0, y0, x1, y1);
		this.#segmentStyles.push(style);
	}

	#style(style: PaintStyle): number {
		const key = `${style.color.join(",")}|${style.width}|${style.layer}`;
		let index = this.#styleIndex.get(key);
		if (index === undefined) {
			index = this.#styles.length;
			this.#styles.push(style);
			this.#styleIndex.set(key, index);
		}
		return index;
	}
}

/** Pieces a curve is cut into: at least 1, at most 100. */
function pieces(n: number): number {
	return Math.max(1, Math.min(100, Math.ceil(n)));
}

function rank(order: readonly string[], id: string): number {
	const i = order.indexOf(id);
	return i < 0 ? order.length : i;
}

/** Signed area of a ring (shoelace). */
function area(ring: readonly number[]): number {
	let sum = 0;
	const n = ring.length;
	for (let i = 0; i < n; i += 2) {
		const j = (i + 2) % n;
		sum +=
			(ring[i] ?? 0) * (ring[j + 1] ?? 0) - (ring[j] ?? 0) * (ring[i + 1] ?? 0);
	}
	return sum / 2;
}

function contains(ring: readonly number[], x: number, y: number): boolean {
	let inside = false;
	const n = ring.length;
	for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
		const xi = ring[i] ?? 0;
		const yi = ring[i + 1] ?? 0;
		const xj = ring[j] ?? 0;
		const yj = ring[j + 1] ?? 0;
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

/** Above this many rings, a path's rings are filled each on its own: nesting is quadratic. */
const MAX_NESTED = 200;

/** Groups rings into polygons: each outer ring with the holes directly inside it. */
function nest(rings: number[][]): { outer: number[]; holes: number[][] }[] {
	if (rings.length > MAX_NESTED)
		return rings.map((outer) => ({ outer, holes: [] }));
	const sorted = [...rings].sort(
		(a, b) => Math.abs(area(b)) - Math.abs(area(a)),
	);
	const depth: number[] = [];
	const parent: number[] = [];
	sorted.forEach((ring, i) => {
		const [x = 0, y = 0] = ring;
		let p = -1;
		// The smallest larger ring around it: the last one found going down by size.
		for (let k = 0; k < i; k++) {
			if (contains(sorted[k] ?? [], x, y)) p = k;
		}
		parent[i] = p;
		depth[i] = p < 0 ? 0 : (depth[p] ?? 0) + 1;
	});
	const polygons = new Map<number, { outer: number[]; holes: number[][] }>();
	sorted.forEach((ring, i) => {
		if ((depth[i] ?? 0) % 2 === 0) polygons.set(i, { outer: ring, holes: [] });
	});
	sorted.forEach((ring, i) => {
		if ((depth[i] ?? 0) % 2 === 1)
			polygons.get(parent[i] ?? -1)?.holes.push(ring);
	});
	return [...polygons.values()];
}

/** `#rrggbb` as RGBA, at `alpha` (0 to 1). */
export function rgba(hex: string, alpha = 1): Rgba {
	const value = Number.parseInt(hex.slice(1, 7), 16);
	const ok = /^#[0-9a-f]{6}$/i.test(hex);
	return [
		ok ? (value >> 16) & 255 : 0,
		ok ? (value >> 8) & 255 : 0,
		ok ? value & 255 : 0,
		Math.round(Math.max(0, Math.min(1, alpha)) * 255),
	];
}
