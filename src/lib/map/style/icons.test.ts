import { describe, expect, it } from "vitest";
import presets from "../../presets/generated/presets.json" with {
	type: "json",
};
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

	it("bundle every icon set the presets name, as iD does", () => {
		const missing = (presets as { icon?: string }[])
			.map((p) => p.icon)
			.filter((icon): icon is string => icon !== undefined)
			.filter((icon) => !AVAILABLE_ICONS.has(icon));
		// Pinhead 16.26 lacks four icons iD's schema names.
		expect(new Set(missing)).toEqual(
			new Set([
				"pinhead-person_wearing_martial_arts_belt_front_kicking",
				"pinhead-bagel_seeded",
				"pinhead-person_squatting_and_person_reaching_up",
				"pinhead-person_running_after_person",
			]),
		);
		for (const icon of [
			"iD-highway-steps",
			"fas-users",
			"far-credit-card",
			"roentgen-food_court",
			"pinhead-baby",
		]) {
			expect(AVAILABLE_ICONS.has(icon)).toBe(true);
		}
	});
});
