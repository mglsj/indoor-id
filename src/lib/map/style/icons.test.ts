import { describe, expect, it } from "vitest";
import { iconFor } from "../classify.ts";
import { AVAILABLE_ICONS } from "./icons.ts";

describe("map icons", () => {
	it("have an icon for each safety and laundry point the forum asked for (#169)", () => {
		const icon = (tags: Record<string, string>) =>
			iconFor(tags, AVAILABLE_ICONS);
		expect(icon({ emergency: "fire_extinguisher" })).toBe(
			"emergency_fire_extinguisher",
		);
		expect(icon({ emergency: "fire_hose" })).toBe("emergency_fire_hose");
		expect(icon({ emergency: "fire_alarm_box" })).toBe(
			"emergency_fire_alarm_box",
		);
		expect(icon({ emergency: "first_aid_kit" })).toBe(
			"emergency_first_aid_kit",
		);
		expect(icon({ emergency: "fire_hydrant" })).toBe("emergency_fire_hydrant");
		expect(icon({ amenity: "dryer" })).toBe("amenity_dryer");
		expect(icon({ amenity: "washing_machine" })).toBe(
			"amenity_washing_machine",
		);
	});
});
