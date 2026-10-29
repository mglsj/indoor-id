/**
 * Map icons: the presets' Maki and Temaki icons, named as in the presets (`maki-toilet`, copied
 * by scripts/build-presets.ts), and the 1.x set, named `key_value` like `amenity_toilets`.
 * They are bundled by Vite and loaded only when the map first needs them, at the screen's pixel
 * density.
 */
import type { Map as MapLibreMap } from "../maplibre.ts";
import { arrowImage } from "./arrows.ts";

const files = import.meta.glob<string>(
	["./icons/*.{svg,png}", "../../presets/generated/icons/*.svg"],
	{ query: "?url&no-inline", import: "default", eager: true },
);

/** Icon name → URL, preferring the SVG version when both exist. */
const ICON_URLS = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
	const name = path.replace(/^.*\//, "").replace(/\.(svg|png)$/, "");
	if (path.endsWith(".svg") || !ICON_URLS.has(name)) ICON_URLS.set(name, url);
}

export const AVAILABLE_ICONS: ReadonlySet<string> = new Set(ICON_URLS.keys());

/** URL of a bundled icon, for showing it outside the map. */
export function iconUrl(name: string | undefined): string | undefined {
	return name === undefined ? undefined : ICON_URLS.get(name);
}

/** Size icons are drawn at, in CSS pixels, before the layer's `icon-size`. */
const ICON_SIZE = 32;

/** Makes the map load icons on demand, when a layer first asks for them. */
export function loadIconsOnDemand(map: MapLibreMap): void {
	map.setMissingStyleImageResolver(async (id) => {
		const pixelRatio = window.devicePixelRatio || 1;
		const arrow = arrowImage(id, pixelRatio);
		if (arrow) {
			if (!map.hasImage(id)) map.addImage(id, arrow, { pixelRatio });
			return;
		}
		const url = ICON_URLS.get(id);
		if (!url) return;
		const image = await rasterize(url, Math.round(ICON_SIZE * pixelRatio));
		if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio });
	});
}

/** Draws an image (SVG or bitmap) on a square canvas of `size` pixels. */
async function rasterize(url: string, size: number): Promise<ImageData> {
	const image = new Image(size, size);
	image.src = url;
	await image.decode();
	const canvas = new OffscreenCanvas(size, size);
	const context = canvas.getContext("2d");
	if (!context) throw new Error("No 2D canvas");
	context.drawImage(image, 0, 0, size, size);
	return context.getImageData(0, 0, size, size);
}
