/**
 * What the editor knows about tags: presets, tag upgrades and discarded keys (loaded in the
 * background), the presets chosen last, and the web services fields look values up in.
 */
import type { OsmWikibase } from "#lib/api/osm-wikibase.ts";
import type { Taginfo } from "#lib/api/taginfo.ts";
import type { Wikidata } from "#lib/api/wikidata.ts";
import { entityGeometry } from "#lib/osm/area.ts";
import type { Entity } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import {
	loadDiscardedKeys,
	loadPresetIndex,
	loadSchemaUpgrades,
} from "#lib/presets/load.ts";
import type {
	Preset,
	PresetGeometry,
	PresetIndex,
} from "#lib/presets/presets.ts";
import { RecentPresets, type RecentStorage } from "#lib/presets/recent.ts";
import { LOCAL_UPGRADES, type UpgradeRule } from "#lib/validation/upgrades.ts";

export interface Services {
	/** Value suggestions for combo fields; none without it. */
	readonly taginfo?: Pick<Taginfo, "values" | "multikeys" | "keys" | "roles">;
	/** Tag documentation for the ⓘ buttons; none without it. */
	readonly wikibase?: Pick<OsmWikibase, "docs">;
	/** Wikidata items, for the wikidata and wikipedia fields. */
	readonly wikidata?: Pick<Wikidata, "search" | "entity" | "itemsByTitle">;
	/** Wikipedia article titles for a language and a text. */
	readonly searchWikipedia?: (lang: string, query: string) => Promise<string[]>;
}

export interface CatalogLoaders {
	readonly presets: () => Promise<PresetIndex>;
	readonly upgrades: () => Promise<UpgradeRule[]>;
	readonly discardedKeys: () => Promise<string[]>;
}

const SCHEMA: CatalogLoaders = {
	presets: loadPresetIndex,
	upgrades: loadSchemaUpgrades,
	discardedKeys: loadDiscardedKeys,
};

export interface CatalogOptions {
	readonly services?: Services;
	/** Where the recent presets are kept (the browser's localStorage by default). */
	readonly storage?: RecentStorage;
	readonly load?: CatalogLoaders;
}

export class Catalog {
	/** Presets, once loaded. */
	presets = $state.raw<PresetIndex | null>(null);
	/** Keys the tag table never suggests, once loaded. */
	discardedKeys = $state.raw<readonly string[]>([]);
	/** Tag upgrade rules: local ones at once, the schema's once loaded. */
	upgrades = $state.raw<readonly UpgradeRule[]>(LOCAL_UPGRADES);
	/** Values the schema deprecates, by key: combo fields never suggest them. */
	readonly deprecatedValues = $derived.by(() => {
		const byKey = new Map<string, string[]>();
		for (const { old } of this.upgrades) {
			const entries = Object.entries(old);
			if (entries.length !== 1) continue;
			const [key, value] = entries[0] as [string, string];
			if (value === "*") continue;
			byKey.set(key, [...(byKey.get(key) ?? []), value]);
		}
		return byKey;
	});
	/** The feature types chosen last, offered first in the type list. */
	readonly recentPresets: RecentPresets;
	readonly services: Services;
	/** Settles once everything has loaded. */
	readonly loaded: Promise<void>;

	constructor({
		services = {},
		storage = browserStorage(),
		load = SCHEMA,
	}: CatalogOptions = {}) {
		this.services = services;
		this.recentPresets = new RecentPresets(storage);
		this.loaded = Promise.all([
			load.presets().then((index) => (this.presets = index)),
			load.discardedKeys().then((keys) => (this.discardedKeys = keys)),
			load
				.upgrades()
				.then((rules) => (this.upgrades = [...LOCAL_UPGRADES, ...rules])),
		]).then(() => {});
	}

	geometryOf(graph: Graph, entity: Entity): PresetGeometry {
		return entityGeometry(graph, entity);
	}

	presetOf(graph: Graph, entity: Entity): Preset | undefined {
		return this.presets?.match(entity.tags, entityGeometry(graph, entity));
	}
}

/** The browser's localStorage, or a stand-in that keeps nothing where it is unavailable. */
function browserStorage(): RecentStorage {
	try {
		return globalThis.localStorage ?? NO_STORAGE;
	} catch {
		return NO_STORAGE;
	}
}

const NO_STORAGE = { getItem: () => null, setItem: () => {} };
