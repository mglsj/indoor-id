import { describe, expect, it } from "vitest";
import { accessOptions, accessPlaceholder } from "./access.ts";
import type { Field } from "./presets.ts";

const access: Field = {
	id: "access",
	keys: ["access", "foot", "motor_vehicle", "bicycle", "horse"],
	type: "access",
	label: "Allowed Access",
	placeholder: "Not Specified",
	options: [
		{ value: "yes", label: "Allowed", description: "Access allowed by law" },
		{ value: "no", label: "Prohibited", description: "Not allowed" },
	],
	terms: [],
	universal: false,
	snakeCase: true,
	caseSensitive: false,
	customValues: true,
	autoSuggestions: true,
	allowDuplicates: false,
};

describe("access options, as iD's", () => {
	it("are the usual values, without yes and designated for everyone", () => {
		expect(accessOptions(access, "foot").map((o) => o.value)).toEqual([
			"yes",
			"no",
			"designated",
			"permissive",
			"destination",
			"customers",
			"private",
			"permit",
			"unknown",
		]);
		expect(accessOptions(access, "access").map((o) => o.value)).not.toContain(
			"designated",
		);
		expect(accessOptions(access, "bicycle").map((o) => o.value)).toContain(
			"dismount",
		);
	});

	it("show the value and its description", () => {
		expect(accessOptions(access, "foot")[1]).toEqual({
			value: "no",
			label: "no",
			description: "Not allowed",
		});
	});
});

describe("accessPlaceholder: the access implied when not set", () => {
	it("follows access, then vehicle for bicycles and motor vehicles", () => {
		expect(accessPlaceholder(access, { access: "private" }, "foot")).toBe(
			"private",
		);
		expect(
			accessPlaceholder(access, { vehicle: "no", access: "yes" }, "bicycle"),
		).toBe("no");
	});

	it("knows what paths and barriers allow", () => {
		expect(accessPlaceholder(access, { highway: "steps" }, "bicycle")).toBe(
			"no",
		);
		expect(accessPlaceholder(access, { highway: "footway" }, "foot")).toBe(
			"designated",
		);
		expect(accessPlaceholder(access, { barrier: "bollard" }, "access")).toBe(
			"no",
		);
	});

	it("is yes for everyone on anything but a barrier, else the field's placeholder", () => {
		expect(accessPlaceholder(access, { indoor: "corridor" }, "access")).toBe(
			"yes",
		);
		expect(accessPlaceholder(access, { indoor: "corridor" }, "horse")).toBe(
			"Not Specified",
		);
	});
});
