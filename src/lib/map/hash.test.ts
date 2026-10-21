import { describe, expect, it } from "vitest";
import { coordinatePrecision, formatHash, parseHash } from "./hash.ts";

describe("parseHash", () => {
	it("reads OsmInEdit 1.x links", () => {
		expect(parseHash("#19/48.13678/-1.69533/1")).toEqual({
			zoom: 19,
			lat: 48.13678,
			lon: -1.69533,
			level: 1,
		});
	});

	it("defaults the level to 0 when missing", () => {
		expect(parseHash("#18/48.1/-1.6")).toEqual({
			zoom: 18,
			lat: 48.1,
			lon: -1.6,
			level: 0,
		});
	});

	it("works without the leading #", () => {
		expect(parseHash("18/48.1/-1.6/2")?.level).toBe(2);
	});

	it("keeps fractional zooms and decimal levels", () => {
		expect(parseHash("#19.5/48.1/-1.6/0.5")).toMatchObject({
			zoom: 19.5,
			level: 0.5,
		});
	});

	it("keeps negative levels", () => {
		expect(parseHash("#19/48.1/-1.6/-2")?.level).toBe(-2);
	});

	it("treats level 0 as a real level", () => {
		expect(parseHash("#19/48.1/-1.6/0")?.level).toBe(0);
	});

	it("falls back to level 0 for an unreadable level", () => {
		expect(parseHash("#19/48.1/-1.6/G")?.level).toBe(0);
	});

	it.each([
		[""],
		["#"],
		["#19/48.1"],
		["#19/48.1/-1.6/0/extra"],
		["#a/48.1/-1.6"],
		["#19//-1.6"],
		["#19/48.1abc/-1.6"],
		["#19/91/-1.6"],
		["#19/48.1/181"],
		["#25/48.1/-1.6"],
		["#-1/48.1/-1.6"],
	])("rejects %j", (hash) => {
		expect(parseHash(hash)).toBeNull();
	});
});

describe("coordinatePrecision", () => {
	it("gives roughly pixel precision", () => {
		expect(coordinatePrecision(0)).toBe(0);
		expect(coordinatePrecision(2)).toBe(1);
		expect(coordinatePrecision(18)).toBe(6);
		expect(coordinatePrecision(22)).toBe(7);
	});
});

describe("formatHash", () => {
	it("writes zoom/lat/lon/level", () => {
		expect(
			formatHash({ zoom: 19, lat: 48.13678, lon: -1.69533, level: 1 }),
		).toBe("#19/48.13678/-1.69533/1");
	});

	it("rounds coordinates to the zoom precision and drops trailing zeros", () => {
		expect(
			formatHash({ zoom: 18, lat: 48.1234567891, lon: -1.5, level: 0 }),
		).toBe("#18/48.123457/-1.5/0");
	});

	it("rounds fractional zooms to 2 decimals", () => {
		expect(formatHash({ zoom: 19.123456, lat: 1, lon: 2, level: 0 })).toBe(
			"#19.12/1/2/0",
		);
	});

	it("writes the level exactly, however many decimals it has", () => {
		const hash = formatHash({ zoom: 19, lat: 1, lon: 2, level: 0.125 });
		expect(hash).toBe("#19/1/2/0.125");
		expect(parseHash(hash)?.level).toBe(0.125);
	});

	it("keeps decimal and negative levels", () => {
		expect(formatHash({ zoom: 19, lat: 1, lon: 2, level: 0.5 })).toBe(
			"#19/1/2/0.5",
		);
		expect(formatHash({ zoom: 19, lat: 1, lon: 2, level: -1 })).toBe(
			"#19/1/2/-1",
		);
	});

	it("never writes -0", () => {
		expect(formatHash({ zoom: 19, lat: -0.0000001, lon: 0, level: 0 })).toBe(
			"#19/0/0/0",
		);
	});

	it("round-trips through parseHash", () => {
		const view = { zoom: 20.5, lat: 48.1367812, lon: -1.6953345, level: -1 };
		const parsed = parseHash(formatHash(view))!;
		expect(parsed.zoom).toBe(20.5);
		expect(parsed.level).toBe(-1);
		expect(parsed.lat).toBeCloseTo(view.lat, 6);
		expect(parsed.lon).toBeCloseTo(view.lon, 6);
	});
});
