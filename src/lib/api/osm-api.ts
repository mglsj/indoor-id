/**
 * Client for the OSM API 0.6. It only uses `fetch`, which callers can replace (tests, retries,
 * instrumentation). Uploads go in one request, so the server applies all edits or none.
 */

import type { Current } from "#lib/actions/rebase.ts";
import type {
	Entity,
	EntityId,
	EntityType,
	Member,
	RelationId,
} from "#lib/osm/entity.ts";
import { entityType, makeId, osmId } from "#lib/osm/entity.ts";
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
	/** 410: something edited was deleted on the server. */
	| "gone"
	| "rate-limit"
	| "server"
	/** A retry found the earlier upload in its changeset: its answer was lost, not the data. */
	| "uploaded"
	| "other";

export class OsmApiError extends Error {
	constructor(
		message: string,
		readonly kind: OsmApiErrorKind,
		readonly status?: number,
		/** The changeset that was open when the error happened, if any. */
		readonly changesetId?: number,
		/** The entities the server named in its answer (a conflict, a deletion, a missing node). */
		readonly entities: readonly EntityId[] = [],
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
	 * The current versions of entities, deleted ones included (`entity: null`): what an upload
	 * checks its edits against (P5.4b). Asked for in batches (the API's multi-fetch), a few at a
	 * time.
	 */
	async loadEntities(ids: readonly EntityId[]): Promise<Current[]> {
		const batches: string[] = [];
		for (const type of ["node", "way", "relation"] as const) {
			const numbers = ids
				.filter((id) => entityType(id) === type)
				.map((id) => osmId(id));
			for (let i = 0; i < numbers.length; i += MULTI_FETCH) {
				const list = numbers.slice(i, i + MULTI_FETCH).join(",");
				batches.push(`/${type}s.json?${type}s=${list}`);
			}
		}
		const results: Current[] = [];
		let next = 0;
		const worker = async () => {
			while (next < batches.length) {
				const path = batches[next++] as string;
				const body = JSON.parse(await this.#request("GET", path));
				results.push(...parseCurrent(body));
			}
		};
		await Promise.all(
			Array.from(
				{ length: Math.min(FETCH_CONCURRENCY, batches.length) },
				worker,
			),
		);
		return results;
	}

	/**
	 * Uploads the graph's changes in a new changeset. `retryOf` is the changeset of an upload
	 * that failed: when it holds changes, that upload went through and only its answer was lost,
	 * so nothing is sent again (an error of kind `uploaded`).
	 */
	async upload(
		graph: Graph,
		changesetTags: Tags,
		{ retryOf, user }: { retryOf?: number; user?: string } = {},
	): Promise<UploadResult & { changesetId: number }> {
		if (!graph.hasChanges()) throw new Error("Nothing to upload");
		const token = this.#getToken();
		if (!token) throw new OsmApiError("You need to log in to upload", "auth");
		if (retryOf !== undefined) {
			const change = await this.#request(
				"GET",
				`/changeset/${retryOf}/download`,
				undefined,
				token,
			);
			if (/<(create|modify|delete)\b/.test(change)) {
				throw new OsmApiError(
					`Changeset ${retryOf} already holds the upload`,
					"uploaded",
					undefined,
					retryOf,
				);
			}
		}

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
			const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");
			return {
				...applyDiffResult(graph, diffResult, { user, timestamp }),
				changesetId,
			};
		} catch (error) {
			if (error instanceof OsmApiError) {
				throw new OsmApiError(
					error.message,
					error.kind,
					error.status,
					changesetId,
					error.entities,
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
				// Never an older version from the browser's cache (osm-simple3d-editor #47).
				cache: "no-store",
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
				undefined,
				namedEntities(text),
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
	if (status === 410) return "gone";
	if (status === 429 || status === 509) return "rate-limit";
	if (status >= 500) return "server";
	return "other";
}

/** Ids per multi-fetch request: well under URL length limits (iD asks for 150). */
const MULTI_FETCH = 150;
const FETCH_CONCURRENCY = 4;

/**
 * The entities an error answer names. The API's 409, 410 and 412 bodies read like
 * "Version mismatch: Provided 1, server had: 2 of Way 100", "The node with the id 5 has
 * already been deleted", "Precondition failed: Node 5 is still used by ways 7,8." or
 * "Way 12 requires the nodes with id in 1,2, which either do not exist, or are not visible."
 */
export function namedEntities(body: string): EntityId[] {
	const ids = new Set<EntityId>();
	const add = (type: string, list: string) => {
		const t = type.toLowerCase().replace(/s$/, "") as EntityType;
		if (t !== "node" && t !== "way" && t !== "relation") return;
		for (const n of list.match(/\d+/g) ?? []) ids.add(makeId(t, Number(n)));
	};
	for (const [, type = "", list = ""] of body.matchAll(
		/\b(nodes?|ways?|relations?)(?: with (?:the )?id(?: in)?)?\s*\(?((?:\d+\s*,\s*)*\d+)/gi,
	)) {
		add(type, list);
	}
	return [...ids];
}

/** Current versions from a multi-fetch answer: deleted ones come with `visible: false`. */
function parseCurrent(json: {
	elements?: (JsonElement & { visible?: boolean })[];
}): Current[] {
	return (json.elements ?? []).flatMap((e): Current[] => {
		if (e.type !== "node" && e.type !== "way" && e.type !== "relation")
			return [];
		const id = makeId(e.type, e.id);
		const version = e.version ?? 0;
		const who = e.user === undefined ? {} : { user: e.user };
		if (e.visible === false) return [{ id, version, entity: null, ...who }];
		const [entity] = parseElements({ elements: [e] });
		return entity ? [{ id, version, entity, ...who }] : [];
	});
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
export function parseElements(json: { elements?: JsonElement[] }): Entity[] {
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
