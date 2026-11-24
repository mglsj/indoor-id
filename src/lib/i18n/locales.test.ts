import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkTranslation } from "./locales.ts";
import { locales } from "./paraglide/runtime.js";

const plural = (one: string, other: string) => [
	{
		declarations: ["input count", "local countPlural = count: plural"],
		selectors: ["countPlural"],
		match: { "countPlural=one": one, "countPlural=*": other },
	},
];

describe("checkTranslation", () => {
	const english = {
		save: "Save",
		issue_count: plural("{count} issue", "{count} issues"),
		level_name: "Level {level}",
	};

	it("takes the English keys, as text or plural variants", () => {
		expect(
			checkTranslation(english, {
				$schema: "x",
				save: "Enregistrer",
				issue_count: [
					{
						declarations: ["input count", "local countPlural = count: plural"],
						selectors: ["countPlural"],
						match: {
							"countPlural=one": "{count} problém",
							"countPlural=few": "{count} problémy",
							"countPlural=*": "{count} problémů",
						},
					},
				],
				level_name: "Étage",
			}),
		).toEqual([]);
	});

	it("finds unknown keys, unknown params and values that aren't messages", () => {
		expect(
			checkTranslation(english, {
				open: "Ouvrir",
				level_name: "Étage {name}",
				issue_count: plural("{n} problème", "{count} problèmes"),
				save: 3,
			}),
		).toEqual([
			"open: no such message in English",
			"level_name: unknown {name}",
			"issue_count: unknown {n}",
			"save: not text or variants",
		]);
	});

	it("passes for every translation shipped, one per language offered", () => {
		const dir = new URL("../../../messages/", import.meta.url);
		const read = (file: string) =>
			JSON.parse(readFileSync(new URL(file, dir), "utf8"));
		const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
		expect(files.sort()).toEqual(locales.map((l) => `${l}.json`).sort());
		for (const file of files) {
			expect([file, checkTranslation(read("en.json"), read(file))]).toEqual([
				file,
				[],
			]);
		}
	});
});
