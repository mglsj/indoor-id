/**
 * Edits saved as they are made (P5.4a), so a crash or a reload doesn't lose them: one record
 * per tab in IndexedDB, under the tab's id. The id is kept in `sessionStorage`, so a reload of
 * the tab finds its record; each tab beats in `localStorage` every 5 s (`heartbeat`), and the
 * record of a tab silent for 20 s belongs to a closed tab, which a new tab may claim. Two open
 * tabs never restore the same edits. Nothing leaves the user's browser.
 */
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Message } from "#lib/i18n/messages.ts";
import type { SavedHistory } from "#lib/osm/history-json.ts";

/** A tab's edits as saved. */
export interface SavedEdits {
	readonly tab: string;
	/** When they were saved (ms since the epoch). */
	readonly saved: number;
	readonly history: SavedHistory<Message>;
	/** The changeset an upload had opened, for a retry to check first. */
	readonly changeset?: number;
}

export interface AutosaveOptions {
	readonly database?: string;
	readonly session?: Storage;
	readonly local?: Storage;
	readonly now?: () => number;
}

/** How often an open tab says so. */
export const HEARTBEAT_MS = 5_000;
/** A tab silent this long is closed: its edits may be claimed. */
export const SILENT_MS = 20_000;

const TAB_KEY = "indoorid:tab";
const BEAT_PREFIX = "indoorid:beat:";

interface Schema extends DBSchema {
	edits: { key: string; value: SavedEdits };
}

export class Autosave {
	/** This tab's id, kept across reloads. */
	readonly tab: string;
	readonly #name: string;
	readonly #local: Storage;
	readonly #now: () => number;
	#db?: Promise<IDBPDatabase<Schema>>;

	constructor({
		database = "indoorid-edits",
		session = sessionStorage,
		local = localStorage,
		now = Date.now,
	}: AutosaveOptions = {}) {
		this.#name = database;
		this.#local = local;
		this.#now = now;
		let tab = session.getItem(TAB_KEY);
		if (!tab) {
			tab = crypto.randomUUID();
			session.setItem(TAB_KEY, tab);
		}
		this.tab = tab;
	}

	/** Says this tab is open; call every `HEARTBEAT_MS`. */
	heartbeat(): void {
		this.#local.setItem(BEAT_PREFIX + this.tab, String(this.#now()));
	}

	/** Saves this tab's edits, replacing those saved before. */
	async save(
		history: SavedHistory<Message>,
		{ changeset }: { changeset?: number } = {},
	): Promise<void> {
		this.heartbeat();
		const record: SavedEdits = {
			tab: this.tab,
			saved: this.#now(),
			history,
			...(changeset === undefined ? {} : { changeset }),
		};
		await (await this.#open()).put("edits", record);
	}

	/** Forgets this tab's edits (uploaded or discarded). */
	async clear(): Promise<void> {
		await (await this.#open()).delete("edits", this.tab);
	}

	/** The edits this tab may restore: its own (a reload), then those of closed tabs. */
	async restorable(): Promise<SavedEdits[]> {
		const all = await (await this.#open()).getAll("edits");
		const own = all.filter((r) => r.tab === this.tab);
		const closed = all
			.filter((r) => r.tab !== this.tab && this.#isClosed(r.tab))
			.sort((a, b) => b.saved - a.saved);
		return [...own, ...closed];
	}

	/**
	 * Takes edits found by `restorable` for this tab, so no other tab restores them. False when
	 * another tab claimed them first.
	 */
	async claim(edits: SavedEdits): Promise<boolean> {
		if (edits.tab === this.tab) return true;
		const tx = (await this.#open()).transaction("edits", "readwrite");
		const found = await tx.store.get(edits.tab);
		if (!found) {
			await tx.done;
			return false;
		}
		await tx.store.put({ ...found, tab: this.tab });
		await tx.store.delete(edits.tab);
		await tx.done;
		this.#local.removeItem(BEAT_PREFIX + edits.tab);
		this.heartbeat();
		return true;
	}

	#isClosed(tab: string): boolean {
		const beat = Number(this.#local.getItem(BEAT_PREFIX + tab) ?? 0);
		return this.#now() - beat > SILENT_MS;
	}

	#open(): Promise<IDBPDatabase<Schema>> {
		this.#db ??= openDB<Schema>(this.#name, 1, {
			upgrade(db) {
				db.createObjectStore("edits", { keyPath: "tab" });
			},
		});
		return this.#db;
	}
}
