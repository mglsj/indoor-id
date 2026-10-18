import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { corners, type LngLat, place } from "./georef.ts";
import {
	type ArchivedPlan,
	exportPlans,
	isPlanArchive,
	type PlanArchive,
	type PlanFileEntry,
	PlanFileError,
	parsePlanFile,
	parsePlansFile,
	readPlanArchive,
	transformOf,
	writePlanArchive,
} from "./plan-file.ts";

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

/** Corners of a 1.x plan, clockwise from the top left, as [lon, lat]. */
const LEGACY_CORNERS: [LngLat, LngLat, LngLat, LngLat] = [
	[-1.6955, 48.137],
	[-1.6949, 48.1369],
	[-1.695, 48.1366],
	[-1.6956, 48.1367],
];

/** A 1.x export entry, with corners written the way Leaflet serialised them. */
function legacyEntry(write: (c: LngLat) => unknown): Record<string, unknown> {
	const [tl, tr, br, bl] = LEGACY_CORNERS;
	return {
		id: "abc",
		label: "Ground floor.png",
		image: IMAGE,
		topleft: write(tl),
		topright: write(tr),
		bottomright: write(br),
		bottomleft: write(bl),
		level: 0,
		opacity: 0.8,
		visible: true,
		selected: true,
	};
}

function expectCorners(
	actual: readonly LngLat[],
	expected: readonly LngLat[],
): void {
	actual.forEach(([lon, lat], i) => {
		expect(lon).toBeCloseTo(expected[i]?.[0] ?? Number.NaN, 9);
		expect(lat).toBeCloseTo(expected[i]?.[1] ?? Number.NaN, 9);
	});
}

describe("IndoorID plan files", () => {
	it("read back what was exported", () => {
		const transform = place(
			{ center: [-1.6953, 48.1368], metresPerPixel: 0.05, bearing: 12 },
			400,
			300,
		);
		const plan: PlanFileEntry = {
			name: "Ground floor",
			image: IMAGE,
			width: 400,
			height: 300,
			level: "0.5",
			opacity: 0.4,
			visible: false,
			color: "#2563eb",
			placement: { transform },
			controlPoints: [{ image: [10, 20], map: [-1.6954, 48.1369] }],
		};

		const [read, ...rest] = parsePlansFile(exportPlans([plan]));

		expect(rest).toEqual([]);
		expect(read).toMatchObject({
			name: "Ground floor",
			image: IMAGE,
			width: 400,
			height: 300,
			level: "0.5",
			opacity: 0.4,
			visible: false,
			color: "#2563eb",
			controlPoints: plan.controlPoints,
		});
		expectCorners(
			corners(transformOf(read as PlanFileEntry, 400, 300), 400, 300),
			corners(transform, 400, 300),
		);
	});
});

describe("plan colours in files", () => {
	const entry = (color: unknown) => ({
		name: "Plan",
		image: IMAGE,
		width: 400,
		height: 300,
		level: "0",
		opacity: 0.5,
		visible: true,
		color,
		placement: {
			transform: place(
				{ center: [-1.6953, 48.1368], metresPerPixel: 0.05, bearing: 0 },
				400,
				300,
			),
		},
		controlPoints: [],
	});
	const read = (color: unknown) =>
		parsePlansFile(
			JSON.stringify({
				format: "indoorid-floorplans",
				version: 1,
				plans: [entry(color)],
			}),
		)[0];

	it("are left out of files written before plans had one", () => {
		expect(read(undefined)?.color).toBeUndefined();
	});

	it("are dropped when they aren't a #rrggbb colour, never passed on to the map", () => {
		expect(read("red")?.color).toBeUndefined();
		expect(read("#12345")?.color).toBeUndefined();
		expect(read(42)?.color).toBeUndefined();
		expect(read("#A1b2C3")?.color).toBe("#a1b2c3");
	});
});

describe("the buildings' place in files", () => {
	const file = (buildings: unknown) =>
		JSON.stringify({
			format: "indoorid-floorplans",
			version: 1,
			plans: [],
			...(buildings === undefined ? {} : { buildings }),
		});

	it("is read back as exported: how many plans are under it, and whether it shows", () => {
		const text = exportPlans([], { below: 2, visible: false });
		expect(parsePlanFile(text).buildings).toEqual({
			below: 2,
			visible: false,
		});
	});

	it("is left out of files written before it was in the list, or when damaged", () => {
		expect(parsePlanFile(file(undefined)).buildings).toBeUndefined();
		expect(parsePlanFile(file({ below: -1 })).buildings).toBeUndefined();
		expect(parsePlanFile(file({ below: 1.5 })).buildings).toBeUndefined();
		expect(parsePlanFile(file("top")).buildings).toBeUndefined();
	});

	it("shows unless the file says otherwise", () => {
		expect(parsePlanFile(file({ below: 0 })).buildings).toEqual({
			below: 0,
			visible: true,
		});
	});
});

describe("1.x plan files", () => {
	it.each([
		["[lat, lng] arrays", ([lon, lat]: LngLat) => [lat, lon]],
		["{lat, lng} objects", ([lon, lat]: LngLat) => ({ lat, lng: lon })],
	])("keep the plan's four corners exactly, from %s", (_, write) => {
		const text = JSON.stringify([legacyEntry(write)]);
		const [plan] = parsePlansFile(text);
		if (!plan) throw new Error("No plan");

		// The image size is only known once decoded; any size gives the same corners.
		expectCorners(
			corners(transformOf(plan, 800, 600), 800, 600),
			LEGACY_CORNERS,
		);
		expect(plan).toMatchObject({
			name: "Ground floor.png",
			image: IMAGE,
			level: "0",
			opacity: 0.8,
			visible: true,
		});
	});

	it("fill in what older exports left out", () => {
		const entry = legacyEntry(([lon, lat]) => [lat, lon]);
		delete entry.bottomright;
		delete entry.opacity;
		entry.level = null;
		const [plan] = parsePlansFile(JSON.stringify([entry]));
		if (!plan) throw new Error("No plan");

		// 1.x drew a missing bottom-right corner below the top right, right of the bottom left.
		const [tl, tr, , bl] = LEGACY_CORNERS;
		expectCorners(corners(transformOf(plan, 400, 300), 400, 300), [
			tl,
			tr,
			[tr[0], bl[1]],
			bl,
		]);
		expect(plan.opacity).toBe(1);
		expect(plan.level).toBeNull();
	});
});

describe("other files", () => {
	it.each([
		["not JSON", "<svg/>", "plan_file_not_json"],
		[
			"JSON of something else",
			'{"type": "FeatureCollection"}',
			"plan_file_unknown",
		],
		[
			"a plan without corners or image",
			JSON.stringify([{ id: "a", label: "x" }]),
			"plan_file_damaged",
		],
	])("are refused with a message: %s", (_, text, key) => {
		expect(() => parsePlansFile(text)).toThrow(PlanFileError);
		try {
			parsePlansFile(text);
		} catch (e) {
			expect((e as PlanFileError).msg.key).toBe(key);
		}
	});
});

describe("plan files, version 2: an archive of plans and the files they come from", () => {
	const transform = place(
		{ center: [-1.6953, 48.1368], metresPerPixel: 0.05, bearing: 12 },
		595,
		842,
	);
	const pdf = new TextEncoder().encode("%PDF-1.7 two pages");
	const photo = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
	const page = (n: number): ArchivedPlan => ({
		name: `Mall, page ${n}`,
		size: { width: 595.28, height: 841.89 },
		source: {
			kind: "pdf",
			file: "files/1.pdf",
			page: n,
			dpi: 150,
			mode: "vector",
		},
		transform,
		fitKind: "projective",
		controlPoints: [{ image: [10, 20], map: [-1.6954, 48.1369] }],
		level: String(n - 1),
		opacity: 0.4,
		visible: n === 1,
		color: "#2563eb",
		hiddenLayers: ["232R"],
	});
	const archive: PlanArchive = {
		plans: [
			page(1),
			page(2),
			{
				...page(1),
				name: "Photo",
				size: { width: 4000, height: 3000 },
				source: { kind: "raster", file: "files/2.png" },
				fitKind: "similarity",
			},
		],
		files: new Map([
			["files/1.pdf", pdf],
			["files/2.png", photo],
		]),
		buildings: { below: 1, visible: false },
	};

	it("reads back what was written: the plans, their files once, the outlines' place", () => {
		const bytes = writePlanArchive(archive);
		// A ZIP archive.
		expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(isPlanArchive(bytes)).toBe(true);
		expect(readPlanArchive(bytes)).toEqual(archive);
	});

	const manifest = (changes: Record<string, unknown>, plan = {}) =>
		zipSync({
			"plans.json": strToU8(
				JSON.stringify({
					format: "indoorid-floorplans",
					version: 2,
					plans: [{ ...page(1), ...plan }],
					...changes,
				}),
			),
			"files/1.pdf": pdf,
		});

	const failure = (bytes: Uint8Array) => {
		try {
			readPlanArchive(bytes);
		} catch (e) {
			return (e as PlanFileError).msg.key;
		}
		return null;
	};

	it("refuses a file from a newer IndoorID", () => {
		expect(failure(manifest({ version: 3 }))).toBe("plan_file_newer");
		expect(() =>
			parsePlanFile(
				JSON.stringify({
					format: "indoorid-floorplans",
					version: 3,
					plans: [],
				}),
			),
		).toThrow("newer version of IndoorID");
	});

	it("refuses a plan without its size, or whose file is missing", () => {
		expect(failure(manifest({}, { size: undefined }))).toBe(
			"plan_file_damaged",
		);
		expect(
			failure(manifest({}, { source: { kind: "svg", file: "files/9.svg" } })),
		).toBe("plan_file_damaged");
		expect(
			failure(
				manifest(
					{},
					{ source: { kind: "pdf", file: "files/1.pdf", page: 0, dpi: 150 } },
				),
			),
		).toBe("plan_file_damaged");
	});

	it("keeps the CAD layers hidden as ids, left out when the file has none or damaged ones", () => {
		const hidden = (value: unknown) =>
			readPlanArchive(manifest({}, { hiddenLayers: value })).plans[0]
				?.hiddenLayers;
		expect(hidden(["7R", "9R"])).toEqual(["7R", "9R"]);
		expect(hidden(undefined)).toBeUndefined();
		expect(hidden("7R")).toBeUndefined();
		expect(hidden(["7R", 9])).toBeUndefined();
	});

	it("refuses an archive that isn't a plan file", () => {
		expect(failure(zipSync({ "readme.txt": strToU8("hi") }))).toBe(
			"plan_file_unknown",
		);
		expect(failure(strToU8("not a zip"))).toBe("plan_file_unknown");
		expect(isPlanArchive(strToU8("{}"))).toBe(false);
	});
});
