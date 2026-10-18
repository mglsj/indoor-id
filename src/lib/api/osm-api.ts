/**
 * Client for the OSM API 0.6. It only uses `fetch`, which callers can replace (tests, retries,
 * instrumentation). Uploads go in one request, so the server applies all edits or none.
 */
import type {
	Entity,
	EntityType,
	Member,
	RelationId,
} from "#lib/osm/entity.ts";
import { makeId, osmId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import {
	applyDiffResult,
	buildOsmChange,
	type UploadResult,
} from "#lib/osm/osmchange.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { escapeXml } from "#lib/osm/xml.ts";

export type OsmApiErrorKind =
	| "network"
	| "auth"
	| "bad-request"
	| "conflict"
	| "precondition"
	| "rate-limit"
	| "server"
	| "other";

export class OsmApiError extends Error {
	constructor(
		message: string,
		readonly kind: OsmApiErrorKind,
		readonly status?: number,
		/** The changeset that was open when the error happened, if any. */
		readonly changesetId?: number,
	) {
		super(message);
		this.name = "OsmApiError";
	}
}

export interface Bbox {
	readonly west: number;
	readonly south: number;
	readonly east: number;
	readonly north: number;
}

export interface OsmApiOptions {
	/** Instance URL, e.g. https://api.openstreetmap.org */
	readonly baseUrl: string;
	/** OAuth 2 access token of the logged-in user, or null when logged out. */
	readonly getToken: () => string | null;
	/** Value of the `created_by` changeset tag. */
	readonly createdBy: string;
	readonly fetch?: typeof fetch;
}

export class OsmApi {
	readonly #baseUrl: string;
	readonly #getToken: () => string | null;
	readonly #createdBy: string;
	readonly #fetch: typeof fetch;

	constructor(options: OsmApiOptions) {
		this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.#getToken = options.getToken;
		this.#createdBy = options.createdBy;
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
	}

	/** Downloads every entity in an area (the API limits its size and node count). */
	async loadMap(bbox: Bbox): Promise<Entity[]> {
		const query = [bbox.west, bbox.south, bbox.east, bbox.north].join(",");
		const body = await this.#request("GET", `/map.json?bbox=${query}`);
		return parseElements(JSON.parse(body));
	}

	/** Downloads a relation with its members (and their nodes), for incomplete relations. */
	async loadRelation(id: RelationId): Promise<Entity[]> {
		const body = await this.#request("GET", `/relation/${osmId(id)}/full.json`);
		return parseElements(JSON.parse(body));
	}

	/**
	 * Uploads the local edits of `graph` in a new changeset, and returns the graph as it is on
	 * the server afterwards. The changeset is always closed, even when the upload fails.
	 */
	async upload(
		graph: Graph,
		changesetTags: Tags,
	): Promise<UploadResult & { changesetId: number }> {
		if (!graph.hasChanges()) throw new Error("Nothing to upload");
		const token = this.#getToken();
		if (!token) throw new OsmApiError("You need to log in to upload", "auth");

		const changesetId = Number(
			await this.#request(
				"PUT",
				"/changeset/create",
				this.#changesetXml(changesetTags),
				token,
			),
		);
		try {
			const diffResult = await this.#request(
				"POST",
				`/changeset/${changesetId}/upload`,
				buildOsmChange(graph, changesetId),
				token,
			);
			return { ...applyDiffResult(graph, diffResult), changesetId };
		} catch (error) {
			if (error instanceof OsmApiError) {
				throw new OsmApiError(
					error.message,
					error.kind,
					error.status,
					changesetId,
				);
			}
			throw error;
		} finally {
			// An open changeset closes itself after an hour of inactivity: a failure here is harmless.
			await this.#request(
				"PUT",
				`/changeset/${changesetId}/close`,
				"",
				token,
			).catch(() => undefined);
		}
	}

	#changesetXml(tags: Tags): string {
		const all: Tags = { created_by: this.#createdBy, ...tags };
		const xmlTags = Object.entries(all)
			.filter(([k, v]) => k.trim() && v.trim())
			.map(([k, v]) => `<tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`)
			.join("");
		return `<osm><changeset>${xmlTags}</changeset></osm>`;
	}

	async #request(
		method: string,
		path: string,
		body?: string,
		token?: string,
	): Promise<string> {
		const headers = new Headers();
		if (token) headers.set("Authorization", `Bearer ${token}`);
		if (body !== undefined)
			headers.set("Content-Type", "text/xml; charset=utf-8");

		let response: Response;
		try {
			response = await this.#fetch(`${this.#baseUrl}/api/0.6${path}`, {
				method,
				headers,
				body,
			});
		} catch (error) {
			throw new OsmApiError(
				`Could not reach the OSM API: ${String(error)}`,
				"network",
			);
		}

		const text = await response.text();
		if (!response.ok) {
			throw new OsmApiError(
				`${method} ${path} failed (HTTP ${response.status}): ${text}`,
				errorKind(response.status),
				response.status,
			);
		}
		return text;
	}
}

function errorKind(status: number): OsmApiErrorKind {
	if (status === 401 || status === 403) return "auth";
	if (status === 400) return "bad-request";
	if (status === 409) return "conflict";
	if (status === 412) return "precondition";
	if (status === 429 || status === 509) return "rate-limit";
	if (status >= 500) return "server";
	return "other";
}

interface JsonElement {
	type: EntityType;
	id: number;
	version?: number;
	user?: string;
	timestamp?: string;
	tags?: Record<string, string>;
	lat?: number;
	lon?: number;
	nodes?: number[];
	members?: { type: EntityType; ref: number; role: string }[];
}

/** Converts the elements of an OSM JSON document into entities. */
function parseElements(json: { elements?: JsonElement[] }): Entity[] {
	return (json.elements ?? []).flatMap((e): Entity[] => {
		const common = {
			version: e.version,
			...(e.user === undefined ? {} : { user: e.user }),
			...(e.timestamp === undefined ? {} : { timestamp: e.timestamp }),
			tags: e.tags ?? {},
		};
		switch (e.type) {
			case "node":
				return [
					{
						type: "node",
						id: makeId("node", e.id),
						...common,
						loc: [e.lon ?? 0, e.lat ?? 0],
					},
				];
			case "way":
				return [
					{
						type: "way",
						id: makeId("way", e.id),
						...common,
						nodes: (e.nodes ?? []).map((n) => makeId("node", n)),
					},
				];
			case "relation":
				return [
					{
						type: "relation",
						id: makeId("relation", e.id),
						...common,
						members: (e.members ?? []).map(
							(m): Member => ({ ref: makeId(m.type, m.ref), role: m.role }),
						),
					},
				];
			default:
				// Ignore anything else the API may add (e.g. bounds).
				return [];
		}
	});
}
