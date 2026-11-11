import { describe, expect, it } from "vitest";
import { defaultNumbering, numberedEntry } from "./floor-numbering.ts";

describe("defaultNumbering", () => {
	it("counts from the ground floor in the UK and Europe, from 1 in North America and Russia", () => {
		expect(defaultNumbering("en-GB")).toBe("from-0");
		expect(defaultNumbering("de-DE")).toBe("from-0");
		expect(defaultNumbering("fr")).toBe("from-0");
		expect(defaultNumbering("en-US")).toBe("from-1");
		expect(defaultNumbering("fr-CA")).toBe("from-1");
		expect(defaultNumbering("ru")).toBe("from-1");
		expect(defaultNumbering("ja-JP")).toBe("from-1");
	});

	it("falls back to OSM's own counting for a locale it can't read", () => {
		expect(defaultNumbering("not a locale!")).toBe("from-0");
	});
});

describe("numberedEntry", () => {
	it("names level 0 the ground floor when counting from 0", () => {
		expect(numberedEntry({ level: 0 }, "from-0")).toEqual({
			level: 0,
			ref: "G",
			name: "Ground floor",
		});
		expect(numberedEntry({ level: 2 }, "from-0")).toEqual({
			level: 2,
			ref: "2",
			name: "Floor 2",
		});
	});

	it("adds one above ground when counting from 1, and leaves basements alone", () => {
		expect(numberedEntry({ level: 0 }, "from-1")).toEqual({
			level: 0,
			ref: "1",
			name: "Floor 1",
		});
		expect(numberedEntry({ level: 0.5 }, "from-1").ref).toBe("1.5");
		expect(numberedEntry({ level: -1 }, "from-1")).toEqual({
			level: -1,
			ref: "-1",
			name: "Floor -1",
		});
	});

	it("keeps the names mappers gave", () => {
		const named = { level: 0, ref: "EG" };
		expect(numberedEntry(named, "from-1")).toBe(named);
		expect(numberedEntry({ level: 1, name: "Mezzanine" }, "from-0")).toEqual({
			level: 1,
			name: "Mezzanine",
		});
	});
});
