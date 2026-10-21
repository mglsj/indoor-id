/**
 * Floor plan files. Version 2, written now: a ZIP archive of `plans.json` and the files the
 * plans were imported from (a PDF once for all its pages), stored as they are. Read too:
 * version 1, IndoorID's JSON with images as data URLs, and the `osminedit_floor_imagery.json`
 * files of OsmInEdit 1.x. Pure: bytes in, bytes out.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { MessageError, msg } from "#lib/i18n/messages.ts";
import type { PlanMode, PlanSize, PlanSource } from "./content.ts";
import {
	type ControlPoint,
	fitPlan,
	type LngLat,
	type Transform,
	type TransformKind,
} from "./georef.ts";

/** Where a plan sits: a fitted transform, or (1.x files) the map positions of its corners. */
export type PlanPlacement =
	| { readonly transform: Transform }
	| { readonly corners: readonly [LngLat, LngLat, LngLat, LngLat] };

export interface PlanFileEntry {
	readonly name: string;
	/** The image, as a data URL. */
	readonly image: string;
	/** Image size in pixels, when the file says (1.x files may not). */
	readonly width?: number;
	readonly height?: number;
	/** OSM level the plan shows, like `0` or `-1`; null when not assigned yet. */
	readonly level: string | null;
	readonly opacity: number;
	readonly visible: boolean;
	/** Colour of the plan's frame and marks, `#rrggbb`; files from before colours have none. */
	readonly color?: string;
	readonly placement: PlanPlacement;
	readonly controlPoints: readonly ControlPoint[];
}

/** Where the building outlines sit among the file's plans, and whether they show. */
export interface PlanFileBuildings {
	/** How many of the file's plans (listed bottom first) are drawn under the outlines. */
	readonly below: number;
	readonly visible: boolean;
}

export interface PlanFile {
	readonly plans: PlanFileEntry[];
	/** Missing from files written before the outlines had a place in the list. */
	readonly buildings?: PlanFileBuildings;
}

export class PlanFileError extends MessageError {
	override name = "PlanFileError";
}

const FORMAT = "indoorid-floorplans";
/** The newest version this IndoorID reads (and the one it writes). */
const VERSION = 2;
const MANIFEST = "plans.json";

/** A plan in a version 2 file: its `source.file` is the path of its file in the archive. */
export interface ArchivedPlan {
	readonly name: string;
	readonly size: PlanSize;
	readonly source: PlanSource;
	readonly transform: Transform;
	readonly fitKind: TransformKind;
	readonly controlPoints: readonly ControlPoint[];
	readonly level: string | null;
	readonly opacity: number;
	readonly visible: boolean;
	readonly color?: string;
	/** Ids of the CAD layers not shown; files from before have none. */
	readonly hiddenLayers?: readonly string[];
}

export interface PlanArchive {
	/** Bottom first. */
	readonly plans: readonly ArchivedPlan[];
	/** The files the plans come from, by path. */
	readonly files: ReadonlyMap<string, Uint8Array>;
	readonly buildings?: PlanFileBuildings;
}

/** Writes a version 2 plan file. Files are stored as they are: they are compressed already. */
export function writePlanArchive({
	plans,
	files,
	buildings,
}: PlanArchive): Uint8Array {
	const manifest = JSON.stringify(
		{
			format: FORMAT,
			version: VERSION,
			plans,
			...(buildings ? { buildings } : {}),
		},
		null,
		2,
	);
	return zipSync({
		[MANIFEST]: [strToU8(manifest), { level: 6 }],
		...Object.fromEntries(
			[...files].map(([path, bytes]) => [path, [bytes, { level: 0 }]]),
		),
	});
}

/** Whether bytes are a ZIP archive (a version 2 plan file), not JSON. */
export function isPlanArchive(bytes: Uint8Array): boolean {
	return (
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	);
}

/** How much a plan file may inflate to: the files are untrusted, a ZIP can lie about sizes. */
export interface ArchiveLimits {
	/** Bytes of `plans.json`. */
	readonly manifest: number;
	/** Bytes of each file a plan names. */
	readonly file: number;
	/** Bytes of all of them together. */
	readonly total: number;
}

const MB = 1024 * 1024;
export const ARCHIVE_LIMITS: ArchiveLimits = {
	manifest: 16 * MB,
	file: 256 * MB,
	total: 512 * MB,
};

/**
 * Reads a version 2 plan file. Only the manifest and the files its plans name are inflated,
 * each to at most the size the archive gives (fflate's output never grows past it), within
 * `limits`.
 */
export function readPlanArchive(
	bytes: Uint8Array,
	limits: ArchiveLimits = ARCHIVE_LIMITS,
): PlanArchive {
	const unzip = (keep: (name: string, size: number) => boolean) => {
		try {
			return unzipSync(bytes, {
				filter: ({ name, originalSize }) => keep(name, originalSize),
			});
		} catch (error) {
			if (error instanceof PlanFileError) throw error;
			throw new PlanFileError(msg("plan_file_unknown"));
		}
	};
	const tooLarge = () => new PlanFileError(msg("plan_file_too_large"));
	const manifest = unzip((name, size) => {
		if (name !== MANIFEST) return false;
		if (size > limits.manifest) throw tooLarge();
		return true;
	})[MANIFEST];
	if (!manifest) throw new PlanFileError(msg("plan_file_unknown"));
	let data: unknown;
	try {
		data = JSON.parse(strFromU8(manifest));
	} catch {
		throw invalid();
	}
	if (!isRecord(data) || data.format !== FORMAT) {
		throw new PlanFileError(msg("plan_file_unknown"));
	}
	checkVersion(data.version);
	if (!Array.isArray(data.plans)) throw invalid();
	const plans = data.plans.map(readArchivedPlan);
	const named = new Set(plans.map(({ source }) => source.file));
	let total = 0;
	const entries = unzip((name, size) => {
		if (!named.has(name)) return false;
		total += size;
		if (size > limits.file || total > limits.total) throw tooLarge();
		return true;
	});
	const files = new Map<string, Uint8Array>();
	for (const { source } of plans) {
		const file = entries[source.file];
		if (!file) throw invalid();
		files.set(source.file, file);
	}
	const buildings = buildingsOf(data.buildings);
	return { plans, files, ...(buildings ? { buildings } : {}) };
}

function checkVersion(version: unknown): void {
	if (typeof version === "number" && version > VERSION) {
		throw new PlanFileError(msg("plan_file_newer"));
	}
}

function readArchivedPlan(value: unknown): ArchivedPlan {
	if (!isRecord(value)) throw invalid();
	const transform = transformIn(value.transform);
	const size = isRecord(value.size) ? value.size : {};
	if (!isPositive(size.width) || !isPositive(size.height)) throw invalid();
	return {
		name: typeof value.name === "string" ? value.name : "Floor plan",
		size: { width: size.width, height: size.height },
		source: sourceOf(value.source),
		transform,
		fitKind: KINDS.includes(value.fitKind as TransformKind)
			? (value.fitKind as TransformKind)
			: transform.kind,
		controlPoints: Array.isArray(value.controlPoints)
			? (value.controlPoints as ControlPoint[])
			: [],
		level: typeof value.level === "string" ? value.level : null,
		opacity: opacityOf(value.opacity, 0.5),
		visible: value.visible !== false,
		...colorOf(value.color),
		...(Array.isArray(value.hiddenLayers) &&
		value.hiddenLayers.every((id) => typeof id === "string")
			? { hiddenLayers: value.hiddenLayers as string[] }
			: {}),
	};
}

function sourceOf(value: unknown): PlanSource {
	if (!isRecord(value) || typeof value.file !== "string") throw invalid();
	const { kind, file, page, dpi, mode } = value;
	// Plans saved before modes were rendered as images: no mode.
	const drawn: { mode?: PlanMode } =
		mode === "vector" || mode === "image" ? { mode } : {};
	if (kind === "raster") return { kind, file };
	if (kind === "svg") return { kind, file, ...drawn };
	if (
		kind === "pdf" &&
		typeof page === "number" &&
		Number.isInteger(page) &&
		page >= 1 &&
		isPositive(dpi)
	) {
		return { kind, file, page, dpi, ...drawn };
	}
	throw invalid();
}

/** A version 1 plan file: `plans` bottom first, and where the building outlines sit. */
export function exportPlans(
	plans: readonly PlanFileEntry[],
	buildings?: PlanFileBuildings,
): string {
	return JSON.stringify(
		{ format: FORMAT, version: 1, plans, ...(buildings ? { buildings } : {}) },
		null,
		2,
	);
}

/** The plans of an IndoorID or OsmInEdit 1.x floor plan file, bottom first. */
export function parsePlansFile(text: string): PlanFileEntry[] {
	return parsePlanFile(text).plans;
}

/** Reads an IndoorID or OsmInEdit 1.x floor plan file. */
export function parsePlanFile(text: string): PlanFile {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new PlanFileError(msg("plan_file_not_json"));
	}
	if (isRecord(data) && data.format === FORMAT) checkVersion(data.version);
	if (isRecord(data) && data.format === FORMAT && Array.isArray(data.plans)) {
		const buildings = buildingsOf(data.buildings);
		return {
			plans: data.plans.map(readPlan),
			...(buildings ? { buildings } : {}),
		};
	}
	if (Array.isArray(data)) return { plans: data.map(readLegacyPlan) };
	throw new PlanFileError(msg("plan_file_unknown"));
}

/** The transform of a plan whose image is `width` × `height` pixels. */
export function transformOf(
	entry: PlanFileEntry,
	width: number,
	height: number,
): Transform {
	const { placement } = entry;
	if ("transform" in placement) return placement.transform;
	const [tl, tr, br, bl] = placement.corners;
	// Four exact corners: a perspective, as 1.x drew its plans (CSS matrix3d).
	return fitPlan(
		[
			{ image: [0, 0], map: tl },
			{ image: [width, 0], map: tr },
			{ image: [width, height], map: br },
			{ image: [0, height], map: bl },
		],
		"projective",
	).transform;
}

const KINDS: readonly TransformKind[] = ["similarity", "affine", "projective"];

function readPlan(value: unknown): PlanFileEntry {
	if (!isRecord(value)) throw invalid();
	const transform = transformIn(
		isRecord(value.placement) ? value.placement.transform : undefined,
	);
	const width = value.width;
	const height = value.height;
	if (!isPositive(width) || !isPositive(height)) throw invalid();
	return {
		name: typeof value.name === "string" ? value.name : "Floor plan",
		image: imageOf(value.image),
		width,
		height,
		level: typeof value.level === "string" ? value.level : null,
		opacity: opacityOf(value.opacity, 0.5),
		visible: value.visible !== false,
		...colorOf(value.color),
		placement: { transform },
		controlPoints: Array.isArray(value.controlPoints)
			? (value.controlPoints as ControlPoint[])
			: [],
	};
}

/** A 1.x entry: Leaflet corners (`[lat, lng]` or `{lat, lng}`), numeric level, 0–1 opacity. */
function readLegacyPlan(value: unknown): PlanFileEntry {
	if (!isRecord(value)) throw invalid();
	const tl = latLng(value.topleft);
	const tr = latLng(value.topright);
	const bl = latLng(value.bottomleft);
	// 1.x drew a missing bottom-right corner from its neighbours.
	const br = value.bottomright ? latLng(value.bottomright) : [tr[0], bl[1]];
	const level = typeof value.level === "number" ? value.level : Number.NaN;
	return {
		name: typeof value.label === "string" ? value.label : "Floor plan",
		image: imageOf(value.image),
		...(isPositive(value.origWidth) && isPositive(value.origHeight)
			? { width: value.origWidth, height: value.origHeight }
			: {}),
		level: Number.isFinite(level) ? String(level) : null,
		opacity: opacityOf(value.opacity, 1),
		visible: value.visible !== false,
		placement: { corners: [tl, tr, br as LngLat, bl] },
		controlPoints: [],
	};
}

function transformIn(value: unknown): Transform {
	if (
		!isRecord(value) ||
		!KINDS.includes(value.kind as TransformKind) ||
		!Array.isArray(value.matrix) ||
		value.matrix.length !== 9 ||
		!value.matrix.every(Number.isFinite)
	) {
		throw invalid();
	}
	return value as unknown as Transform;
}

function latLng(value: unknown): LngLat {
	if (Array.isArray(value) && value.length >= 2) {
		const [lat, lng] = value;
		if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
	}
	if (
		isRecord(value) &&
		Number.isFinite(value.lat) &&
		Number.isFinite(value.lng)
	) {
		return [value.lng as number, value.lat as number];
	}
	throw invalid();
}

function imageOf(value: unknown): string {
	if (typeof value === "string" && value.startsWith("data:image/"))
		return value;
	throw new PlanFileError(msg("plan_file_no_image"));
}

function buildingsOf(value: unknown): PlanFileBuildings | undefined {
	if (!isRecord(value)) return undefined;
	const { below } = value;
	if (typeof below !== "number" || !Number.isInteger(below) || below < 0) {
		return undefined;
	}
	return { below, visible: value.visible !== false };
}

/** `{ color }` when the value is a `#rrggbb` colour, else nothing: it ends up in the map's style. */
function colorOf(value: unknown): { color?: string } {
	return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
		? { color: value.toLowerCase() }
		: {};
}

function opacityOf(value: unknown, fallback: number): number {
	return typeof value === "number" && value >= 0 && value <= 1
		? value
		: fallback;
}

function isPositive(value: unknown): value is number {
	return typeof value === "number" && value > 0 && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): PlanFileError {
	return new PlanFileError(msg("plan_file_damaged"));
}
