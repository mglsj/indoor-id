import { describe, expect, it } from "vitest";
import {
	localizeCategories,
	localizeFields,
	localizePresets,
} from "./localize.ts";
import type { Field, Preset } from "./presets.ts";

const ROOM: Preset = {
	id: "indoor/room",
	name: "Room",
	terms: ["chamber"],
	aliases: [],
	tags: { indoor: "room" },
	geometry: ["area"],
	fields: [],
	moreFields: [],
};

const FIELD: Field = {
	id: "access",
	key: "access",
	type: "access",
	label: "Allowed Access",
	options: [
		{ value: "yes", label: "Allowed", description: "Access allowed by law" },
		{ value: "no", label: "Prohibited" },
		{ value: "private", label: "Private" },
	],
	terms: ["entry"],
	universal: false,
	snakeCase: true,
	caseSensitive: false,
	customValues: true,
	autoSuggestions: true,
	allowDuplicates: false,
	types: { foot: "Foot", bicycle: "Cyclists" },
};

describe("presets in another language, from the schema's translations", () => {
	it("names a preset in the language, still found by its English name and terms", () => {
		const [room] = localizePresets([ROOM], {
			presets: {
				"indoor/room": {
					name: "Pièce",
					terms: ["chambre"],
					aliases: ["Salle"],
				},
			},
		});
		expect(room).toMatchObject({
			name: "Pièce",
			aliases: ["Salle"],
			terms: ["chambre", "Room", "chamber"],
			tags: { indoor: "room" },
		});
	});

	it("keeps English where the translation has nothing", () => {
		expect(localizePresets([ROOM], { presets: {} })).toEqual([ROOM]);
		expect(localizeFields([FIELD], {})).toEqual([FIELD]);
	});

	it("translates a field's label, options and rows, option by option", () => {
		const [field] = localizeFields([FIELD], {
			fields: {
				access: {
					label: "Accès autorisé",
					options: {
						yes: {
							title: "Autorisé",
							description: "Accès autorisé par la loi",
						},
						no: "Interdit",
					},
					types: { foot: "Piétons" },
				},
			},
		});
		expect(field?.label).toBe("Accès autorisé");
		expect(field?.options).toEqual([
			{
				value: "yes",
				label: "Autorisé",
				description: "Accès autorisé par la loi",
			},
			{ value: "no", label: "Interdit" },
			{ value: "private", label: "Private" },
		]);
		expect(field?.types).toEqual({ foot: "Piétons", bicycle: "Cyclists" });
	});

	it("names categories", () => {
		expect(
			localizeCategories(
				[{ id: "category-building", name: "Building Features", members: [] }],
				{ categories: { "category-building": "Bâtiments" } },
			),
		).toEqual([{ id: "category-building", name: "Bâtiments", members: [] }]);
	});
});
