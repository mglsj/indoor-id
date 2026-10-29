/**
 * The editor: its parts put together, and what the UI reads across them. `history` holds the
 * graph and its undo steps, `selection` the selected and hovered features, `sync` the OSM API,
 * `catalog` presets, tag upgrades and web services. Components get it with `getEditor()`;
 * edits made from the UI are in `commands.ts`.
 */

import { createContext } from "svelte";
import type { MapLoaderOptions } from "#lib/api/map-loader.ts";
import { FeatureStore, type StoredFeatures } from "#lib/map/feature-store.ts";
import { AVAILABLE_ICONS } from "#lib/map/style/icons.ts";
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import { Graph } from "#lib/osm/graph.ts";
import type { Preset, PresetGeometry } from "#lib/presets/presets.ts";
import type { Issue } from "#lib/validation/validate.ts";
import { Validator } from "#lib/validation/validator.ts";
import { Catalog, type CatalogOptions } from "./catalog.svelte.ts";
import { DataSync, type SyncApi } from "./data-sync.svelte.ts";
import { EditHistory } from "./edit-history.svelte.ts";
import { Selection } from "./selection.svelte.ts";

export type { LoadStatus } from "./data-sync.svelte.ts";

export interface EditorOptions {
	readonly api: SyncApi;
	/** Data is only downloaded from this zoom level. */
	readonly minZoom: number;
	/** Presets, upgrades and web services: given, or loaded from the schema. */
	readonly catalog?: Catalog | CatalogOptions;
	/** When downloaded data is handed over (the next frame by default). */
	readonly schedule?: MapLoaderOptions["schedule"];
}

export class Editor {
	readonly history = new EditHistory(Graph.fromEntities([]));
	readonly selection = new Selection();
	readonly catalog: Catalog;
	readonly sync: DataSync;

	/** The map's features, built again only for what each change touched. */
	readonly features: StoredFeatures;
	/**
	 * The selected entity, or null when nothing, several features or something deleted is
	 * selected: the Inspector edits one feature.
	 */
	readonly selected = $derived(
		this.selection.single
			? (this.graph.entity(this.selection.single) ?? null)
			: null,
	);

	readonly #validator = new Validator();
	/** The same checks on the downloaded data, to tell the issues an edit made. */
	readonly #baseValidator = new Validator();

	constructor({ api, minZoom, catalog, schedule }: EditorOptions) {
		this.catalog = catalog instanceof Catalog ? catalog : new Catalog(catalog);
		const store = new FeatureStore();
		this.features = $derived(
			store.update(this.graph, {
				icons: AVAILABLE_ICONS,
				presets: this.catalog.presets ?? undefined,
			}),
		);
		this.sync = new DataSync({
			api,
			minZoom,
			history: this.history,
			selection: this.selection,
			schedule,
		});
	}

	/** The current graph (the history's). */
	get graph(): Graph {
		return this.history.graph;
	}

	/** Selects features; a field being typed in no longer folds into the last step. */
	select(ids: EntityId | readonly EntityId[] | null): void {
		this.history.endTyping();
		this.selection.select(ids);
	}

	geometryOf(entity: Entity): PresetGeometry {
		return this.catalog.geometryOf(this.graph, entity);
	}

	presetOf(entity: Entity): Preset | undefined {
		return this.catalog.presetOf(this.graph, entity);
	}

	/** Problems of one entity. */
	issuesOf(id: EntityId): Issue[] {
		return this.#validator.issues(this.graph, [id], this.catalog.upgrades);
	}

	/**
	 * Problems of the entities edited since the last upload, leaving out those the downloaded
	 * data already had (iD's base and head issues): a fix to one tag doesn't ask to fix the
	 * rest of the building.
	 */
	get editIssues(): Issue[] {
		const { created, modified } = this.graph.changes();
		const { upgrades } = this.catalog;
		const head = this.#validator.issues(
			this.graph,
			[...created, ...modified].map((e) => e.id),
			upgrades,
		);
		if (modified.length === 0) return head;
		const before = new Set(
			this.#baseValidator
				.issues(
					this.graph.base(),
					modified.map((e) => e.id),
					upgrades,
				)
				.map((i) => i.id),
		);
		// Errors stay: the upload would carry them.
		return head.filter((i) => i.severity === "error" || !before.has(i.id));
	}
}

const [getEditor, setEditorContext] = createContext<Editor>();

/** The editor of the page, for any component under the one that set it. */
export { getEditor };

/** Makes `editor` available to the components below with `getEditor()`. */
export function setEditor(editor: Editor): Editor {
	return setEditorContext(editor);
}
