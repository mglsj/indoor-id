import { describe, expect, it } from "vitest";
import {
	checkState,
	nextCheckValue,
	radioOptions,
	radioPatch,
	structureTypePatch,
} from "./choice.ts";
import type { Field } from "./presets.ts";

const field = (extra: Partial<Field>): Field => ({
	id: "f",
	key: "f",
	type: "check",
	label: "F",
	options: [],
	terms: [],
	universal: false,
	snakeCase: true,
	caseSensitive: false,
	customValues: true,
	autoSuggestions: true,
	allowDuplicates: false,
	...extra,
});

const seating = field({ key: "outdoor_seating" });
const fee = field({ key: "fee", type: "defaultCheck" });
const armrest = field({
	key: "armrest",
	options: [
		{ value: "undefined", label: "Unknown" },
		{ value: "yes", label: "One or more armrests" },
		{ value: "no", label: "No armrests" },
	],
});
const oneway = field({
	key: "oneway",
	options: ["undefined", "yes", "no", "reversible", "alternating"].map(
		(value) => ({ value, label: value }),
	),
});

describe("check fields, as iD's", () => {
	it("cycle unset → yes → no → unset", () => {
		expect(nextCheckValue(seating, undefined)).toBe("yes");
		expect(nextCheckValue(seating, "yes")).toBe("no");
		expect(nextCheckValue(seating, "no")).toBeUndefined();
		expect(nextCheckValue(seating, "YES")).toBe("no");
	});

	it("a default check only has unset and yes", () => {
		expect(nextCheckValue(fee, undefined)).toBe("yes");
		expect(nextCheckValue(fee, "yes")).toBeUndefined();
	});

	it("follow the field's own values, skipping reversible and alternating", () => {
		expect(nextCheckValue(armrest, "yes")).toBe("no");
		expect(nextCheckValue(oneway, "no")).toBeUndefined();
	});

	it("an unknown value goes back to unset", () => {
		expect(nextCheckValue(seating, "seasonal")).toBeUndefined();
	});

	it("show a tri-state box and the value's text", () => {
		expect(checkState(seating, undefined)).toEqual({
			checked: false,
			indeterminate: true,
			text: "Unknown",
			raw: false,
		});
		expect(checkState(seating, "yes")).toMatchObject({
			checked: true,
			indeterminate: false,
			text: "Yes",
		});
		expect(checkState(armrest, "no")).toMatchObject({
			checked: false,
			text: "No armrests",
		});
		expect(checkState(fee, undefined)).toMatchObject({ indeterminate: false });
		expect(checkState(seating, "seasonal")).toMatchObject({
			checked: true,
			text: '"seasonal"',
			raw: true,
		});
	});
});

const wheelchair = field({
	key: "wheelchair",
	type: "radio",
	options: [
		{ value: "yes", label: "Yes" },
		{ value: "limited", label: "Limited" },
		{ value: "no", label: "No" },
	],
});
const structure = field({
	key: undefined,
	keys: ["bridge", "tunnel", "embankment"],
	type: "structureRadio",
	options: [
		{ value: "bridge", label: "Bridge" },
		{ value: "tunnel", label: "Tunnel" },
		{ value: "embankment", label: "Embankment" },
	],
});

describe("radio fields", () => {
	it("offer their options, and a value set that isn't one of them", () => {
		expect(
			radioOptions(wheelchair, { wheelchair: "bumpy" }).map((o) => o.value),
		).toEqual(["yes", "limited", "no", "bumpy"]);
	});

	it("set their key to the choice", () => {
		expect(radioPatch(wheelchair, {}, "limited")).toEqual({
			wheelchair: "limited",
		});
	});

	it("without a key, set the key chosen and unset the others", () => {
		expect(
			radioPatch(structure, { embankment: "yes" }, "tunnel", {}),
		).toMatchObject({
			bridge: undefined,
			tunnel: "yes",
			embankment: undefined,
		});
		// A value the structure had before comes back.
		expect(
			radioPatch(structure, { tunnel: "yes" }, "bridge", {
				bridge: "viaduct",
			}),
		).toMatchObject({ bridge: "viaduct", tunnel: undefined });
	});
});

describe("structure layers, as iD's", () => {
	it("puts a bridge on layer 1 and a tunnel on -1, keeping a layer on the right side", () => {
		expect(radioPatch(structure, {}, "bridge")).toMatchObject({ layer: "1" });
		expect(radioPatch(structure, { layer: "2" }, "bridge")).toMatchObject({
			layer: "2",
		});
		expect(radioPatch(structure, { layer: "2" }, "tunnel")).toMatchObject({
			layer: "-1",
		});
		expect(radioPatch(structure, { layer: "-1" }, "embankment")).toMatchObject({
			layer: undefined,
		});
	});

	it("takes the layer off a building passage or a structure set to no", () => {
		expect(
			structureTypePatch(
				{ tunnel: "yes", layer: "-1" },
				"tunnel",
				"building_passage",
			),
		).toEqual({ tunnel: "building_passage", layer: undefined });
		expect(
			structureTypePatch({ bridge: "yes", layer: "1" }, "bridge", "no"),
		).toEqual({ bridge: "no", layer: undefined });
		expect(
			structureTypePatch({ bridge: "yes", layer: "2" }, "bridge", "viaduct"),
		).toEqual({ bridge: "viaduct", layer: "2" });
	});
});
