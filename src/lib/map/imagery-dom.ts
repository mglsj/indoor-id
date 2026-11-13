/**
 * Imagery drawn as `<img>` elements behind the map's canvas, as iD draws all its imagery: for a
 * tile server that doesn't send `Access-Control-Allow-Origin` (a local server, most WMS and TMS
 * proxies), whose tiles WebGL may not read. An `<img>` without `crossorigin` needs no CORS.
 *
 * Each image is placed by a CSS `matrix3d` built from MapLibre's own matrix, so it follows the
 * map at any bearing and pitch; brightness, contrast and saturation are CSS filters, as in iD.
 */
import type { ImageryDisplay } from "./backgrounds.ts";

/** The size, in CSS pixels, an image is laid out at before its transform. */
export const IMAGE_SIZE = 256;

/**
 * The CSS `matrix3d` placing a `IMAGE_SIZE` px square at `left`, `top`, `size` world pixels, for
 * a canvas `width` × `height` CSS pixels drawn with `mvp` (MapLibre's world-pixel to clip-space
 * matrix, column-major). The depth is dropped (z is kept as given), so the matrix stays
 * invertible and the browser draws it.
 */
export function placement(
	mvp: ArrayLike<number>,
	left: number,
	top: number,
	size: number,
	width: number,
	height: number,
): string {
	const m = (column: number, row: number) => mvp[column * 4 + row] ?? 0;
	const scale = size / IMAGE_SIZE;
	// Clip-space x, y and w of the element's (u, v): a·u + b·v + c, in float64.
	const clip = [0, 1, 3].map((row) => [
		m(0, row) * scale,
		m(1, row) * scale,
		m(0, row) * left + m(1, row) * top + m(3, row),
	]) as [number[], number[], number[]];
	const [x, y, w] = clip;
	// Clip space to CSS pixels: X = (x + w)·width/2, Y = (w − y)·height/2.
	const X = x.map((v, i) => ((v + (w[i] ?? 0)) * width) / 2);
	const Y = y.map((v, i) => (((w[i] ?? 0) - v) * height) / 2);
	// Column-major: u, v, z, then the translation.
	const values = [
		X[0],
		Y[0],
		0,
		w[0],
		X[1],
		Y[1],
		0,
		w[1],
		0,
		0,
		1,
		0,
		X[2],
		Y[2],
		0,
		w[2],
	];
	return `matrix3d(${values.join(",")})`;
}

/** iD's imagery display as a CSS filter, empty when the imagery is shown as served. */
export function displayFilter({
	brightness,
	contrast,
	saturation,
}: ImageryDisplay): string {
	const parts: string[] = [];
	if (brightness !== 1) parts.push(`brightness(${brightness})`);
	if (contrast !== 1) parts.push(`contrast(${contrast})`);
	if (saturation !== 1) parts.push(`saturate(${saturation})`);
	return parts.join(" ");
}

/** Loads an image without CORS: a 404 or any error rejects. */
export function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.decoding = "async";
		image.draggable = false;
		image.alt = "";
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`No image at ${url}`));
		image.src = url;
	});
}

/** The element the images go in, just under the map's canvas. */
export function imageContainer(canvas: HTMLCanvasElement): HTMLDivElement {
	const container = document.createElement("div");
	container.className = "imagery-images";
	Object.assign(container.style, {
		position: "absolute",
		left: "0",
		top: "0",
		width: "100%",
		height: "100%",
		overflow: "hidden",
		pointerEvents: "none",
	});
	canvas.parentElement?.insertBefore(container, canvas);
	return container;
}

/** Lays out an image to be placed by `placement`. */
export function prepareImage(image: HTMLImageElement): HTMLImageElement {
	Object.assign(image.style, {
		position: "absolute",
		left: "0",
		top: "0",
		width: `${IMAGE_SIZE}px`,
		height: `${IMAGE_SIZE}px`,
		maxWidth: "none",
		transformOrigin: "0 0",
		userSelect: "none",
	});
	return image;
}
