import { describe, expect, it } from "vitest";
import {
	languageCode,
	languageName,
	languageOptions,
	translationPatch,
	translations,
} from "./localized.ts";
import type { Field } from "./presets.ts";

const name: Field = {
	id: "name",
	key: "name",
	type: "localized",
	label: "Name",
	options: [],
	terms: [],
	universal: true,
	snakeCase: true,
	caseSensitive: false,
	customValues: true,
	autoSuggestions: true,
	allowDuplicates: false,
};

describe("translations of a localized field", () => {
	it("are its key in other languages, not other suffixes", () => {
		expect(
			translations(name, {
				name: "Gare",
				"name:fr": "Gare",
				"name:zh-Hant": "車站",
				"name:left": "Ouest",
				"name:etymology:wikidata": "Q1",
				"alt_name:de": "Bahnhof",
			}),
		).toEqual([
			{ lang: "fr", value: "Gare" },
			{ lang: "zh-Hant", value: "車站" },
		]);
	});
});

describe("languages", () => {
	it("are named in English, by their code", () => {
		expect(languageName("de")).toBe("German");
		expect(languageName("zh-Hant")).toBe("Traditional Chinese");
		expect(languageName("xx")).toBe("xx");
	});

	it("are found by English name, own name or code", () => {
		expect(languageCode("German")).toBe("de");
		expect(languageCode("deutsch")).toBe("de");
		expect(languageCode("DE")).toBe("de");
		// Something else is a code, in lowercase (iD #7156).
		expect(languageCode("Gsw")).toBe("gsw");
	});

	it("are offered by name, with their own name", () => {
		const german = languageOptions().find((l) => l.code === "de");
		expect(german).toEqual({ code: "de", label: "German", native: "Deutsch" });
	});
});

describe("translationPatch", () => {
	it("sets the name in a language", () => {
		expect(translationPatch(name, undefined, "fr", "Gare")).toEqual({
			"name:fr": "Gare",
		});
	});

	it("moves the name to another language", () => {
		expect(translationPatch(name, "fr", "de", "Bahnhof")).toEqual({
			"name:fr": undefined,
			"name:de": "Bahnhof",
		});
	});

	it("removes it when emptied", () => {
		expect(translationPatch(name, "fr", "fr", "")).toEqual({
			"name:fr": undefined,
		});
	});
});
