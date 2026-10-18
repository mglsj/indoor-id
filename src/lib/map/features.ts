/**
 * Turns the OSM graph into the GeoJSON drawn by the map. Each feature carries its tags plus:
 * - `@id`: the entity id (`w12`), used as the MapLibre feature id;
 * - `@lv`: the known levels it is on, as `;-1;0;0.5;`, or `*` when it has no level, so that a
 *   level switch is a filter change (`levelFilter`) rather than a data rebuild.
 */
import type {
	Feature,
	FeatureCollection,
	Geometry,
	MultiPolygon,
	Position,
} from "geojson";
import { featureLevels } from "#lib/levels/feature-levels.ts";
import { isOnLevel, type Levels } from "#lib/levels/levels.ts";
import { entityGeometry, isArea } from "#lib/osm/area.ts";
import type { Entity, NodeId, Relation, Way } from "#lib/osm/entity.ts";
import { isClosedRing, pointInRing } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { hasInterestingTags, type Tags } from "#lib/osm/tags.ts";
import type { Preset, PresetIndex } from "#lib/presets/presets.ts";
import {
	classify,
	type GeometryType,
	iconFor,
	isBuildingOutline,
	isRestricted,
	labelFor,
} from "./classify.ts";
import type { FilterSpecification } from "./maplibre.ts";

export type FeatureProperties = Tags & { "@id": string; "@lv": string };
export type IndoorFeature = Feature<Geometry, FeatureProperties>;

export interface IndoorFeatures {
	readonly collection: FeatureCollection<Geometry, FeatureProperties>;
	/** Every level present in the data, sorted, including levels inside ranges. */
	readonly levels: number[];
}

export interface BuildOptions {
	/** Names of the icons the map can show (see `iconFor`). */
	readonly icons?: ReadonlySet<string>;
	/** Presets, whose icons the map shows when it has them. */
	readonly presets?: Pick<PresetIndex, "match">;
}

export function buildFeatures(
	graph: Graph,
	options: BuildOptions = {},
): IndoorFeatures {
	const drafts: FeatureDraft[] = [];
	for (const entity of graph.entities()) {
		const draft = draftOf(graph, entity, options);
		if (draft) drafts.push(draft);
	}
	const levels = knownLevels(drafts.map((d) => d.levels));
	const features = drafts.map((draft) => encodeFeature(draft, levels));
	return { collection: { type: "FeatureCollection", features }, levels };
}

/** A feature before its `@lv`, which depends on the levels of the whole data. */
export interface FeatureDraft {
	readonly id: string;
	readonly geometry: Geometry;
	readonly properties: Tags;
	readonly levels: Levels | null;
}

/** An entity's feature without its `@lv`, or null when it isn't drawn. */
export function draftOf(
	graph: Graph,
	entity: Entity,
	{ icons = NO_ICONS, presets }: BuildOptions,
): FeatureDraft | null {
	const geometry = geometryOf(graph, entity);
	if (!geometry) return null;
	const preset = presets?.match(entity.tags, entityGeometry(graph, entity));
	return {
		id: entity.id,
		geometry,
		properties: {
			...entity.tags,
			...drawingProperties(
				entity.tags,
				geometry.type as GeometryType,
				icons,
				preset,
			),
		},
		levels: featureLevels(entity.tags, () =>
			graph.parentRelations(entity.id).map((r) => r.tags),
		),
	};
}

const NO_ICONS: ReadonlySet<string> = new Set();

/** The feature drawn, its levels among the `known` levels of the data. */
export function encodeFeature(
	{ id, geometry, properties, levels }: FeatureDraft,
	known: readonly number[],
): IndoorFeature {
	return {
		type: "Feature",
		geometry,
		properties: {
			...properties,
			"@id": id,
			"@lv": encodeLevels(levels, known),
		},
	};
}

/**
 * Properties the style uses: `@kind`, and when relevant `@icon`, `@label`, `@restricted`, and
 * `@building` for the building outlines floor plans are placed against.
 */
function drawingProperties(
	tags: Tags,
	geometry: GeometryType,
	icons: ReadonlySet<string>,
	preset: Preset | undefined,
): Record<string, string> {
	const props: Record<string, string> = { "@kind": classify(tags, geometry) };
	const icon = iconFor(tags, icons, preset);
	if (icon) props["@icon"] = icon;
	const label = labelFor(tags);
	if (label) props["@label"] = label;
	if (isRestricted(tags)) props["@restricted"] = "yes";
	if (isBuildingOutline(tags, geometry)) props["@building"] = "yes";
	return props;
}

/** MapLibre filter keeping the features on `level`, and those without level information. */
export function levelFilter(level: number): FilterSpecification {
	return [
		"any",
		["==", ["get", "@lv"], "*"],
		["in", `;${String(level)};`, ["get", "@lv"]],
	];
}

function encodeLevels(levels: Levels | null, known: readonly number[]): string {
	if (!levels) return "*";
	return `;${known
		.filter((l) => isOnLevel(levels, l))
		.map(String)
		.join(";")};`;
}

/** Single levels and range ends, plus whole levels inside ranges. */
export function knownLevels(all: readonly (Levels | null)[]): number[] {
	const set = new Set<number>();
	for (const levels of all) {
		for (const { min, max } of levels ?? []) {
			set.add(min);
			set.add(max);
			for (let l = Math.ceil(min); l <= Math.floor(max); l++) set.add(l);
		}
	}
	return [...set].map((l) => (Object.is(l, -0) ? 0 : l)).sort((a, b) => a - b);
}

function geometryOf(graph: Graph, entity: Entity): Geometry | null {
	if (!hasInterestingTags(entity.tags)) return null;
	switch (entity.type) {
		case "node":
			return { type: "Point", coordinates: [...entity.loc] };
		case "way": {
			const coordinates = coordinatesOf(graph, entity.nodes);
			if (!coordinates || coordinates.length < 2) return null;
			return isClosedRing(entity) && isArea(entity.tags)
				? { type: "Polygon", coordinates: [coordinates] }
				: { type: "LineString", coordinates };
		}
		case "relation":
			return entity.tags.type === "multipolygon"
				? multipolygon(graph, entity)
				: null;
	}
}

function coordinatesOf(
	graph: Graph,
	nodes: readonly NodeId[],
): Position[] | null {
	const coordinates: Position[] = [];
	for (const id of nodes) {
		const node = graph.entity(id);
		if (node?.type !== "node") return null;
		coordinates.push([...node.loc]);
	}
	return coordinates;
}

function multipolygon(graph: Graph, relation: Relation): MultiPolygon | null {
	const ringsOf = (role: string) =>
		joinRings(
			relation.members
				.filter((m) => m.role === role || (role === "outer" && m.role === ""))
				.map((m) => graph.entity(m.ref))
				.filter((e): e is Way => e?.type === "way")
				.map((w) => w.nodes),
		)
			.map((ring) => coordinatesOf(graph, ring))
			.filter((ring): ring is Position[] => ring !== null);

	const outers = ringsOf("outer");
	if (outers.length === 0) return null;
	const polygons: Position[][][] = outers.map((outer) => [outer]);
	for (const inner of ringsOf("inner")) {
		const point = inner[0];
		const container =
			polygons.find((p) => point && p[0] && pointInRing(point, p[0])) ??
			polygons[0];
		container?.push(inner);
	}
	return { type: "MultiPolygon", coordinates: polygons };
}

/** Joins way node lists end to end into closed rings; unclosable pieces are dropped. */
function joinRings(ways: readonly (readonly NodeId[])[]): NodeId[][] {
	const remaining = ways.filter((w) => w.length > 1).map((w) => [...w]);
	const rings: NodeId[][] = [];
	while (remaining.length > 0) {
		const ring = remaining.shift() as NodeId[];
		while (ring[0] !== ring.at(-1)) {
			const end = ring.at(-1);
			const next = remaining.findIndex((w) => w[0] === end || w.at(-1) === end);
			if (next < 0) break;
			const [way] = remaining.splice(next, 1) as [NodeId[]];
			ring.push(...(way[0] === end ? way : way.reverse()).slice(1));
		}
		if (ring.length > 3 && ring[0] === ring.at(-1)) rings.push(ring);
	}
	return rings;
}
