/**
 * URL hash holding the map view, in the format `#zoom/lat/lon/level`, then
 * `&building=w123` when a building is entered (B.0).
 *
 * This is the format used by OsmInEdit (level is optional), so old links keep working.
 * Unlike OsmInEdit, fractional zooms and decimal levels (e.g. mezzanine `0.5`) are preserved.
 */
import type { RelationId, WayId } from "#lib/osm/entity.ts";

export interface MapView {
	zoom: number;
	lat: number;
	lon: number;
	level: number;
	/** The building (or level outline) entered in building mode, if any. */
	building?: WayId | RelationId;
}

/** A way or relation already on the server: new ones (negative) can't be linked to. */
const BUILDING_ID = /^[wr][1-9]\d*$/;

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
	const [view = "", ...params] = (
		hash.startsWith("#") ? hash.slice(1) : hash
	).split("&");
	const parts = view.split("/");
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

	const building = params
		.find((p) => p.startsWith("building="))
		?.slice("building=".length);
	return {
		zoom,
		lat,
		lon,
		level: isFiniteNumber(level) ? level : 0,
		...(building &&
			BUILDING_ID.test(building) && {
				building: building as WayId | RelationId,
			}),
	};
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
	const building = view.building ? `&building=${view.building}` : "";
	return `#${parts.join("/")}${building}`;
}
