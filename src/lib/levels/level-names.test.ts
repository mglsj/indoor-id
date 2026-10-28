import { describe, expect, it } from "vitest";
import {
	buildingLevelRefs,
	explicitLevels,
	fullLabel,
	type LevelSources,
	levelList,
	nonExistentLevels,
	outlineLevelName,
	shortLabel,
} from "./level-names.ts";
import { formatLevels } from "./levels.ts";

describe("outlineLevelName", () => {
	it("reads level:ref and name of an indoor=level outline", () => {
		expect(
			outlineLevelName({
				indoor: "level",
				level: "0",
				"level:ref": "EG",
				name: "Erdgeschoss",
			}),
		).toEqual({ level: 0, ref: "EG", name: "Erdgeschoss" });
		expect(
			outlineLevelName({ indoor: "level", level: "-1", "level:ref": "U1" }),
		).toEqual({ level: -1, ref: "U1" });
	});

	it("ignores outlines on several levels, without names, or not indoor=level", () => {
		expect(
			outlineLevelName({ indoor: "level", level: "0;1", "level:ref": "G" }),
		).toBeNull();
		expect(
			outlineLevelName({ indoor: "level", level: "0-1", "level:ref": "G" }),
		).toBeNull();
		expect(outlineLevelName({ indoor: "level", level: "0" })).toBeNull();
		expect(
			outlineLevelName({ indoor: "room", level: "0", "level:ref": "G" }),
		).toBeNull();
		expect(
			outlineLevelName({ indoor: "level", level: "G", "level:ref": "G" }),
		).toBeNull();
	});
});

describe("buildingLevelRefs", () => {
	it("reads building:levels:ref from the lowest floor when it names every floor", () => {
		// The wiki's sample value.
		expect(
			buildingLevelRefs({
				building: "yes",
				"building:levels": "3",
				"building:levels:ref": "Rez;1;2",
			}),
		).toEqual(
			new Map([
				[0, "Rez"],
				[1, "1"],
				[2, "2"],
			]),
		);
		expect(
			buildingLevelRefs({
				building: "yes",
				"building:levels": "2",
				"building:levels:underground": "1",
				"building:levels:ref": "UG;EG;1.OG",
			}),
		).toEqual(
			new Map([
				[-1, "UG"],
				[0, "EG"],
				[1, "1.OG"],
			]),
		);
	});

	it("doesn't guess which floor a name of an incomplete list belongs to", () => {
		expect(
			buildingLevelRefs({
				building: "yes",
				"building:levels": "5",
				"building:levels:ref": "Rez;1;2",
			}),
		).toEqual(new Map());
		expect(
			buildingLevelRefs({ building: "yes", "building:levels:ref": "Rez;1" }),
		).toEqual(new Map());
	});

	it("reads building:levels:ref:equivalent, which wins over the list", () => {
		expect(
			buildingLevelRefs({
				building: "yes",
				"building:levels:ref:equivalent": "1=level 0;2=level 1; D = level 3",
			}),
		).toEqual(
			new Map([
				[0, "1"],
				[1, "2"],
				[3, "D"],
			]),
		);
		expect(
			buildingLevelRefs({
				building: "yes",
				"building:levels": "2",
				"building:levels:ref": "A;B",
				"building:levels:ref:equivalent": "G=level 0",
			}),
		).toEqual(
			new Map([
				[0, "G"],
				[1, "B"],
			]),
		);
	});
});

describe("nonExistentLevels", () => {
	it("reads non_existent_levels as levels", () => {
		const levels = nonExistentLevels({ non_existent_levels: "4;13" });
		expect(levels && formatLevels(levels)).toBe("4;13");
		expect(nonExistentLevels({ non_existent_levels: "thirteen" })).toBeNull();
		expect(nonExistentLevels({})).toBeNull();
	});
});

describe("explicitLevels", () => {
	it("lists single levels and the ends of ranges", () => {
		expect(explicitLevels({ level: "1-15" })).toEqual([1, 15]);
		expect(explicitLevels({ level: "0;13", repeat_on: "2-3" })).toEqual([
			0, 13, 2, 3,
		]);
		expect(explicitLevels({ level: "G" })).toEqual([]);
	});
});

function sources(partial: Partial<LevelSources>): LevelSources {
	return {
		levels: [],
		explicit: new Set(),
		names: new Map(),
		nonExistent: [],
		...partial,
	};
}

describe("levelList", () => {
	it("gives a button to levels missing between known ones", () => {
		expect(
			levelList(sources({ levels: [0, 1, 3] })).map((e) => e.level),
		).toEqual([0, 1, 2, 3]);
		expect(
			levelList(sources({ levels: [-1, 0.5, 2] })).map((e) => e.level),
		).toEqual([-1, 0, 0.5, 1, 2]);
	});

	it("doesn't fill a gap of a hundred levels", () => {
		expect(
			levelList(sources({ levels: [0, 1, 150] })).map((e) => e.level),
		).toEqual([0, 1, 150]);
	});

	it("skips non-existent levels that no feature names", () => {
		const nonExistent = [[{ min: 13, max: 13 }]];
		// An elevator on 12-14 doesn't make 13 exist.
		expect(
			levelList(
				sources({
					levels: [12, 13, 14],
					explicit: new Set([12, 14]),
					nonExistent,
				}),
			).map((e) => e.level),
		).toEqual([12, 14]);
		// A room tagged level=13 is shown (and flagged by the validator).
		expect(
			levelList(
				sources({ levels: [12, 13], explicit: new Set([12, 13]), nonExistent }),
			).map((e) => e.level),
		).toEqual([12, 13]);
	});

	it("attaches names", () => {
		expect(
			levelList(
				sources({ levels: [0, 1], names: new Map([[1, { ref: "1.OG" }]]) }),
			),
		).toEqual([{ level: 0 }, { level: 1, ref: "1.OG" }]);
	});
});

describe("labels", () => {
	it("shows level:ref, else the name, else the number", () => {
		expect(shortLabel({ level: 0, ref: "EG", name: "Erdgeschoss" })).toBe("EG");
		expect(shortLabel({ level: 0, name: "Lobby" })).toBe("Lobby");
		expect(shortLabel({ level: -1 })).toBe("-1");
	});

	it("shortens long names", () => {
		expect(shortLabel({ level: 0, ref: "Untere Verkaufsebene" })).toBe(
			"Unter…",
		);
		expect(shortLabel({ level: 0, ref: "Ebene" })).toBe("Ebene");
	});

	it("describes a level in full", () => {
		expect(fullLabel({ level: 0, ref: "EG", name: "Erdgeschoss" })).toBe(
			"EG · Erdgeschoss · level 0",
		);
		expect(fullLabel({ level: 1, ref: "1", name: "1" })).toBe("1 · level 1");
		expect(fullLabel({ level: 2 })).toBe("Level 2");
	});
});
