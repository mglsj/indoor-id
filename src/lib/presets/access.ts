/**
 * iD's access field (`ui/fields/access.js`): one row per kind of traffic, with the usual values
 * and, when nothing is set, the access implied by the other tags as a placeholder.
 */
import type { Tags } from "#lib/osm/tags.ts";
import type { Field, FieldOption } from "./presets.ts";

const VALUES = [
	"yes",
	"no",
	"designated",
	"permissive",
	"destination",
	"customers",
	"private",
	"permit",
	"unknown",
];

/** Values offered for one kind of traffic (`foot`), shown as they are, with descriptions. */
export function accessOptions(field: Field, type: string): FieldOption[] {
	let values = [...VALUES];
	if (type === "access")
		values = values.filter((v) => v !== "yes" && v !== "designated");
	if (type === "bicycle") values.splice(values.length - 4, 0, "dismount");
	return values.map((value) => {
		const description = field.options.find(
			(o) => o.value === value,
		)?.description;
		return { value, label: value, ...(description ? { description } : {}) };
	});
}

/** Access by road or barrier type, when not tagged (iD's `placeholdersByTag`). */
const IMPLIED: Record<string, Record<string, Record<string, string>>> = {
	highway: {
		footway: { foot: "designated", motor_vehicle: "no" },
		steps: { foot: "yes", motor_vehicle: "no", bicycle: "no", horse: "no" },
		ladder: { foot: "yes", motor_vehicle: "no", bicycle: "no", horse: "no" },
		pedestrian: { foot: "yes", motor_vehicle: "no" },
		living_street: { foot: "yes" },
		cycleway: { motor_vehicle: "no", bicycle: "designated" },
		bridleway: { motor_vehicle: "no", horse: "designated" },
		path: { foot: "yes", motor_vehicle: "no", bicycle: "yes", horse: "yes" },
		motorway: { foot: "no", motor_vehicle: "yes", bicycle: "no", horse: "no" },
		trunk: { motor_vehicle: "yes" },
		primary: {
			foot: "yes",
			motor_vehicle: "yes",
			bicycle: "yes",
			horse: "yes",
		},
		secondary: {
			foot: "yes",
			motor_vehicle: "yes",
			bicycle: "yes",
			horse: "yes",
		},
		tertiary: {
			foot: "yes",
			motor_vehicle: "yes",
			bicycle: "yes",
			horse: "yes",
		},
		residential: {
			foot: "yes",
			motor_vehicle: "yes",
			bicycle: "yes",
			horse: "yes",
		},
		unclassified: {
			foot: "yes",
			motor_vehicle: "yes",
			bicycle: "yes",
			horse: "yes",
		},
		service: {
			foot: "yes",
			motor_vehicle: "yes",
			bicycle: "yes",
			horse: "yes",
		},
		motorway_link: {
			foot: "no",
			motor_vehicle: "yes",
			bicycle: "no",
			horse: "no",
		},
		trunk_link: { motor_vehicle: "yes" },
		primary_link: {
			foot: "yes",
			motor_vehicle: "yes",
			bicycle: "yes",
			horse: "yes",
		},
		secondary_link: {
			foot: "yes",
			motor_vehicle: "yes",
			bicycle: "yes",
			horse: "yes",
		},
		tertiary_link: {
			foot: "yes",
			motor_vehicle: "yes",
			bicycle: "yes",
			horse: "yes",
		},
		construction: { access: "no" },
		busway: { access: "no", bus: "designated", emergency: "yes" },
	},
	barrier: {
		bollard: { access: "no", bicycle: "yes", foot: "yes" },
		bus_trap: { motor_vehicle: "no", psv: "yes", foot: "yes", bicycle: "yes" },
		city_wall: { access: "no" },
		coupure: { access: "yes" },
		cycle_barrier: { motor_vehicle: "no" },
		ditch: { access: "no" },
		entrance: { access: "yes" },
		fence: { access: "no" },
		hedge: { access: "no" },
		jersey_barrier: { access: "no" },
		motorcycle_barrier: { motor_vehicle: "no" },
		rail_guard: { access: "no" },
	},
};

/** The access of `type` the tags imply when it isn't set, or the field's placeholder. */
export function accessPlaceholder(
	field: Field,
	tags: Tags,
	type: string,
): string {
	const set = tags[type];
	if (set) return set;
	if (tags.motorroad === "yes" && ["foot", "bicycle", "horse"].includes(type)) {
		return "no";
	}
	if (tags.vehicle && (type === "bicycle" || type === "motor_vehicle")) {
		return tags.vehicle;
	}
	if (tags.access) return tags.access;
	for (const [key, byValue] of Object.entries(IMPLIED)) {
		const value = tags[key];
		const implied = value ? byValue[value]?.[type] : undefined;
		if (implied) return implied;
	}
	if (type === "access" && !tags.barrier) return "yes";
	return field.placeholder ?? "";
}
