import { describe, expect, it } from "vitest";
import { changesetTags } from "./changeset.ts";

describe("changesetTags", () => {
	it("describes the changeset", () => {
		expect(
			changesetTags({
				comment: "  Add room numbers in the library  ",
				source: "survey",
				imagery: ["Bing aerial imagery", "Esri World Imagery"],
				reviewRequested: true,
			}),
		).toEqual({
			comment: "Add room numbers in the library",
			source: "survey",
			imagery_used: "Bing aerial imagery;Esri World Imagery",
			review_requested: "yes",
		});
	});

	it("names floor plans as custom imagery, never by their file names", () => {
		expect(
			changesetTags({
				comment: "Rooms from the fire plan",
				source: "survey",
				imagery: ["Esri World Imagery"],
				floorPlans: true,
				reviewRequested: false,
			}),
		).toEqual({
			comment: "Rooms from the fire plan",
			source: "survey;custom imagery",
			imagery_used: "Esri World Imagery;Custom",
		});
		expect(
			changesetTags({
				comment: "Rooms",
				imagery: [],
				floorPlans: true,
				reviewRequested: false,
			}),
		).toMatchObject({ source: "custom imagery", imagery_used: "Custom" });
	});

	it("leaves out what wasn't given", () => {
		expect(
			changesetTags({
				comment: "Fix doors",
				source: " ",
				imagery: [],
				reviewRequested: false,
			}),
		).toEqual({ comment: "Fix doors" });
	});

	it("lists the hashtags of the comment", () => {
		expect(
			changesetTags({
				comment: "Map the campus #indoor #UniCampus2026",
				imagery: [],
				reviewRequested: false,
			}),
		).toMatchObject({ hashtags: "#indoor;#UniCampus2026" });
	});

	it("cuts values to the 255 characters OSM accepts", () => {
		const tags = changesetTags({
			comment: "x".repeat(300),
			imagery: [],
			reviewRequested: false,
		});
		expect(tags.comment).toHaveLength(255);
	});
});
