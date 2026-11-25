/**
 * What the editor does around building mode (B): entering a building (a double-click, "Edit
 * indoor", "Edit indoor here", a click on an indoor feature from the map), leaving it, the
 * hint shown the first times, and the download of the building entered. Moved out of
 * `EditorView` (R6.4); the view gives what it owns through a `ScopeHost`.
 */
import { untrack } from "svelte";
import type { MapPoint } from "#lib/edit/mode.ts";
import { isMapFeature, scopeAt, scopeFor, scopeOf } from "#lib/edit/scope.ts";
import { toolsFor } from "#lib/edit/scope-tools.ts";
import { type Message, msg, t } from "#lib/i18n/messages.ts";
import type { EntityId } from "#lib/osm/entity.ts";
import type { Extent } from "#lib/osm/geometry.ts";
import { browserStorage } from "#lib/persist/storage.ts";
import type { Editor } from "./editor.svelte.ts";
import type { ScopeId } from "./scope.svelte.ts";

/** What the view does for the controller. */
export interface ScopeHost {
	/** Ends the mode's work and the drawing tool: building mode's tools end with it (B.3). */
	finishTools(): void;
	/** Whether a floor plan is being edited (no building is entered meanwhile). */
	planMode(): boolean;
	/** Shows the whole of a building entered, right of the side panel (B.2). */
	fit(extent: Extent): void;
	/** Back to the ground floor: the map has no level switcher (B.3). */
	groundFloor(): void;
	/** The building drawn under a point of the map other than `except`, if any. */
	buildingAt(point: MapPoint["point"], except: EntityId | null): string | null;
}

/** How many times the hint on entering a building is shown, in this browser (A.2). */
const ENTERED_HINTS = 3;
const ENTERED_KEY = "indoorid.building-hints";
/** How long the hint stays, in milliseconds. */
const HINT_MS = 6000;

export class BuildingScopeController {
	readonly #editor: Editor;
	readonly #host: ScopeHost;
	readonly #storage: Pick<Storage, "getItem" | "setItem"> | undefined;
	/**
	 * The building (or level outline) around the last click on the empty map, which "Edit
	 * indoor here" enters (B.2); null elsewhere.
	 */
	here = $state.raw<ScopeId | null>(null);
	/** The hint the first few times a building is entered (A.2). */
	enteredHint = $state.raw<Message | null>(null);

	/** The selected building or level outline, which "Edit indoor" enters (B.1). */
	readonly enterable = $derived.by((): ScopeId | null => {
		const id = this.#editor.selection.single;
		if (!id || this.#editor.scope.active || this.#host.planMode()) return null;
		return scopeOf(this.#editor.graph, id) ? (id as ScopeId) : null;
	});

	/** The name of the building entered, for the header chip. */
	readonly name = $derived.by(() => {
		const { scope, graph } = this.#editor;
		if (scope.loose) return t(msg("building_loose"));
		const current = scope.current;
		if (!current) return "";
		const tags = graph.entity(current.id)?.tags ?? {};
		return tags.name ?? tags.ref ?? tags["addr:housenumber"] ?? current.id;
	});

	/** On the map with nothing selected, "Edit indoor here" is offered (B.3: the loose data). */
	readonly hereOffered = $derived.by(
		() =>
			!this.#editor.scope.active &&
			!this.#host.planMode() &&
			this.#editor.selection.ids.length === 0,
	);

	/** What map mode or building mode offers (B.3). */
	readonly offered = $derived.by(() =>
		toolsFor(this.#editor.scope.active ? "building" : "map"),
	);

	#hintTimer: ReturnType<typeof setTimeout> | undefined;
	/** The building downloaded whole last (B.2). */
	#downloaded: ScopeId | null = null;

	constructor(
		editor: Editor,
		host: ScopeHost,
		storage:
			| Pick<Storage, "getItem" | "setItem">
			| undefined = browserStorage(),
	) {
		this.#editor = editor;
		this.#host = host;
		this.#storage = storage;
	}

	/**
	 * Follows the building entered, whichever way it was (a click, the URL): hints the first
	 * times, drops the hint on leaving. Run it in an effect: it reads only the scope entered.
	 */
	scopeChanged(): void {
		const { scope } = this.#editor;
		if (!scope.active) {
			this.enteredHint = null;
			return;
		}
		void scope.id;
		untrack(() => this.#hintEntered());
	}

	/**
	 * Downloads the building entered whole, once (B.2): the view may show only part of it.
	 * Run it in an effect: it waits for the building's data to know its extent.
	 */
	downloadEntered(): void {
		const { scope, sync } = this.#editor;
		const id = scope.id;
		if (!id) {
			this.#downloaded = null;
			return;
		}
		const current = scope.current;
		if (!current || id === this.#downloaded) return;
		this.#downloaded = id;
		untrack(() => void sync.loadArea(current.extent));
	}

	/** Stops the hint's timer. */
	destroy(): void {
		clearTimeout(this.#hintTimer);
	}

	/**
	 * Enters a building or level outline (B.1): its features become the ones worked on. Asked
	 * for (a double-click, "Edit indoor"), the camera fits it (B.2).
	 */
	enter(id: ScopeId, { fit = true } = {}): void {
		this.#host.finishTools();
		this.here = null;
		if (!this.#editor.scope.enter(id)) return;
		this.#editor.select(null);
		const scope = this.#editor.scope.current;
		if (fit && scope) this.#host.fit(scope.extent);
	}

	/** "Edit indoor here": the building last clicked in, else the indoor data no building holds. */
	enterHere(): void {
		if (this.here) {
			this.enter(this.here);
			return;
		}
		this.#host.finishTools();
		this.#editor.scope.enterLoose();
		this.#editor.select(null);
	}

	/** Back to the map, selecting the building left (B.1). */
	leave(): void {
		const editor = this.#editor;
		const id = editor.scope.id;
		this.#host.finishTools();
		editor.scope.leave();
		// An upper floor left shown would stay with no way down.
		this.#host.groundFloor();
		editor.select(id && editor.graph.entity(id) ? id : null);
	}

	/**
	 * What a double-click enters (B.2): the building drawn under it, else the smallest holding
	 * that position; null where there is none, the building already entered, or a neighbour
	 * hidden with the surroundings.
	 */
	enterableAt(at: MapPoint): ScopeId | null {
		const { scope, graph } = this.#editor;
		if (this.#host.planMode()) return null;
		if (scope.active && !scope.surroundings) return null;
		const hit = this.#host.buildingAt(at.point, scope.id);
		const id =
			hit && scopeOf(graph, hit as EntityId)
				? (hit as ScopeId)
				: (scopeAt(graph, at.lngLat)?.id as ScopeId | undefined);
		return id && id !== scope.id ? id : null;
	}

	/**
	 * Selects a feature; on the map, an indoor one enters its building first (B.1), and a click
	 * on the empty map offers to enter the building around it ("Edit indoor here", B.2).
	 */
	selectOrEnter(id: EntityId | null, at?: MapPoint): void {
		const editor = this.#editor;
		this.here =
			!id && at && !editor.scope.active
				? ((scopeAt(editor.graph, at.lngLat)?.id as ScopeId | undefined) ??
					null)
				: null;
		const properties = id ? editor.features.byId.get(id)?.properties : null;
		if (id && properties && !editor.scope.active && !isMapFeature(properties)) {
			const scope = scopeFor(editor.graph, id);
			// The room clicked stays where it is: no camera move.
			if (scope) this.enter(scope.id as ScopeId, { fit: false });
		}
		editor.select(id);
	}

	#hintEntered(): void {
		const storage = this.#storage;
		if (storage) {
			const shown = Number(storage.getItem(ENTERED_KEY) ?? 0) || 0;
			if (shown >= ENTERED_HINTS) return;
			try {
				storage.setItem(ENTERED_KEY, String(shown + 1));
			} catch {
				// Storage full: the hint is shown anyway.
			}
		}
		this.enteredHint = msg("building_entered_hint", { name: this.name });
		clearTimeout(this.#hintTimer);
		this.#hintTimer = setTimeout(() => (this.enteredHint = null), HINT_MS);
	}
}
