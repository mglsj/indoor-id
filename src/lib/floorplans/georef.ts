/**
 * Georeferencing of floor plans: transforms from image pixels to the map, fitted to control
 * points. The maths happens in Web Mercator (EPSG:3857) metres, the projection the map is drawn
 * in, so that a plan's straight lines stay straight on screen. Distances shown to the user
 * (residuals, known distances) are true ground metres: Mercator metres × cos(latitude).
 *
 * Image pixels are `[u, v]` with `v` pointing down, as in the image file.
 */
import { fromMercator, toMercator } from "#lib/osm/geometry.ts";

/** `[longitude, latitude]` in degrees, as MapLibre takes them. */
export type LngLat = [number, number];
/** Pixel position in the image, `v` downwards. */
export type Pixel = [number, number];

export interface ControlPoint {
	readonly image: Pixel;
	readonly map: LngLat;
}

export type TransformKind = "similarity" | "affine" | "projective";

/** 3×3 matrix, row-major, from `[u, v, 1]` to homogeneous Mercator `[x, y, w]`. */
type Matrix = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

export interface Transform {
	readonly kind: TransformKind;
	readonly matrix: Matrix;
}

export interface Fit {
	readonly transform: Transform;
	/** For each control point, how far the plan puts it from its map position, in metres. */
	readonly residuals: number[];
	/** Root mean square of the residuals, in metres. */
	readonly rms: number;
}

export class GeorefError extends Error {
	override name = "GeorefError";
}

/** The map position of an image pixel. */
export function project(transform: Transform, [u, v]: Pixel): LngLat {
	const m = transform.matrix;
	const w = m[6] * u + m[7] * v + m[8];
	return fromMercator([
		(m[0] * u + m[1] * v + m[2]) / w,
		(m[3] * u + m[4] * v + m[5]) / w,
	]);
}

/** The image pixel at a map position (the plan may not cover it). */
export function unproject(transform: Transform, position: LngLat): Pixel {
	const [x, y] = toMercator(position);
	const m = invert(transform.matrix);
	const w = m[6] * x + m[7] * y + m[8];
	return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/**
 * Map positions of the image corners, clockwise from the top left: the `coordinates` of a
 * MapLibre image source.
 */
export function corners(
	transform: Transform,
	width: number,
	height: number,
): [LngLat, LngLat, LngLat, LngLat] {
	return [
		project(transform, [0, 0]),
		project(transform, [width, 0]),
		project(transform, [width, height]),
		project(transform, [0, height]),
	];
}

export interface Placement {
	/** Where the image centre goes. */
	readonly center: LngLat;
	/** Ground size of a pixel. */
	readonly metresPerPixel: number;
	/** Clockwise rotation of the image's top from north, in degrees. */
	readonly bearing: number;
}

/** A plan placed by its centre, scale and rotation: the starting point before alignment. */
export function place(
	{ center, metresPerPixel, bearing }: Placement,
	width: number,
	height: number,
): Transform {
	const [cx, cy] = toMercator(center);
	// Ground metres → Mercator metres: × 1 / cos(latitude).
	const k = metresPerPixel / Math.cos((center[1] * Math.PI) / 180);
	const theta = (bearing * Math.PI) / 180;
	const cos = k * Math.cos(theta);
	const sin = k * Math.sin(theta);
	// u runs along (cos θ, −sin θ), v (downwards) along (−sin θ, −cos θ).
	const matrix: Matrix = [
		cos,
		-sin,
		cx - (cos * width) / 2 + (sin * height) / 2,
		-sin,
		-cos,
		cy + (sin * width) / 2 + (cos * height) / 2,
		0,
		0,
		1,
	];
	return { kind: "similarity", matrix };
}

/** Scales the plan about pixel `a` so that pixels `a` and `b` are `metres` apart on the ground. */
export function scaleToDistance(
	transform: Transform,
	a: Pixel,
	b: Pixel,
	metres: number,
): Transform {
	const current = groundDistance(project(transform, a), project(transform, b));
	if (!(current > 0)) {
		throw new GeorefError("Pick two different points to measure a distance.");
	}
	const k = metres / current;
	return aboutPoint(transform, a, [k, 0, 0, k]);
}

/** Turns the plan clockwise by `degrees` around a pixel, which stays in place. */
export function rotateAbout(
	transform: Transform,
	pin: Pixel,
	degrees: number,
): Transform {
	const theta = (degrees * Math.PI) / 180;
	const cos = Math.cos(theta);
	const sin = Math.sin(theta);
	return aboutPoint(transform, pin, [cos, sin, -sin, cos]);
}

/** Moves the plan, unscaled and unrotated, so that `pixel` lands on `target`. */
export function translateTo(
	transform: Transform,
	pixel: Pixel,
	target: LngLat,
): Transform {
	const [px, py] = toMercator(project(transform, pixel));
	const [tx, ty] = toMercator(target);
	const shift: Matrix = [1, 0, tx - px, 0, 1, ty - py, 0, 0, 1];
	return { kind: transform.kind, matrix: multiply(shift, transform.matrix) };
}

export interface CornerDragOptions {
	/** Change the proportions: the plan stretches along its own edges, without turning. */
	readonly freeAspect?: boolean;
	/** Keep the plan's centre in place instead of the opposite corner. */
	readonly fromCenter?: boolean;
	/** Move only the dragged corner, the three others staying put (a perspective). */
	readonly distort?: boolean;
}

/**
 * The plan after dragging one of its corners (0 top left, then clockwise) to `target`, as in
 * photo editors: by default it resizes around the opposite corner, keeping its shape and
 * direction (turning has its own handle, see `dragRotation`).
 */
export function dragCorner(
	transform: Transform,
	width: number,
	height: number,
	corner: number,
	target: LngLat,
	{
		freeAspect = false,
		fromCenter = false,
		distort = false,
	}: CornerDragOptions = {},
): Transform {
	const pixels: Pixel[] = [
		[0, 0],
		[width, 0],
		[width, height],
		[0, height],
	];
	const dragged = pixels[corner];
	if (!dragged) throw new GeorefError(`No corner ${corner}.`);
	if (distort) {
		return fitPlan(
			pixels.map((image, i) => ({
				image,
				map: i === corner ? target : project(transform, image),
			})),
			"projective",
		).transform;
	}
	const pivot: Pixel = fromCenter
		? [width / 2, height / 2]
		: (pixels[(corner + 2) % 4] as Pixel);
	const [px, py] = toMercator(project(transform, pivot));
	const [dx, dy] = toMercator(project(transform, dragged));
	const [tx, ty] = toMercator(target);
	// From the pivot: where the corner is (d) and where it should go (t).
	const d: [number, number] = [dx - px, dy - py];
	const t: [number, number] = [tx - px, ty - py];
	if (!freeAspect) {
		// Scale by how far the pointer is along the diagonal: t projected on d. A plan is never
		// flipped or shrunk to nothing.
		const norm = d[0] * d[0] + d[1] * d[1];
		if (norm === 0) return transform;
		const k = Math.max(0.01, (t[0] * d[0] + t[1] * d[1]) / norm);
		return aboutPoint(transform, pivot, [k, 0, 0, k]);
	}
	// Stretch along the plan's own axes at the pivot (e for its u axis, f for v), so that its
	// edges keep their directions: d = α·e + β·f becomes t = α'·e + β'·f.
	const [ex, ey] = toMercator(project(transform, [pivot[0] + 1, pivot[1]]));
	const [fx, fy] = toMercator(project(transform, [pivot[0], pivot[1] + 1]));
	const e: [number, number] = [ex - px, ey - py];
	const f: [number, number] = [fx - px, fy - py];
	const det = e[0] * f[1] - f[0] * e[1];
	const inBasis = ([x, y]: [number, number]): [number, number] => [
		(x * f[1] - f[0] * y) / det,
		(e[0] * y - x * e[1]) / det,
	];
	const [alpha, beta] = inBasis(d);
	const [alpha2, beta2] = inBasis(t);
	if (alpha === 0 || beta === 0) return transform;
	const su = alpha2 / alpha;
	const sv = beta2 / beta;
	// B · diag(su, sv) · B⁻¹, with B = [e f] as columns.
	const m: [number, number, number, number] = [
		(e[0] * su * f[1] - f[0] * sv * e[1]) / det,
		(f[0] * sv * e[0] - e[0] * su * f[0]) / det,
		(e[1] * su * f[1] - f[1] * sv * e[1]) / det,
		(f[1] * sv * e[0] - e[1] * su * f[0]) / det,
	];
	const stretched = aboutPoint(transform, pivot, m);
	return transform.kind === "similarity"
		? { ...stretched, kind: "affine" }
		: stretched;
}

/**
 * The plan turned around its centre so that its top faces `target`, the pointer dragging the
 * rotation handle above it. With `snap`, the plan's direction goes in 15° steps.
 */
export function dragRotation(
	transform: Transform,
	width: number,
	height: number,
	target: LngLat,
	{ snap = false }: { readonly snap?: boolean } = {},
): Transform {
	const centre: Pixel = [width / 2, height / 2];
	const [cx, cy] = toMercator(project(transform, centre));
	const [ux, uy] = toMercator(project(transform, [width / 2, 0]));
	const [tx, ty] = toMercator(target);
	if (tx === cx && ty === cy) return transform;
	// Bearings, clockwise from north, of the plan's top and of the pointer.
	const degrees = (x: number, y: number) => (Math.atan2(x, y) * 180) / Math.PI;
	const current = degrees(ux - cx, uy - cy);
	let wanted = degrees(tx - cx, ty - cy);
	if (snap) wanted = Math.round(wanted / 15) * 15;
	return rotateAbout(transform, centre, wanted - current);
}

/** Where a plan is, as typed in numbers. */
export interface PlanPosition {
	/** Where its centre is. */
	readonly center: LngLat;
	/** The direction its top faces, in degrees clockwise from north, 0 to 360. */
	readonly bearing: number;
	/** Its ground width in metres, across its middle. */
	readonly width: number;
}

/** A `width` × `height` plan's position (for a warped plan, as measured at its centre). */
export function positionOf(
	transform: Transform,
	width: number,
	height: number,
): PlanPosition {
	const center = project(transform, [width / 2, height / 2]);
	const [cx, cy] = toMercator(center);
	const [tx, ty] = toMercator(project(transform, [width / 2, 0]));
	const bearing = (Math.atan2(tx - cx, ty - cy) * 180) / Math.PI;
	return {
		center,
		bearing: (bearing + 360) % 360,
		width: groundDistance(
			project(transform, [0, height / 2]),
			project(transform, [width, height / 2]),
		),
	};
}

/**
 * The plan moved, turned or scaled, as a whole and around its centre, to the position given
 * (what isn't given stays as it is). A warped plan keeps its shape.
 */
export function moveTo(
	transform: Transform,
	width: number,
	height: number,
	changes: Partial<PlanPosition>,
): Transform {
	const centre: Pixel = [width / 2, height / 2];
	// Moved first: a plan moved north or south takes more Mercator metres for the same width.
	let moved = changes.center
		? translateTo(transform, centre, changes.center)
		: transform;
	if (changes.bearing !== undefined) {
		const { bearing } = positionOf(moved, width, height);
		moved = rotateAbout(moved, centre, changes.bearing - bearing);
	}
	if (changes.width !== undefined && changes.width > 0) {
		const current = positionOf(moved, width, height).width;
		if (current > 0) {
			const k = changes.width / current;
			moved = aboutPoint(moved, centre, [k, 0, 0, k]);
		}
	}
	return moved;
}

/** Applies a 2×2 linear map on the map side, centred on where `pixel` currently is. */
function aboutPoint(
	transform: Transform,
	pixel: Pixel,
	[a, b, c, d]: [number, number, number, number],
): Transform {
	const [px, py] = toMercator(project(transform, pixel));
	const around: Matrix = [
		a,
		b,
		px - a * px - b * py,
		c,
		d,
		py - c * px - d * py,
		0,
		0,
		1,
	];
	return { kind: transform.kind, matrix: multiply(around, transform.matrix) };
}

/** Fits a transform of the given kind to control points, by least squares. */
export function fitPlan(
	points: readonly ControlPoint[],
	kind: TransformKind,
): Fit {
	const pairs = points.map((p) => ({ image: p.image, map: toMercator(p.map) }));
	const fitters = {
		similarity: fitSimilarity,
		affine: fitAffine,
		projective: fitProjective,
	};
	const transform: Transform = { kind, matrix: fitters[kind](pairs) };
	const residuals = points.map((p) =>
		groundDistance(project(transform, p.image), p.map),
	);
	const rms = Math.sqrt(
		residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length,
	);
	return { transform, residuals, rms };
}

/**
 * Distance in metres between two nearby points: their Mercator distance shrunk by the Mercator
 * scale factor, 1 / cos(latitude).
 */
export function groundDistance(a: LngLat, b: LngLat): number {
	const [ax, ay] = toMercator(a);
	const [bx, by] = toMercator(b);
	const lat = (((a[1] + b[1]) / 2) * Math.PI) / 180;
	return Math.hypot(bx - ax, by - ay) * Math.cos(lat);
}

interface Pair {
	readonly image: Pixel;
	readonly map: [number, number];
}

/**
 * Rotation, uniform scale and translation (Helmert transform), in closed form. The image's
 * `v` axis points down and the map's `y` up, so `v` is flipped first: a similarity alone can't
 * mirror.
 */
function fitSimilarity(pairs: readonly Pair[]): Matrix {
	if (pairs.length < 2) {
		throw new GeorefError("Placing a plan needs at least 2 control points.");
	}
	const mu = mean(pairs, (p) => p.image[0]);
	const mv = mean(pairs, (p) => -p.image[1]);
	const mx = mean(pairs, (p) => p.map[0]);
	const my = mean(pairs, (p) => p.map[1]);

	let norm = 0;
	let sa = 0;
	let sb = 0;
	for (const { image, map } of pairs) {
		const du = image[0] - mu;
		const dv = -image[1] - mv;
		const dx = map[0] - mx;
		const dy = map[1] - my;
		norm += du * du + dv * dv;
		sa += du * dx + dv * dy;
		sb += du * dy - dv * dx;
	}
	if (norm === 0) {
		throw new GeorefError("The control points are all at the same place.");
	}
	const a = sa / norm;
	const b = sb / norm;
	// x = a·u − b·(−v) + tx, y = b·u + a·(−v) + ty
	return [a, b, mx - a * mu + b * mv, b, -a, my - b * mu - a * mv, 0, 0, 1];
}

/** Mean of a value over the pairs. */
function mean(pairs: readonly Pair[], f: (p: Pair) => number): number {
	return pairs.reduce((sum, p) => sum + f(p), 0) / pairs.length;
}

/** Any linear map plus translation: also fits plans with stretched or skewed axes. */
function fitAffine(pairs: readonly Pair[]): Matrix {
	if (pairs.length < 3) {
		throw new GeorefError("An affine fit needs at least 3 control points.");
	}
	const mu = mean(pairs, (p) => p.image[0]);
	const mv = mean(pairs, (p) => p.image[1]);
	const mx = mean(pairs, (p) => p.map[0]);
	const my = mean(pairs, (p) => p.map[1]);
	// Normal equations on centred coordinates: [suu suv; suv svv]·[a b] = [sux svx]
	let suu = 0;
	let suv = 0;
	let svv = 0;
	let sux = 0;
	let svx = 0;
	let suy = 0;
	let svy = 0;
	for (const { image, map } of pairs) {
		const du = image[0] - mu;
		const dv = image[1] - mv;
		const dx = map[0] - mx;
		const dy = map[1] - my;
		suu += du * du;
		suv += du * dv;
		svv += dv * dv;
		sux += du * dx;
		svx += dv * dx;
		suy += du * dy;
		svy += dv * dy;
	}
	const det = suu * svv - suv * suv;
	if (!(det > 1e-9 * suu * svv)) {
		throw new GeorefError(
			"The control points are on one line in the image: add one away from it.",
		);
	}
	const a = (sux * svv - svx * suv) / det;
	const b = (svx * suu - sux * suv) / det;
	const d = (suy * svv - svy * suv) / det;
	const e = (svy * suu - suy * suv) / det;
	return [a, b, mx - a * mu - b * mv, d, e, my - d * mu - e * mv, 0, 0, 1];
}

/**
 * Perspective (homography), for plans photographed at an angle. Direct linear transform on
 * coordinates normalised to their centroid and spread (Hartley), which keeps the equations well
 * conditioned with pixel and Mercator values millions apart.
 */
function fitProjective(pairs: readonly Pair[]): Matrix {
	if (pairs.length < 4) {
		throw new GeorefError("A perspective fit needs at least 4 control points.");
	}
	const image = normalisation(pairs.map((p) => p.image));
	const map = normalisation(pairs.map((p) => p.map));
	// Unknowns h0…h7 with h8 = 1; two equations per point, solved by least squares.
	const ata = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
	const atb = new Array<number>(8).fill(0);
	const addRow = (row: number[], value: number) => {
		for (let i = 0; i < 8; i++) {
			atb[i] = (atb[i] ?? 0) + (row[i] ?? 0) * value;
			const line = ata[i] as number[];
			for (let j = 0; j < 8; j++) {
				line[j] = (line[j] ?? 0) + (row[i] ?? 0) * (row[j] ?? 0);
			}
		}
	};
	for (const pair of pairs) {
		const [u, v] = image.apply(pair.image);
		const [x, y] = map.apply(pair.map);
		addRow([u, v, 1, 0, 0, 0, -u * x, -v * x], x);
		addRow([0, 0, 0, u, v, 1, -u * y, -v * y], y);
	}
	const h = solve(ata, atb);
	if (!h) {
		throw new GeorefError(
			"Three of the control points are on one line: move one of them.",
		);
	}
	const normalised: Matrix = [
		h[0] ?? 0,
		h[1] ?? 0,
		h[2] ?? 0,
		h[3] ?? 0,
		h[4] ?? 0,
		h[5] ?? 0,
		h[6] ?? 0,
		h[7] ?? 0,
		1,
	];
	// H = M⁻¹ · Hn · I
	const matrix = multiply(multiply(map.inverse, normalised), image.matrix);
	return scaleMatrix(matrix, 1 / matrix[8]);
}

/** Moves points to their centroid and scales them to an average distance of √2. */
function normalisation(points: readonly (readonly [number, number])[]) {
	const n = points.length;
	const cx = points.reduce((s, p) => s + p[0], 0) / n;
	const cy = points.reduce((s, p) => s + p[1], 0) / n;
	const spread =
		points.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / n;
	const k = spread > 0 ? Math.SQRT2 / spread : 1;
	return {
		apply: ([x, y]: readonly [number, number]): [number, number] => [
			(x - cx) * k,
			(y - cy) * k,
		],
		matrix: [k, 0, -cx * k, 0, k, -cy * k, 0, 0, 1] as Matrix,
		inverse: [1 / k, 0, cx, 0, 1 / k, cy, 0, 0, 1] as Matrix,
	};
}

/** Solves a·x = b by Gaussian elimination with partial pivoting; null if singular. */
function solve(a: number[][], b: number[]): number[] | null {
	const n = b.length;
	const m = a.map((row, i) => [...row, b[i] ?? 0]);
	const scale = Math.max(...m.flat().map(Math.abs));
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let r = col + 1; r < n; r++) {
			if (Math.abs(m[r]?.[col] ?? 0) > Math.abs(m[pivot]?.[col] ?? 0))
				pivot = r;
		}
		const pivotRow = m[pivot] as number[];
		if (Math.abs(pivotRow[col] ?? 0) < 1e-10 * scale) return null;
		[m[col], m[pivot]] = [pivotRow, m[col] as number[]];
		const row = m[col] as number[];
		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const other = m[r] as number[];
			const factor = (other[col] ?? 0) / (row[col] ?? 1);
			for (let c = col; c <= n; c++) {
				other[c] = (other[c] ?? 0) - factor * (row[c] ?? 0);
			}
		}
	}
	return m.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
}

function multiply(a: Matrix, b: Matrix): Matrix {
	const [a0, a1, a2, a3, a4, a5, a6, a7, a8] = a;
	const [b0, b1, b2, b3, b4, b5, b6, b7, b8] = b;
	return [
		a0 * b0 + a1 * b3 + a2 * b6,
		a0 * b1 + a1 * b4 + a2 * b7,
		a0 * b2 + a1 * b5 + a2 * b8,
		a3 * b0 + a4 * b3 + a5 * b6,
		a3 * b1 + a4 * b4 + a5 * b7,
		a3 * b2 + a4 * b5 + a5 * b8,
		a6 * b0 + a7 * b3 + a8 * b6,
		a6 * b1 + a7 * b4 + a8 * b7,
		a6 * b2 + a7 * b5 + a8 * b8,
	];
}

function scaleMatrix(m: Matrix, k: number): Matrix {
	return m.map((value) => value * k) as unknown as Matrix;
}

function invert(m: Matrix): Matrix {
	const [a, b, c, d, e, f, g, h, i] = m;
	const A = e * i - f * h;
	const B = -(d * i - f * g);
	const C = d * h - e * g;
	const det = a * A + b * B + c * C;
	if (det === 0)
		throw new GeorefError("The plan's transform can't be inverted.");
	return [
		A / det,
		-(b * i - c * h) / det,
		(b * f - c * e) / det,
		B / det,
		(a * i - c * g) / det,
		-(a * f - c * d) / det,
		C / det,
		-(a * h - b * g) / det,
		(a * e - b * d) / det,
	];
}
