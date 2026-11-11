/**
 * What this browser uploaded lately, laid over Overpass answers (V.1). Overpass lags behind the
 * OSM API by a minute or more: just after an upload it still serves the versions before it, so
 * the viewer would show the edits undone. The editor records what each upload wrote and
 * deleted; for an hour, the viewer swaps older versions in Overpass answers for the uploaded
 * ones, drops what was deleted, and adds what was created. Kept in localStorage, so a viewer
 * opened in another tab sees it too.
 */
import type { Entity, EntityId } from "#lib/osm/entity.ts";
import type { Graph } from "#lib/osm/graph.ts";
import type { UploadResult } from "#lib/osm/osmchange.ts";

/** What an upload changed on the server. */
export interface UploadedChanges {
	/** Created and modified entities as the server now has them (real ids, new versions). */
	readonly written: readonly Entity[];
	/** Deleted entities and the version their deletion has. */
	readonly deleted: readonly {
		readonly id: EntityId;
		readonly version: number;
	}[];
}

/** What uploading `graph`'s changes did, from the upload's result. */
export function uploadedChanges(
	graph: Graph,
	{ graph: after, idMap, notDeleted }: UploadResult,
): UploadedChanges {
	const { created, modified, deleted } = graph.changes();
	const written: Entity[] = [];
	for (const entity of [...created, ...modified]) {
		const uploaded = after.entity(idMap.get(entity.id) ?? entity.id);
		if (uploaded) written.push(uploaded);
	}
	const kept = new Set(notDeleted);
	return {
		written,
		deleted: deleted
			.filter((e) => !kept.has(e.id))
			.map((e) => ({ id: e.id, version: (e.version ?? 0) + 1 })),
	};
}

/** Where the records are kept: the browser's localStorage by default. */
export interface UploadStorage {
	read(): string | null;
	write(value: string): void;
}

const KEY = "indoorid.recentUploads";

function localStore(): UploadStorage {
	return {
		read: () => {
			try {
				return localStorage.getItem(KEY);
			} catch {
				return null;
			}
		},
		write: (value) => {
			try {
				localStorage.setItem(KEY, value);
			} catch {
				// Full or blocked storage: the viewer then shows Overpass as it is.
			}
		},
	};
}

/** How long an upload is laid over Overpass answers: well past Overpass's usual lag. */
export const KEEP_MS = 60 * 60 * 1000;

interface Saved {
	readonly at: number;
	readonly written: readonly Entity[];
	readonly deleted: readonly {
		readonly id: EntityId;
		readonly version: number;
	}[];
}

export class RecentUploads {
	readonly #storage: UploadStorage;
	readonly #now: () => number;

	constructor({
		storage = localStore(),
		now = Date.now,
	}: { storage?: UploadStorage; now?: () => number } = {}) {
		this.#storage = storage;
		this.#now = now;
	}

	/** Keeps what an upload changed, for the next hour. */
	record(changes: UploadedChanges): void {
		if (changes.written.length + changes.deleted.length === 0) return;
		const saved = [...this.#read(), { at: this.#now(), ...changes }];
		this.#storage.write(JSON.stringify(saved));
	}

	/**
	 * An answer from Overpass with the recent uploads laid over it: older versions replaced by
	 * the uploaded ones, deleted entities left out, created ones added.
	 */
	patch(entities: readonly Entity[]): Entity[] {
		const saved = this.#read();
		if (saved.length === 0) return [...entities];
		const written = new Map<EntityId, Entity>();
		const deleted = new Map<EntityId, number>();
		// Later uploads win.
		for (const upload of saved) {
			for (const e of upload.written) written.set(e.id, e);
			for (const d of upload.deleted) {
				deleted.set(d.id, d.version);
				written.delete(d.id);
			}
		}
		const result: Entity[] = [];
		const seen = new Set<EntityId>();
		for (const entity of entities) {
			seen.add(entity.id);
			const version = entity.version ?? 0;
			const gone = deleted.get(entity.id);
			if (gone !== undefined && gone > version) continue;
			const mine = written.get(entity.id);
			result.push(mine && (mine.version ?? 0) > version ? mine : entity);
		}
		for (const [id, entity] of written) {
			if (!seen.has(id)) result.push(entity);
		}
		return result;
	}

	/** The records younger than `KEEP_MS`; older ones are dropped from storage. */
	#read(): Saved[] {
		let saved: Saved[];
		try {
			const parsed: unknown = JSON.parse(this.#storage.read() ?? "[]");
			saved = Array.isArray(parsed) ? (parsed as Saved[]) : [];
		} catch {
			saved = [];
		}
		const now = this.#now();
		const fresh = saved.filter((s) => now - s.at < KEEP_MS);
		if (fresh.length !== saved.length) {
			this.#storage.write(JSON.stringify(fresh));
		}
		return fresh;
	}
}
