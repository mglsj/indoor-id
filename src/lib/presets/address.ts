/**
 * iD's address field (`ui/fields/address.js`): its rows, and the values suggested from the data
 * around the feature (streets, places, cities and postcodes near it; house numbers of the
 * building it is in).
 */
import type { Entity, EntityId, Loc } from "#lib/osm/entity.ts";
import {
	distanceToLine,
	extentOf,
	isClosedRing,
	pointInRing,
	wayLocs,
} from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";

/** iD's default address format, used everywhere (IndoorID doesn't know the country). */
export const ADDRESS_ROWS: readonly (readonly string[])[] = [
	["housenumber", "street"],
	["city", "postcode"],
];

/** Share of a row each part takes (iD's default widths). */
export const ADDRESS_WIDTHS: Readonly<Record<string, number>> = {
	housenumber: 1 / 5,
	street: 1 / 2,
	city: 2 / 3,
	postcode: 1 / 3,
};

export interface AddressSuggestion {
	readonly value: string;
	/** Metres from the feature. */
	readonly distance: number;
}

/** Points of an entity (a way's nodes), or none for a relation or a missing node. */
function points(graph: Graph, entity: Entity): Loc[] {
	if (entity.type === "node") return [entity.loc];
	if (entity.type === "way") return wayLocs(graph, entity);
	return [];
}

const isClosedWay = (entity: Entity) =>
	entity.type === "way" && isClosedRing(entity);

/**
 * Values for a part of the address (`street`, `place`, `city`, `postcode`, `housenumber`…) taken
 * from the data around the feature, the nearest first, each once.
 */
export function addressSuggestions(
	graph: Graph,
	id: EntityId,
	part: string,
	key = "addr",
): AddressSuggestion[] {
	const entity = graph.entity(id);
	const box = entity && extentOf(points(graph, entity));
	if (!entity || !box) return [];
	const center: Loc = [(box.west + box.east) / 2, (box.south + box.north) / 2];
	const tagKey = `${key}:${part}`;
	const others = [...graph.entities()].filter((e) => e.id !== id);

	/** Features matching `test` within `radius` metres, with their value. */
	const near = (
		test: (e: Entity) => boolean,
		value: (e: Entity) => string | undefined,
		radius = 200,
	): AddressSuggestion[] =>
		others.flatMap((e) => {
			const v = test(e) ? value(e) : undefined;
			const locs = v ? points(graph, e) : [];
			if (!v || locs.length === 0) return [];
			const distance = distanceToLine(center, locs);
			return distance <= radius ? [{ value: v, distance }] : [];
		});

	/** Closed ways around the whole feature. */
	const around = (test: (e: Entity) => boolean) =>
		others.filter((e) => {
			if (!test(e) || !isClosedWay(e)) return false;
			const ring = points(graph, e);
			const { west, south, east, north } = box;
			return (
				[
					[west, south],
					[east, south],
					[east, north],
					[west, north],
				] as Loc[]
			).every((corner) => pointInRing(corner, ring));
		});

	let found: AddressSuggestion[];
	switch (part) {
		case "street":
			found = near(
				(e) => e.type === "way" && !!e.tags.highway && !!e.tags.name,
				(e) => e.tags.name,
			);
			break;
		case "place":
			found = near(
				(e) =>
					!!e.tags.name &&
					(!!e.tags.place ||
						(e.tags.boundary === "administrative" &&
							Number(e.tags.admin_level) > 8)),
				(e) => e.tags.name,
			);
			break;
		case "city":
			found = near(
				(e) =>
					!!e.tags[tagKey] ||
					(!!e.tags.name &&
						((e.tags.boundary === "administrative" &&
							e.tags.admin_level === "8") ||
							e.tags.border_type === "city" ||
							["city", "town", "village", "hamlet"].includes(
								e.tags.place ?? "",
							))),
				(e) => e.tags[tagKey] ?? e.tags.name,
			);
			break;
		case "postcode":
			found = [
				...near(
					(e) => !!e.tags[tagKey],
					(e) => e.tags[tagKey],
				),
				...near(
					(e) => !!e.tags.postal_code,
					(e) => e.tags.postal_code,
				),
			];
			break;
		case "housenumber":
		case "housename": {
			// The addresses of the areas the feature is in, and of points in the same building.
			const enclosing = around((e) => !!e.tags[tagKey]).map((e) => ({
				value: e.tags[tagKey] as string,
				distance: 0,
			}));
			const buildings = around(
				(e) => !!e.tags.building && e.tags.building !== "no",
			).map((e) => points(graph, e));
			const inBuilding = near(
				(e) =>
					e.type === "node" &&
					!!e.tags[tagKey] &&
					buildings.some(
						(ring) => pointInRing(e.loc, ring) || ring.includes(e.loc),
					),
				(e) => e.tags[tagKey],
				100,
			);
			return unique([...enclosing, ...inBuilding]).sort((a, b) =>
				a.value > b.value ? 1 : -1,
			);
		}
		default:
			found = near(
				(e) => !!e.tags[tagKey],
				(e) => e.tags[tagKey],
			);
	}
	return unique(found.sort((a, b) => a.distance - b.distance));
}

function unique(list: AddressSuggestion[]): AddressSuggestion[] {
	const seen = new Set<string>();
	return list.filter((s) => !seen.has(s.value) && seen.add(s.value));
}
