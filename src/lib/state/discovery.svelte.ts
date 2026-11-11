/**
 * Discovery (V.2): where indoor maps are, when the view is too far out to load their data.
 * Below the viewer's data zoom, the centres of rooms, areas and corridors are downloaded in
 * zoom-12 tiles (each once) and drawn as count bubbles (`map/discovery-layer.ts`), as indoor=
 * and OpenLevelUp do, so a reader can find the buildings that have indoor data.
 */
import { MapLoader, type MapLoaderOptions } from "#lib/api/map-loader.ts";
import type { Bbox } from "#lib/api/osm-api.ts";
import type { IndoorCentre } from "#lib/api/overpass.ts";
import type { EntityId, Loc } from "#lib/osm/entity.ts";

export interface DiscoveryOptions {
	/** Downloads the centres of an area, e.g. `(bbox) => overpass.indoorCentres(bbox)`. */
	readonly load: (bbox: Bbox) => Promise<IndoorCentre[]>;
	/** Bubbles show from this zoom… */
	readonly minZoom?: number;
	/** …up to this one, where the data itself loads. */
	readonly maxZoom: number;
	readonly schedule?: MapLoaderOptions["schedule"];
}

/** Tiles of this zoom are downloaded: about 10 km wide at the equator. */
const TILE_ZOOM = 12;

export class Discovery {
	/** Every centre downloaded so far, by feature id. */
	centres = $state.raw<ReadonlyMap<EntityId, Loc>>(new Map());

	readonly #loader: MapLoader<IndoorCentre>;
	readonly #minZoom: number;
	readonly #maxZoom: number;

	constructor({
		load,
		minZoom = TILE_ZOOM,
		maxZoom,
		schedule,
	}: DiscoveryOptions) {
		this.#minZoom = minZoom;
		this.#maxZoom = maxZoom;
		this.#loader = new MapLoader<IndoorCentre>({
			download: load,
			onData: (found) => {
				const next = new Map(this.centres);
				for (const { id, loc } of found) next.set(id, loc);
				this.centres = next;
			},
			schedule,
			zoom: TILE_ZOOM,
			concurrency: 2,
			maxTiles: 16,
			// An Overpass error says nothing about the area's size.
			tooLarge: () => false,
		});
	}

	/** Whether bubbles are shown at this zoom. */
	shows(zoom: number): boolean {
		return zoom >= this.#minZoom && zoom < this.#maxZoom;
	}

	/** Downloads the centres in view, when bubbles are shown at this zoom. */
	async loadView(bounds: Bbox, zoom: number): Promise<void> {
		if (this.shows(zoom)) await this.#loader.load(bounds);
	}
}

/** The centres as GeoJSON points, for the clustered source. */
export function centresCollection(
	centres: ReadonlyMap<EntityId, Loc>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
	return {
		type: "FeatureCollection",
		features: [...centres].map(([id, loc]) => ({
			type: "Feature",
			properties: { "@id": id },
			geometry: { type: "Point", coordinates: [loc[0], loc[1]] },
		})),
	};
}
