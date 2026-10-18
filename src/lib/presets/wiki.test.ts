import { describe, expect, it } from "vitest";
import type { Field, Preset } from "./presets.ts";
import {
	fieldReference,
	parseWikipediaTag,
	parseWikipediaUrl,
	presetReference,
	wikipediaLanguage,
	wikipediaUrl,
} from "./wiki.ts";

describe("wikipedia tags, as iD's wikipedia field reads them", () => {
	it("are a language, a title and maybe a section", () => {
		expect(parseWikipediaTag("fr:Musée du Louvre#Histoire")).toEqual({
			lang: "fr",
			title: "Musée du Louvre",
			anchor: "Histoire",
		});
		expect(parseWikipediaTag("Louvre")).toBeNull();
	});

	it("link to the article", () => {
		expect(wikipediaUrl("fr", "Musée du Louvre", "Les collections")).toBe(
			"https://fr.wikipedia.org/wiki/Mus%C3%A9e_du_Louvre#Les_collections",
		);
	});

	it("can be pasted as the article's address", () => {
		expect(
			parseWikipediaUrl(
				"https://fr.wikipedia.org/wiki/mus%C3%A9e_du_Louvre#Histoire",
			),
		).toEqual({ lang: "fr", title: "Musée du Louvre#Histoire" });
		expect(parseWikipediaUrl("Musée du Louvre")).toBeNull();
	});
});

describe("wikipediaLanguage", () => {
	const sites: [string, string, string][] = [
		["English", "English", "en"],
		["French", "français", "fr"],
	];
	it("is found by English name, own name or code", () => {
		expect(wikipediaLanguage(sites, "French")?.[2]).toBe("fr");
		expect(wikipediaLanguage(sites, "Français")?.[2]).toBe("fr");
		expect(wikipediaLanguage(sites, "fr")?.[2]).toBe("fr");
		expect(wikipediaLanguage(sites, "Klingon")).toBeUndefined();
	});
});

const field = (extra: Partial<Field>): Field => ({
	id: "f",
	key: "f",
	type: "text",
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

describe("references (what ⓘ documents), as iD's", () => {
	it("are a field's key and its value", () => {
		expect(fieldReference(field({ key: "room" }), { room: "office" })).toEqual({
			key: "room",
			value: "office",
		});
		expect(fieldReference(field({ key: "room" }), {})).toEqual({ key: "room" });
	});

	it("are a multiCombo's keys, or what the field says", () => {
		expect(
			fieldReference(field({ key: "payment:", type: "multiCombo" }), {}),
		).toEqual({ key: "payment:*" });
		expect(
			fieldReference(field({ key: "addr", reference: { key: "addr:*" } }), {}),
		).toEqual({ key: "addr:*" });
		expect(fieldReference(field({ key: undefined }), {})).toBeNull();
	});

	it("are a type's main tag, or its key when any value goes", () => {
		const preset = (
			tags: Record<string, string>,
			extra: Partial<Preset> = {},
		) =>
			({
				id: "p",
				name: "P",
				terms: [],
				geometry: ["area"],
				tags,
				fields: [],
				moreFields: [],
				...extra,
			}) as Preset;
		expect(presetReference(preset({ indoor: "room" }))).toEqual({
			key: "indoor",
			value: "room",
		});
		expect(presetReference(preset({ name: "X", shop: "*" }))).toEqual({
			key: "shop",
		});
		expect(
			presetReference(
				preset({ amenity: "toilets" }, { reference: { key: "toilets" } }),
			),
		).toEqual({ key: "toilets" });
	});
});
