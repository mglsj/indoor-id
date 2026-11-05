/**
 * The editor's edits saved as they are made (P5.4a): a second after the last change, and at
 * once when the tab is hidden; on start, edits found (a reload, a closed tab) are offered
 * back before anything is saved over them. The store and its lock are in `persist/autosave.ts`.
 */
import { restoreHistory } from "#lib/osm/history-json.ts";
import {
	type Autosave,
	HEARTBEAT_MS,
	type SavedEdits,
} from "#lib/persist/autosave.ts";
import type { Editor } from "./editor.svelte.ts";

/** Edits found on start, with the number of features they change. */
export interface Offer {
	readonly edits: SavedEdits;
	readonly count: number;
	readonly saved: number;
}

export class EditAutosave {
	/** Edits to restore or discard, asked on start (`RestoreDialog`). */
	offer = $state.raw<Offer | null>(null);

	readonly #editor: Editor;
	readonly #store: Autosave;
	readonly #delay: number;
	/** Nothing is saved before the edits found on start are restored or discarded. */
	#ready = false;
	#timer?: ReturnType<typeof setTimeout>;
	#beat?: ReturnType<typeof setInterval>;
	/** What the last save wrote, to skip saves that would write the same. */
	#saved: unknown[] = [];

	constructor(editor: Editor, store: Autosave, { delay = 1_000 } = {}) {
		this.#editor = editor;
		this.#store = store;
		this.#delay = delay;
	}

	/** Beats for the tab's lock and looks for edits to offer. */
	async start(): Promise<void> {
		this.#store.heartbeat();
		this.#beat = setInterval(() => this.#store.heartbeat(), HEARTBEAT_MS);
		const [edits] = await this.#store.restorable().catch(warn([]));
		if (!edits) {
			this.#ready = true;
			this.changed();
			return;
		}
		const count = restoreHistory(edits.history).graph.changeCount();
		if (count === 0) {
			await this.#claim(edits, false);
			return;
		}
		this.offer = { edits, count, saved: edits.saved };
	}

	/** Takes the offered edits back into the editor. */
	async restore(): Promise<void> {
		const offer = this.offer;
		this.offer = null;
		if (offer) await this.#claim(offer.edits, true);
	}

	/** Forgets the offered edits. */
	async discard(): Promise<void> {
		const offer = this.offer;
		this.offer = null;
		if (offer) await this.#claim(offer.edits, false);
	}

	/** The edits changed: saved after the delay (call on every change). */
	changed(): void {
		if (!this.#ready) return;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.flush(), this.#delay);
	}

	/** Saves now (the tab is being hidden). */
	async flush(): Promise<void> {
		clearTimeout(this.#timer);
		if (!this.#ready) return;
		const { history, sync } = this.#editor;
		const state = [history.graph, sync.failedChangeset];
		if (state.every((value, i) => value === this.#saved[i])) return;
		this.#saved = state;
		const changeset = sync.failedChangeset;
		const saving =
			history.editCount > 0 || changeset !== undefined
				? this.#store.save(history.save(), { changeset })
				: this.#store.clear();
		await saving.catch(warn(undefined));
	}

	stop(): void {
		clearTimeout(this.#timer);
		clearInterval(this.#beat);
	}

	async #claim(edits: SavedEdits, restore: boolean): Promise<void> {
		const claimed = await this.#store.claim(edits).catch(warn(false));
		if (claimed && restore) {
			this.#editor.history.restore(edits.history);
			this.#editor.sync.failedChangeset = edits.changeset;
		}
		this.#ready = true;
		// Saved again as restored, or cleared when discarded.
		this.#saved = [];
		await this.flush();
	}
}

/** Autosave is a safety net: a browser without IndexedDB (a private window) edits without it. */
function warn<T>(fallback: T): (error: unknown) => T {
	return (error) => {
		console.warn("Autosave failed", error);
		return fallback;
	};
}
