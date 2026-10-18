/**
 * Matrices for drawing floor plans on the GPU. A plan's transform maps plan units to Web
 * Mercator metres, about 10⁷ around most places; the camera maps world pixels (the world is
 * 512 × 2^zoom pixels) to clip space. Both are composed here in float64, so the matrix the
 * shader gets in float32 maps small plan units to small clip coordinates: no jitter at any
 * zoom. A perspective plan keeps its w, divided by the GPU per vertex. Pure.
 */
import type { Pixel, Transform } from "#lib/floorplans/georef.ts";
import { EARTH_RADIUS } from "#lib/osm/geometry.ts";

/** Half the Mercator world's width, in metres. */
const HALF = Math.PI * EARTH_RADIUS;

/**
 * Plan units (`[u, v, 0, 1]`) to clip space, column-major: `worldToClip` (MapLibre's
 * `modelViewProjectionMatrix`, column-major, for a `worldSize`-pixel world) after the plan's
 * transform.
 */
export function planToClip(
	transform: Transform,
	worldToClip: ArrayLike<number>,
	worldSize: number,
): Float64Array {
	const [a, b, c, d, e, f, g, h, i] = transform.matrix;
	const s = worldSize / (2 * HALF);
	// Plan units to homogeneous world pixels, as columns of a 4 × 4 (z stays 0):
	// x·w = s·(X + HALF·W), y·w = s·(HALF·W − Y), w = W.
	const plan = [
		s * (a + HALF * g),
		s * (HALF * g - d),
		0,
		g,
		s * (b + HALF * h),
		s * (HALF * h - e),
		0,
		h,
		0,
		0,
		0,
		0,
		s * (c + HALF * i),
		s * (HALF * i - f),
		0,
		i,
	];
	const out = new Float64Array(16);
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) {
				sum += (worldToClip[k * 4 + row] ?? 0) * (plan[col * 4 + k] ?? 0);
			}
			out[col * 4 + row] = sum;
		}
	}
	return out;
}

/**
 * Device pixels one plan unit spans at `at`, on a `width` × `height` device-pixel view: the
 * mean of its two axes, which line widths scale by.
 */
export function unitPixels(
	m: ArrayLike<number>,
	{ width, height }: { readonly width: number; readonly height: number },
	[u, v]: Pixel,
): number {
	const screen = (x: number, y: number): [number, number] => {
		const at = (k: number) => m[k] ?? 0;
		const w = at(3) * x + at(7) * y + at(15);
		return [
			(((at(0) * x + at(4) * y + at(12)) / w) * width) / 2,
			(((at(1) * x + at(5) * y + at(13)) / w) * height) / 2,
		];
	};
	const [x0, y0] = screen(u, v);
	const [x1, y1] = screen(u + 1, v);
	const [x2, y2] = screen(u, v + 1);
	return (Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x0, y2 - y0)) / 2;
}
