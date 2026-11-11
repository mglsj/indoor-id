/**
 * Read-only OSM data from Overpass for the viewer (V.1): no account and no OSM API quota.
 * `loadMap` asks only for what the indoor map draws (indoor features, anything with a level,
 * buildings, doors and entrances) and completes it downwards, so a room cut by a tile edge
 * comes whole, with every node, and a multipolygon with every member way. The answer is OSM
 * JSON with `out meta`, read like the OSM API's.
 * See https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
 */
import type { Entity, RelationId } from "#lib/osm/entity.ts";
import { osmId } from "#lib/osm/entity.ts";
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
		const json = JSON.parse(text) as Parameters<typeof parseElements>[0] & {
			remark?: string;
		};
		// A query that ran out of time or memory still answers 200, with what it had so far.
		if (json.remark && /error/i.test(json.remark)) {
			throw new OsmApiError(`Overpass: ${json.remark}`, "server");
		}
		return parseElements(json);
	}
}
