/**
 * The editor's exchanges with the OSM API: the visible area downloaded into the history (with
 * its status), incomplete relations completed, and the edits uploaded in one changeset.
 */
import { MapLoader, type MapLoaderOptions } from "#lib/api/map-loader.ts";
import type { Bbox, OsmApi } from "#lib/api/osm-api.ts";
import type { Entity, RelationId } from "#lib/osm/entity.ts";
import type { Tags } from "#lib/osm/tags.ts";
import type { EditHistory } from "./edit-history.svelte.ts";
import type { Selection } from "./selection.svelte.ts";

export type LoadStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "loading" }
	/** The view is too zoomed out to download data. */
	| { readonly kind: "zoom-in" }
	/** Some tiles failed; they are retried on the next move. */
	| { readonly kind: "error"; readonly failed: number };

export type SyncApi = Pick<OsmApi, "loadMap" | "loadRelation" | "upload">;

export interface DataSyncOptions {
	readonly api: SyncApi;
	/** Data is only downloaded from this zoom level. */
	readonly minZoom: number;
	readonly history: EditHistory;
	/** Follows the ids an upload gives to new features. */
	readonly selection: Selection;
	/** When downloaded data is handed over (the next frame by default). */
	readonly schedule?: MapLoaderOptions["schedule"];
}

export class DataSync {
	status = $state.raw<LoadStatus>({ kind: "idle" });

	readonly #api: SyncApi;
	readonly #minZoom: number;
	readonly #history: EditHistory;
	readonly #selection: Selection;
	readonly #loader: MapLoader;
	#loads = 0;

	constructor({ api, minZoom, history, selection, schedule }: DataSyncOptions) {
		this.#api = api;
		this.#minZoom = minZoom;
		this.#history = history;
		this.#selection = selection;
		this.#loader = new MapLoader({
			download: (bbox) => api.loadMap(bbox),
			onData: (entities) => this.#receive(entities),
			schedule,
		});
	}

	/** Downloads the data of the visible area, if zoomed in enough. */
	async loadView(bounds: Bbox, zoom: number): Promise<void> {
		if (zoom < this.#minZoom) {
			this.status = { kind: "zoom-in" };
			return;
		}
		this.#loads++;
		this.status = { kind: "loading" };
		const result = await this.#loader.load(bounds);
		this.#loads--;
		if (result.failed > 0) {
			this.status = { kind: "error", failed: result.failed };
		} else if (this.#loads === 0) {
			this.status = { kind: result.skipped ? "zoom-in" : "idle" };
		}
	}

	/** Downloads the members of an incomplete relation. */
	async loadRelation(id: RelationId): Promise<void> {
		this.#receive(await this.#api.loadRelation(id));
	}

	/**
	 * Uploads the edits in one changeset, then starts a new history from the server's state.
	 * Returns the changeset id. On failure the edits are kept.
	 */
	async upload(changesetTags: Tags): Promise<number> {
		const result = await this.#api.upload(this.#history.graph, changesetTags);
		this.#selection.remap(result.idMap);
		this.#history.reset(result.graph);
		return result.changesetId;
	}

	#receive(entities: Entity[]): void {
		this.#history.merge(entities);
	}
}
