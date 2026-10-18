import { describe, expect, it } from "vitest";
import type { Field } from "./presets.ts";
import {
	canStep,
	charCount,
	cleanValue,
	externalLink,
	isDateLike,
	numberValue,
	stepNumber,
	textPatch,
	textValue,
} from "./text.ts";

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

describe("cleanValue, as iD's cleanTagValue", () => {
	it("trims, uses the canonical form, and keeps 255 characters", () => {
		expect(cleanValue("  Café  ")).toBe("Café");
		expect(cleanValue("Café")).toBe("Café");
		expect(cleanValue("é".repeat(300))).toHaveLength(255);
		// Characters, not UTF-16 units.
		expect(charCount("🍕🍕")).toBe(2);
		expect(Array.from(cleanValue("🍕".repeat(300)))).toHaveLength(255);
	});
});

const phone = field({
	key: "phone",
	keys: ["phone", "contact:phone"],
	type: "tel",
});

describe("text fields with several keys (phone or contact:phone)", () => {
	it("show the key that is set", () => {
		expect(textValue(phone, { "contact:phone": "+33 1" })).toEqual({
			value: "+33 1",
			mixed: false,
		});
		expect(textValue(phone, { phone: "1", "contact:phone": "2" })).toEqual({
			value: "",
			mixed: true,
		});
	});

	it("write to the keys set, or to the field's key", () => {
		expect(textPatch(phone, { "contact:phone": "1" }, "2")).toEqual({
			"contact:phone": "2",
		});
		expect(textPatch(phone, {}, "2")).toEqual({ phone: "2" });
		expect(textPatch(phone, { phone: "1" }, "")).toEqual({ phone: undefined });
	});
});

const height = field({ key: "height", type: "number", minValue: 0 });

describe("number fields, as iD's", () => {
	it("keep the decimals typed and stay within the field's bounds", () => {
		expect(numberValue(height, "12.50")).toBe("12.50");
		expect(numberValue(height, "-3")).toBe("0");
		expect(numberValue(height, "2;-1.5")).toBe("2;0.0");
	});

	it("leave what isn't a number as typed", () => {
		expect(numberValue(height, "3 m")).toBe("3 m");
		expect(numberValue(height, "1,5")).toBe("1,5");
	});

	it("step each number of a list by the field's increment", () => {
		expect(stepNumber(height, "2.5", 1)).toBe("3.5");
		expect(stepNumber(height, "", 1)).toBe("1");
		expect(stepNumber(height, "", -1)).toBe("0");
		expect(stepNumber(height, "1;x", 1)).toBe("2;x");
		expect(stepNumber(field({ type: "number", increment: 5 }), "10", 5)).toBe(
			"15",
		);
	});

	it("turn compass points into degrees for a direction, and go round", () => {
		const direction = field({ key: "camera:direction", type: "number" });
		expect(stepNumber(direction, "N", -1)).toBe("359");
		expect(stepNumber(direction, "359", 1)).toBe("0");
	});

	it("can only step a value with a number in it", () => {
		expect(canStep(height, undefined)).toBe(true);
		expect(canStep(height, "2;x")).toBe(true);
		expect(canStep(height, "tall")).toBe(false);
	});
});

describe("externalLink", () => {
	it("opens a website", () => {
		const url = field({ key: "website", type: "url" });
		expect(externalLink(url, "https://example.org/a")).toBe(
			"https://example.org/a",
		);
		expect(externalLink(url, "example.org")).toBeNull();
	});

	it("builds an identifier's link from its pattern", () => {
		const facebook = field({
			key: "contact:facebook",
			type: "identifier",
			urlFormat: "https://www.facebook.com/{value}",
			pattern: "^[a-zA-Z0-9.]+$",
		});
		expect(externalLink(facebook, "LocalBusiness")).toBe(
			"https://www.facebook.com/LocalBusiness",
		);
		expect(externalLink(facebook, "https://www.facebook.com/x")).toBe(
			"https://www.facebook.com/x",
		);
		expect(externalLink(facebook, "not valid!")).toBeNull();
	});

	it("edits opening hours in YoHours", () => {
		expect(externalLink(field({ type: "schedule" }), "Mo-Fr 08:00-18:00")).toBe(
			"https://projets.pavie.info/yohours/?oh=Mo-Fr%2008%3A00-18%3A00",
		);
	});
});

describe("isDateLike", () => {
	it("accepts a year, a month or a day", () => {
		expect(["2024", "2024-03", "2024-03-15"].every(isDateLike)).toBe(true);
		expect(["15/03/2024", "2024-3-15", "~1900"].some(isDateLike)).toBe(false);
	});
});

describe("textValue over several features", () => {
	it("is mixed when the features' values of a key differ", () => {
		const phone: Field = {
			...({} as Field),
			id: "phone",
			key: "phone",
			keys: ["phone", "contact:phone"],
			type: "tel",
			label: "Phone",
			options: [],
		};
		const mixed = new Map([["phone", ["1", undefined]]]);
		expect(textValue(phone, {}, mixed)).toEqual({ value: "", mixed: true });
		expect(textValue(phone, { "contact:phone": "2" })).toEqual({
			value: "2",
			mixed: false,
		});
	});
});
