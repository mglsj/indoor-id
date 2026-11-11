/**
 * Read-only OSM data from Overpass for the viewer (V.1): no account and no OSM API quota.
 * `loadMap` asks only for what the indoor map draws (indoor features, anything with a level,
 * buildings, doors and entrances) and completes it downwards, so a room cut by a tile edge
 * comes whole, with every node, and a multipolygon with every member way. The answer is OSM
 * JSON with `out meta`, read like the OSM API's.
 * See https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
 */
import type { Entity, EntityId, Loc, RelationId } from "#lib/osm/entity.ts";
import { makeId, osmId } from "#lib/osm/entity.ts";
import { type Bbox, OsmApiError, parseElements } from "./osm-api.ts";

export const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api";

export interface OverpassOptions {
	/** The API's base, without `/interpreter`; overpass-api.de's by default. */
	readonly baseUrl?: string;
	readonly fetch?: typeof fetch;
	/** Seconds the server may spend on a query. */
	readonly timeout?: number;
}

/** What the viewer draws, by tag; anything else in the area is left out. */
const DRAWN = [
	"indoor",
	"level",
	"repeat_on",
	"building",
	"building:part",
	"door",
	"entrance",
];

/** The Overpass QL query of the indoor data in an area, with the members of what it finds. */
export function indoorQuery(bbox: Bbox, timeout = 25): string {
	const area = [bbox.south, bbox.west, bbox.north, bbox.east].join(",");
	const sets = DRAWN.map((key) => `nwr["${key}"];`).join("");
	// `>` takes ways' nodes and relations' members (and their nodes): never cut by the bbox.
	return `[out:json][timeout:${timeout}][bbox:${area}];(${sets});(._;>;);out meta;`;
}

/** An indoor space found by `indoorCentres`: where to put its dot on a small-scale map. */
export interface IndoorCentre {
	readonly id: EntityId;
	readonly loc: Loc;
}

/**
 * The query behind discovery (V.2): rooms, areas and corridors in an area, as ids and centres
 * only (`out ids center`), so a city's worth stays small.
 */
export function centresQuery(bbox: Bbox, timeout = 25): string {
	const area = [bbox.south, bbox.west, bbox.north, bbox.east].join(",");
	return `[out:json][timeout:${timeout}][bbox:${area}];wr["indoor"~"^(room|area|corridor)$"];out ids center qt;`;
}

export class Overpass {
	readonly #baseUrl: string;
	readonly #fetch: typeof fetch;
	readonly #timeout: number;

	constructor({ baseUrl, fetch, timeout }: OverpassOptions = {}) {
		this.#baseUrl = (baseUrl ?? DEFAULT_OVERPASS_URL).replace(/\/+$/, "");
		this.#fetch = fetch ?? globalThis.fetch.bind(globalThis);
		this.#timeout = timeout ?? 25;
	}

	/** The indoor data of an area (see `indoorQuery`). */
	loadMap(bbox: Bbox): Promise<Entity[]> {
		return this.#query(indoorQuery(bbox, this.#timeout));
	}

	/** Where the rooms, areas and corridors of an area are (V.2). */
	async indoorCentres(bbox: Bbox): Promise<IndoorCentre[]> {
		const json = await this.#run(centresQuery(bbox, this.#timeout));
		const elements = (json as { elements?: CentreElement[] }).elements ?? [];
		return elements.flatMap((e) =>
			(e.type === "way" || e.type === "relation") && e.center
				? [{ id: makeId(e.type, e.id), loc: [e.center.lon, e.center.lat] }]
				: [],
		);
	}

	/** A relation with its members and their nodes. */
	loadRelation(id: RelationId): Promise<Entity[]> {
		return this.#query(
			`[out:json][timeout:${this.#timeout}];rel(${osmId(id)});(._;>;);out meta;`,
		);
	}

	/** Overpass is read-only. */
	upload(): Promise<never> {
		return Promise.reject(
			new OsmApiError("The viewer doesn't upload", "other"),
		);
	}

	async #query(query: string): Promise<Entity[]> {
		return parseElements(
			(await this.#run(query)) as Parameters<typeof parseElements>[0],
		);
	}

	/** Runs a query and returns its JSON answer. */
	async #run(query: string): Promise<unknown> {
		let response: Response;
		try {
			response = await this.#fetch(`${this.#baseUrl}/interpreter`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ data: query }).toString(),
			});
		} catch (error) {
			throw new OsmApiError(
				`Could not reach Overpass: ${String(error)}`,
				"network",
			);
		}
		const text = await response.text();
		if (!response.ok) {
			throw new OsmApiError(
				`Overpass failed (HTTP ${response.status}): ${text.slice(0, 200)}`,
				response.status === 429 ? "rate-limit" : "server",
				response.status,
			);
		}
		const json = JSON.parse(text) as { remark?: string };
		// A query that ran out of time or memory still answers 200, with what it had so far.
		if (json.remark && /error/i.test(json.remark)) {
			throw new OsmApiError(`Overpass: ${json.remark}`, "server");
		}
		return json;
	}
}

interface CentreElement {
	type: string;
	id: number;
	center?: { lat: number; lon: number };
}
