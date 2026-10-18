/**
 * The corners and line ends of a vector plan, to snap to: each vertex of its segments and
 * filled triangles, in plan units, bucketed in a uniform grid over the plan (typed arrays,
 * built in one pass: a plan has hundreds of thousands of vertices, too many to load quickly
 * into an rbush of objects). A part of the map is turned into plan units through the inverse
 * transform, so moving the plan rebuilds nothing. Pure.
 */
import { type LngLat, project, type Transform, unproject } from "./georef.ts";
import type { Bounds } from "./tiling.ts";
import type { VectorContent } from "./vector.ts";

/** Vertices a grid cell holds on average, at most; the grid is at most 1024 cells a side. */
const PER_CELL = 8;
const MAX_CELLS = 1024;

export class PlanVertices {
	readonly #content: VectorContent;
	/** Cells a side. */
	readonly #side: number;
	/** Each cell's first vertex in the arrays below; the last entry is the vertex count. */
	readonly #starts: Uint32Array;
	readonly #xs: Float32Array;
	readonly #ys: Float32Array;
	/** Each vertex's CAD layer, an index in `VectorContent.layers`, or -1. */
	readonly #layers: Int32Array;

	constructor(content: VectorContent) {
		this.#content = content;
		const { segments, segmentStyles, triangles, triangleStyles, styles } =
			content;
		const count = segmentStyles.length * 2 + triangleStyles.length * 3;
		this.#side = Math.max(
			1,
			Math.min(MAX_CELLS, Math.ceil(Math.sqrt(count / PER_CELL))),
		);
		// Every vertex with its layer, then counted into cells, then placed cell by cell.
		const xs = new Float32Array(count);
		const ys = new Float32Array(count);
		const layers = new Int32Array(count);
		let n = 0;
		for (let i = 0; i < segmentStyles.length; i++) {
			const layer = styles[segmentStyles[i] ?? 0]?.layer ?? -1;
			for (let k = 0; k < 2; k++) {
				xs[n] = segments[4 * i + 2 * k] ?? 0;
				ys[n] = segments[4 * i + 2 * k + 1] ?? 0;
				layers[n++] = layer;
			}
		}
		for (let i = 0; i < triangleStyles.length; i++) {
			const layer = styles[triangleStyles[i] ?? 0]?.layer ?? -1;
			for (let k = 0; k < 3; k++) {
				xs[n] = triangles[6 * i + 2 * k] ?? 0;
				ys[n] = triangles[6 * i + 2 * k + 1] ?? 0;
				layers[n++] = layer;
			}
		}
		const cells = new Uint32Array(count);
		const starts = new Uint32Array(this.#side * this.#side + 1);
		for (let i = 0; i < count; i++) {
			const [c, r] = this.#cellOf(xs[i] ?? 0, ys[i] ?? 0);
			const cell = r * this.#side + c;
			cells[i] = cell;
			starts[cell + 1] = (starts[cell + 1] ?? 0) + 1;
		}
		for (let c = 1; c < starts.length; c++) {
			starts[c] = (starts[c] ?? 0) + (starts[c - 1] ?? 0);
		}
		const next = starts.slice(0, -1);
		this.#xs = new Float32Array(count);
		this.#ys = new Float32Array(count);
		this.#layers = new Int32Array(count);
		for (let i = 0; i < count; i++) {
			const cell = cells[i] ?? 0;
			const at = next[cell] ?? 0;
			next[cell] = at + 1;
			this.#xs[at] = xs[i] ?? 0;
			this.#ys[at] = ys[i] ?? 0;
			this.#layers[at] = layers[i] ?? -1;
		}
		this.#starts = starts;
	}

	/**
	 * The vertices the plan, placed by `transform`, puts within `area`, on the map, each once;
	 * those of the CAD layers in `hidden` (by id) left out.
	 */
	near(
		transform: Transform,
		area: Bounds,
		hidden: ReadonlySet<string> = new Set(),
	): LngLat[] {
		const corners = [
			unproject(transform, [area.west, area.north]),
			unproject(transform, [area.east, area.north]),
			unproject(transform, [area.east, area.south]),
			unproject(transform, [area.west, area.south]),
		];
		const xs = corners.map(([x]) => x);
		const ys = corners.map(([, y]) => y);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		// Cells clamp to the grid: vertices off the page sit in its edge cells.
		const [c0, r0] = this.#cellOf(minX, minY);
		const [c1, r1] = this.#cellOf(maxX, maxY);
		const layers = this.#content.layers;
		const seen = new Set<string>();
		const found: LngLat[] = [];
		for (let r = r0; r <= r1; r++) {
			for (let c = c0; c <= c1; c++) {
				const cell = r * this.#side + c;
				const end = this.#starts[cell + 1] ?? 0;
				for (let i = this.#starts[cell] ?? 0; i < end; i++) {
					const x = this.#xs[i] ?? 0;
					const y = this.#ys[i] ?? 0;
					if (x < minX || x > maxX || y < minY || y > maxY) continue;
					const layer = this.#layers[i] ?? -1;
					if (layer >= 0 && hidden.has(layers[layer]?.id ?? "")) continue;
					// Shared vertices are stored once for each segment or triangle: given once.
					const key = `${x},${y}`;
					if (seen.has(key)) continue;
					seen.add(key);
					const position = project(transform, [x, y]);
					const [lon, lat] = position;
					if (
						lon >= area.west &&
						lon <= area.east &&
						lat >= area.south &&
						lat <= area.north
					) {
						found.push(position);
					}
				}
			}
		}
		return found;
	}

	/** The grid cell holding a point, as column and row; points off the plan in edge cells. */
	#cellOf(x: number, y: number): [number, number] {
		const { width, height } = this.#content.size;
		const side = this.#side;
		const clamp = (v: number) => Math.max(0, Math.min(side - 1, Math.floor(v)));
		return [clamp((x / width) * side), clamp((y / height) * side)];
	}
}
