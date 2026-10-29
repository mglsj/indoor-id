/**
 * The arrows drawn along steps, ramps, escalators and moving walkways (P5.3.8), made in code
 * rather than loaded: a chevron pointing along the line (right, as MapLibre places line
 * symbols), or two for a line used both ways. Pure: RGBA pixels MapLibre's `addImage` takes.
 */

export const ARROW_IMAGE = "indoor-arrow";
export const BOTH_ARROWS_IMAGE = "indoor-arrows-both";

/** Size of an arrow in CSS pixels. */
const SIZE = 12;

export interface ArrowImage {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8ClampedArray;
}

/** An arrow image, or null when `id` isn't one of them. */
export function arrowImage(id: string, pixelRatio = 1): ArrowImage | null {
	if (id !== ARROW_IMAGE && id !== BOTH_ARROWS_IMAGE) return null;
	const both = id === BOTH_ARROWS_IMAGE;
	const height = Math.round(SIZE * pixelRatio);
	const width = both ? height * 2 : height;
	const data = new Uint8ClampedArray(width * height * 4);
	const stroke = 1.6 * pixelRatio;
	// A chevron in a square of side h whose tip is at x0 + h·0.7, pointing right (or left).
	const chevron = (x: number, y: number, x0: number, right: boolean) => {
		const h = height;
		const tipX = x0 + (right ? h * 0.7 : h * 0.3);
		const backX = x0 + (right ? h * 0.3 : h * 0.7);
		const top = { x: backX, y: h * 0.15 };
		const bottom = { x: backX, y: h * 0.85 };
		const tip = { x: tipX, y: h / 2 };
		return Math.min(
			distanceToSegment(x, y, top, tip),
			distanceToSegment(x, y, bottom, tip),
		);
	};
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const cx = x + 0.5;
			const cy = y + 0.5;
			const d = both
				? Math.min(chevron(cx, cy, 0, false), chevron(cx, cy, height, true))
				: chevron(cx, cy, 0, true);
			// Dark, with a light edge so it shows on any fill.
			const alpha = clamp(stroke + 1 - d);
			const core = clamp(stroke - d);
			const i = (y * width + x) * 4;
			const shade = Math.round(255 * (1 - core) + 0x33 * core);
			data[i] = shade;
			data[i + 1] = shade;
			data[i + 2] = shade;
			data[i + 3] = Math.round(255 * alpha);
		}
	}
	return { width, height, data };
}

function clamp(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function distanceToSegment(
	x: number,
	y: number,
	a: { x: number; y: number },
	b: { x: number; y: number },
): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const t = Math.max(
		0,
		Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)),
	);
	return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}
