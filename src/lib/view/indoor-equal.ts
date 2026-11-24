/**
 * Preview in indoor= (P6): indoorequal.org's remote command API (its README, "Remote Command
 * API") shows a GeoJSON file in its viewer, opened in a new tab. The tab says it is ready with
 * `{ event: "ready" }`; IndoorID then sends `{ command: "preview", file }`, the level shown
 * and where to look. Messages are taken only from that tab at indoor='s origin, and sent only
 * to that origin (the README's example accepts any and sends to `*`).
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { draftOf } from "#lib/map/features.ts";
import type { EntityId } from "#lib/osm/entity.ts";
import type { Extent } from "#lib/osm/geometry.ts";
import type { Graph } from "#lib/osm/graph.ts";

export const INDOOR_EQUAL_ORIGIN = "https://indoorequal.org";

/**
 * The features as indoor= reads them: their OSM tags and an `id` (`way/12`), without
 * IndoorID's drawing properties. New features carry their negative ids.
 */
export function previewFeatures(
	graph: Graph,
	ids: Iterable<EntityId>,
): FeatureCollection<Geometry, Record<string, string>> {
	const features: Feature<Geometry, Record<string, string>>[] = [];
	for (const id of ids) {
		const entity = graph.entity(id);
		if (!entity) continue;
		const draft = draftOf(graph, entity, {});
		if (!draft) continue;
		const properties: Record<string, string> = {};
		for (const [key, value] of Object.entries(draft.properties))
			if (!key.startsWith("@")) properties[key] = value;
		properties.id = `${entity.type}/${entity.id.slice(1)}`;
		features.push({ type: "Feature", geometry: draft.geometry, properties });
	}
	return { type: "FeatureCollection", features };
}

/** What `window` gives the preview: opening a tab and hearing its messages. */
export interface PreviewHost {
	open(url: string): Pick<Window, "postMessage"> | null;
	listen(listener: (event: MessageEvent) => void): () => void;
}

/** Gives up waiting for indoor= to be ready after this long (ms). */
const READY_TIMEOUT = 60_000;

/**
 * Opens indoor= and shows `data` there once it is ready, on `level`, framed on `bbox`. False
 * when the tab couldn't open (a pop-up blocker).
 */
export function previewInIndoorEqual(
	data: FeatureCollection,
	view: { level: number; bbox: Extent },
	host: PreviewHost = browserHost,
): boolean {
	const tab = host.open(`${INDOOR_EQUAL_ORIGIN}/`);
	if (!tab) return false;
	let stop = () => {};
	const timer = setTimeout(() => stop(), READY_TIMEOUT);
	stop = host.listen((event) => {
		if (event.origin !== INDOOR_EQUAL_ORIGIN || event.source !== tab) return;
		if ((event.data as { event?: unknown } | null)?.event !== "ready") return;
		stop();
		clearTimeout(timer);
		const file = new File([JSON.stringify(data)], "indoorid.geojson", {
			type: "application/geo+json",
		});
		const { west, south, east, north } = view.bbox;
		tab.postMessage({ command: "preview", file }, INDOOR_EQUAL_ORIGIN);
		tab.postMessage(
			{ command: "level", level: String(view.level) },
			INDOOR_EQUAL_ORIGIN,
		);
		tab.postMessage(
			{ command: "coordinates", bbox: [west, south, east, north] },
			INDOOR_EQUAL_ORIGIN,
		);
	});
	return true;
}

const browserHost: PreviewHost = {
	open: (url) => globalThis.window?.open(url, "_blank") ?? null,
	listen: (listener) => {
		globalThis.window?.addEventListener("message", listener);
		return () => globalThis.window?.removeEventListener("message", listener);
	},
};
