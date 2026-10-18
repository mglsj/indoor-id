import { describe, expect, it } from "vitest";
import {
	addField,
	fieldKeys,
	fieldList,
	isLocked,
	isModified,
	matchesField,
	removeField,
	revertField,
} from "./field-list.ts";
import { type Field, type Preset, PresetIndex } from "./presets.ts";

const field = (
	id: string,
	key: string,
	label: string,
	extra: Partial<Field> = {},
): Field => ({
	id,
	key,
	type: "text",
	label,
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

const name = field("name", "name", "Name", {
	type: "localized",
	universal: true,
});
const cafe: Preset = {
	id: "amenity/cafe",
	name: "Cafe",
	terms: [],
	geometry: ["point", "area"],
	tags: { amenity: "cafe" },
	fields: ["name", "cuisine", "building_area"],
	moreFields: ["opening_hours", "level", "internet_access/fee"],
};
const index = new PresetIndex(
	[cafe],
	[
		name,
		field("cuisine", "cuisine", "Cuisine"),
		field("building_area", "building", "Building", { geometry: ["area"] }),
		field("opening_hours", "opening_hours", "Hours", {
			terms: ["open", "times"],
		}),
		field("level", "level", "Level"),
		field("internet_access/fee", "internet_access:fee", "Internet Fee", {
			prerequisiteTag: { key: "internet_access", valueNot: "no" },
		}),
		field("description", "description", "Description", { universal: true }),
		field("note", "note", "Note", { universal: true }),
		field("alt_name", "alt_name", "Alternative Name", {
			universal: true,
			prerequisiteTag: { key: "name" },
		}),
	],
);
const labels = (fields: readonly Field[]) => fields.map((f) => f.label);
const listed = (
	tags: Record<string, string>,
	geometry: "point" | "area" = "point",
	added: string[] = [],
) => fieldList(index, cafe, tags, geometry, new Set(added));

describe("fieldList, as iD's Fields section", () => {
	it("shows the type's fields for the geometry, then the others with a value, by label", () => {
		const tags = { amenity: "cafe", opening_hours: "24/7", note: "Closed" };
		expect(labels(listed(tags).shown)).toEqual([
			"Name",
			"Cuisine",
			"Hours",
			"Note",
		]);
		expect(labels(listed(tags, "area").shown)).toEqual([
			"Name",
			"Cuisine",
			"Building",
			"Hours",
			"Note",
		]);
	});

	it("shows the fields added, even without a value", () => {
		expect(
			labels(listed({ amenity: "cafe" }, "point", ["description"]).shown),
		).toEqual(["Name", "Cuisine", "Description"]);
	});

	it("offers the others in Add field, the universal ones last", () => {
		// (iD counts a missing key as "not no": Internet Fee waits only for internet_access=no.)
		expect(labels(listed({ amenity: "cafe" }).addable)).toEqual([
			"Hours",
			"Internet Fee",
			"Level",
			"Description",
			"Note",
		]);
	});

	it("leaves out a field until its prerequisite tag is there", () => {
		expect(
			labels(listed({ amenity: "cafe", internet_access: "wlan" }).addable),
		).toContain("Internet Fee");
		expect(
			labels(listed({ amenity: "cafe", internet_access: "no" }).addable),
		).not.toContain("Internet Fee");
		expect(
			labels(listed({ amenity: "cafe", name: "Le Sully" }).addable),
		).toContain("Alternative Name");
	});

	it("shows a field with a value whatever its prerequisite", () => {
		expect(
			labels(listed({ amenity: "cafe", alt_name: "Sully" }).shown),
		).toContain("Alternative Name");
	});
});

describe("fieldKeys", () => {
	it("are the field's key and keys", () => {
		expect(
			fieldKeys(field("ref", "ref", "Ref", { keys: ["ref", "ref:room"] }), {}),
		).toEqual(["ref", "ref:room"]);
	});

	it("add the name in other languages to a localized field", () => {
		expect(
			fieldKeys(name, {
				name: "Gare",
				"name:fr": "Gare",
				"name:zh-Hant": "車站",
				"name:etymology:wikidata": "Q1",
				name_1: "Station",
			}),
		).toEqual(["name", "name:fr", "name:zh-Hant"]);
	});

	it("add the keys under a multiCombo's prefix", () => {
		const payment = field("payment_multi", "payment:", "Payment", {
			type: "multiCombo",
		});
		expect(
			fieldKeys(payment, { "payment:cash": "yes", "payment:cards": "no" }),
		).toEqual(["payment:", "payment:cash", "payment:cards"]);
	});
});

describe("addField", () => {
	it("sets the field's default, as iD does when a field is added", () => {
		const layer = field("layer_1", "layer", "Layer", { default: "1" });
		expect(addField(layer, { indoor: "room" })).toEqual({
			indoor: "room",
			layer: "1",
		});
		expect(addField(layer, { layer: "2" })).toEqual({ layer: "2" });
		expect(addField(index.field("note") as Field, { a: "b" })).toEqual({
			a: "b",
		});
	});
});

describe("matchesField (Add field)", () => {
	const hours = index.field("opening_hours") as Field;
	it("matches the label, the terms and the key", () => {
		expect(matchesField(hours, "hou")).toBe(true);
		expect(matchesField(hours, "Times")).toBe(true);
		expect(matchesField(hours, "opening_h")).toBe(true);
		expect(matchesField(hours, "wifi")).toBe(false);
	});
});

describe("removing and reverting a field", () => {
	it("remove clears all the field's keys", () => {
		expect(
			removeField(name, { amenity: "cafe", name: "Gare", "name:fr": "Gare" }),
		).toEqual({ amenity: "cafe" });
	});

	it("a field is modified when one of its keys differs from the downloaded tags", () => {
		expect(isModified(name, { name: "A" }, { name: "A" })).toBe(false);
		expect(isModified(name, { name: "A" }, { name: "B" })).toBe(true);
		// A key only the downloaded tags have counts too.
		expect(isModified(name, { name: "A", "name:fr": "Á" }, { name: "A" })).toBe(
			true,
		);
	});

	it("revert brings the downloaded values back, and only the field's", () => {
		expect(
			revertField(
				name,
				{ amenity: "cafe", name: "A", "name:fr": "Á" },
				{ amenity: "bar", name: "B", "name:de": "Ä" },
			),
		).toEqual({ amenity: "bar", name: "A", "name:fr": "Á" });
	});

	it("on a new feature, a field with a value is modified, and revert clears it", () => {
		expect(isModified(name, undefined, {})).toBe(false);
		expect(isModified(name, undefined, { name: "B" })).toBe(true);
		expect(revertField(name, undefined, { name: "B", shop: "yes" })).toEqual({
			shop: "yes",
		});
	});
});

describe("isLocked, as iD", () => {
	it("locks the brand, network, operator and flag of a feature linked to Wikidata", () => {
		for (const id of ["brand", "network", "operator", "flag"]) {
			expect(isLocked(field(id, id, id), { [id]: "X", wikidata: "Q1" })).toBe(
				true,
			);
		}
		expect(isLocked(field("brand", "brand", "Brand"), { brand: "X" })).toBe(
			false,
		);
	});

	it("locks the name of a feature linked to Wikidata", () => {
		expect(isLocked(name, { name: "Louvre", wikidata: "Q19675" })).toBe(true);
		expect(
			isLocked(name, {
				name: "Rue Pasteur",
				"name:etymology:wikidata": "Q529",
			}),
		).toBe(true);
		expect(isLocked(name, { name: "Louvre" })).toBe(false);
		expect(
			isLocked(index.field("description") as Field, { wikidata: "Q19675" }),
		).toBe(false);
	});
});
