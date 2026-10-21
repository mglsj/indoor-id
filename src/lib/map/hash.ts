/**
 * URL hash holding the map view, in the format `#zoom/lat/lon/level`.
 *
 * This is the format used by OsmInEdit 1.x (level is optional), so old links keep working.
 * Unlike 1.x, fractional zooms and decimal levels (e.g. mezzanine `0.5`) are preserved.
 */

export interface MapView {
	zoom: number;
	lat: number;
	lon: number;
	level: number;
}

export const MIN_ZOOM = 0;
export const MAX_ZOOM = 24;

/** Strict number parsing: rejects empty strings and trailing garbage that parseFloat accepts. */
function toNumber(value: string): number {
	return value.trim() === "" ? NaN : Number(value);
}

function isFiniteNumber(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value);
}

/**
 * Parses a URL hash. Returns null when the hash doesn't describe a valid view,
 * so callers can fall back to a default view.
 */
export function parseHash(hash: string): MapView | null {
	const parts = (hash.startsWith("#") ? hash.slice(1) : hash).split("/");
	if (parts.length < 3 || parts.length > 4) return null;

	const [zoom, lat, lon, level] = parts.map(toNumber);
	if (!isFiniteNumber(zoom) || !isFiniteNumber(lat) || !isFiniteNumber(lon))
		return null;
	if (
		zoom < MIN_ZOOM ||
		zoom > MAX_ZOOM ||
		Math.abs(lat) > 90 ||
		Math.abs(lon) > 180
	)
		return null;

	return { zoom, lat, lon, level: isFiniteNumber(level) ? level : 0 };
}

/**
 * Number of decimals needed for a coordinate to be precise to one screen pixel at this zoom
 * (one 256px tile spans 360° / 2^zoom).
 */
export function coordinatePrecision(zoom: number): number {
	return Math.max(0, Math.ceil(Math.log10((256 * 2 ** zoom) / 360)));
}

/** Rounds and drops trailing zeros, so `48.130000` is written `48.13`. */
function formatNumber(value: number, decimals: number): string {
	const rounded = Number(value.toFixed(decimals));
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function formatHash(view: MapView): `#${string}` {
	const precision = coordinatePrecision(view.zoom);
	const parts = [
		formatNumber(view.zoom, 2),
		formatNumber(view.lat, precision),
		formatNumber(view.lon, precision),
		// Exact: level 0.125 is a level of its own, not 0.13.
		String(Object.is(view.level, -0) ? 0 : view.level),
	];
	return `#${parts.join("/")}`;
}
