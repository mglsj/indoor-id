/**
 * JOSM's active layer as a read-only data source (`?source=josm`, P6): its unsaved edits
 * included, read through JOSM's Remote Control `GET /export` (JOSM r19425 and later, with
 * "Export data from JOSM" allowed in its Remote Control preferences). The layer is read once
 * and handed to the map whole; nothing is ever uploaded, the edits stay JOSM's to upload.
 * See https://josm.openstreetmap.de/wiki/Help/RemoteControlCommands
 */
import { MessageError, msg } from "#lib/i18n/messages.ts";
import type { Entity, EntityId, RelationId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import { parseOsmXml } from "#lib/osm/osm-xml.ts";
import type { Tags } from "#lib/osm/tags.ts";
import type { SyncApi } from "#lib/state/data-sync.svelte.ts";
import type { Bbox } from "./osm-api.ts";

/** Remote Control's address: JOSM listens on this port of the computer it runs on. */
export const JOSM_URL = "http://127.0.0.1:8111";

export interface JosmSourceOptions {
	readonly baseUrl?: string;
	readonly fetch?: typeof fetch;
}

export class JosmSource implements SyncApi {
	readonly #baseUrl: string;
	readonly #fetch: typeof fetch;
	#layer: Promise<Entity[]> | null = null;
	/** Whether the map has the layer already: later areas get nothing more. */
	#handed = false;

	constructor({ baseUrl, fetch }: JosmSourceOptions = {}) {
		this.#baseUrl = (baseUrl ?? JOSM_URL).replace(/\/+$/, "");
		this.#fetch = fetch ?? globalThis.fetch.bind(globalThis);
	}

	/** The layer's features, read once (again after a failure). */
	load(): Promise<Entity[]> {
		this.#layer ??= this.#export().catch((error: unknown) => {
			this.#layer = null;
			throw error;
		});
		return this.#layer;
	}

	/** The whole layer to the first area asked for, whatever it is; nothing to the others. */
	async loadMap(_bbox: Bbox): Promise<Entity[]> {
		const entities = await this.load();
		if (this.#handed) return [];
		this.#handed = true;
		return entities;
	}

	/** The layer came whole: a relation's members are in it, or JOSM doesn't have them. */
	async loadRelation(_id: RelationId): Promise<Entity[]> {
		return [];
	}

	/** Only an upload asks for current versions, and there is none. */
	async loadEntities(_ids: readonly EntityId[]): Promise<[]> {
		return [];
	}

	async upload(_graph: Graph, _changesetTags: Tags): Promise<never> {
		throw new MessageError(msg("josm_read_only"));
	}

	async #export(): Promise<Entity[]> {
		let response: Response;
		try {
			response = await this.#fetch(`${this.#baseUrl}/export`, {
				cache: "no-store",
			});
		} catch (cause) {
			throw new MessageError(msg("josm_unreachable"), { cause });
		}
		if (response.status === 403) {
			throw new MessageError(msg("josm_permission"));
		}
		if (!response.ok) {
			// Remote Control answers 400 to a command it doesn't know.
			throw new MessageError(msg("josm_too_old"));
		}
		const body = await response.text();
		// No active data layer, or one being uploaded.
		if (body.trim() === "") throw new MessageError(msg("josm_no_layer"));
		return parseOsmXml(body);
	}
}
