/**
 * The editor's exchanges with the OSM API: the visible area downloaded into the history (with
 * its status), incomplete relations completed, and the edits uploaded in one changeset.
 */
import {
	type Conflict,
	type Current,
	idsToCheck,
	missingChildren,
	type Rebase,
	type Resolution,
	rebase,
	resolveConflict,
} from "#lib/actions/rebase.ts";
import { MAX_CHANGESET_CHANGES } from "#lib/api/changeset.ts";
import { MapLoader, type MapLoaderOptions } from "#lib/api/map-loader.ts";
import { type Bbox, type OsmApi, OsmApiError } from "#lib/api/osm-api.ts";
import {
	type UploadedChanges,
	uploadedChanges,
} from "#lib/api/recent-uploads.ts";
import { MessageError, msg, t } from "#lib/i18n/messages.ts";
import type { Entity, EntityId, RelationId } from "#lib/osm/entity.ts";
import type { Tags } from "#lib/osm/tags.ts";
import { type UploadProblem, uploadProblems } from "#lib/osm/upload-check.ts";
import type { EditHistory } from "./edit-history.svelte.ts";
import type { Selection } from "./selection.svelte.ts";

export type LoadStatus =
	| { readonly kind: "idle" }
	| { readonly kind: "loading" }
	/** The view is too zoomed out to download data. */
	| { readonly kind: "zoom-in" }
	/** Some tiles failed; they are retried on the next move. */
	| { readonly kind: "error"; readonly failed: number };

/** What an upload did. */
export interface UploadSummary {
	readonly changesetId: number;
	/**
	 * Deleted features the server kept, because other data still uses them (OSM's
	 * `if-unused`): they are back in the data.
	 */
	readonly notDeleted: readonly EntityId[];
}

/** What `DataSync.upload` did. */
export type UploadOutcome =
	| ({ readonly kind: "uploaded" } & UploadSummary)
	/** Edits clash with someone else's: nothing was sent (see `DataSync.conflicts`). */
	| { readonly kind: "conflicts"; readonly conflicts: readonly Conflict[] }
	/** After taking the server's changes, nothing was left to send. */
	| { readonly kind: "up-to-date" };

export type SyncApi = Pick<
	OsmApi,
	"loadMap" | "loadRelation" | "loadEntities" | "upload"
>;

const MERGE_REMOTE = msg("undo_merge_remote");

export interface DataSyncOptions {
	readonly api: SyncApi;
	/** Data is only downloaded from this zoom level. */
	readonly minZoom: number;
	readonly history: EditHistory;
	/** Follows the ids an upload gives to new features. */
	readonly selection: Selection;
	/** When downloaded data is handed over (the next frame by default). */
	readonly schedule?: MapLoaderOptions["schedule"];
	/** How tiles are downloaded, for an API other than OSM's (Overpass). */
	readonly loader?: Pick<MapLoaderOptions, "zoom" | "concurrency" | "tooLarge">;
	/** What each upload changed on the server (for `RecentUploads`). */
	readonly onupload?: (changes: UploadedChanges) => void;
}

export class DataSync {
	status = $state.raw<LoadStatus>({ kind: "idle" });

	readonly #api: SyncApi;
	readonly #minZoom: number;
	readonly #history: EditHistory;
	readonly #selection: Selection;
	readonly #loader: MapLoader;
	readonly #onupload: DataSyncOptions["onupload"];
	#loads = 0;
	/** The upload under way, if any. */
	#uploading: Promise<unknown> | null = null;
	/** Bumped by each upload that started a new history. */
	#generation = 0;

	constructor({
		api,
		minZoom,
		history,
		selection,
		schedule,
		loader,
		onupload,
	}: DataSyncOptions) {
		this.#api = api;
		this.#onupload = onupload;
		this.#minZoom = minZoom;
		this.#history = history;
		this.#selection = selection;
		this.#loader = new MapLoader({
			download: (bbox) => api.loadMap(bbox),
			onData: (entities) => this.#receive(entities),
			schedule,
			...loader,
		});
	}

	/** Downloads the data of the visible area, if zoomed in enough. */
	async loadView(bounds: Bbox, zoom: number): Promise<void> {
		if (zoom < this.#minZoom) {
			this.status = { kind: "zoom-in" };
			return;
		}
		return this.loadArea(bounds);
	}

	/**
	 * Downloads an area whatever the zoom: a building entered (B.2), loaded whole once even
	 * when part of it is out of view. Tiles already downloaded aren't downloaded again.
	 */
	async loadArea(bounds: Bbox): Promise<void> {
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
		for (;;) {
			const generation = this.#generation;
			const entities = await this.#api.loadRelation(id);
			while (this.#uploading) await this.#uploading.catch(() => undefined);
			// Asked for before an upload: the answer may hold what it deleted.
			if (generation === this.#generation) return this.#receive(entities);
		}
	}

	/**
	 * The changeset of the last upload that failed, until one goes through: the failure may
	 * have lost only the answer, so the next upload checks it first (`OsmApi.upload`'s
	 * `retryOf`). Autosaved with the edits.
	 */
	failedChangeset = $state<number | undefined>();

	/** True while an upload is under way. */
	get uploading(): boolean {
		return this.#uploading !== null;
	}

	/**
	 * The edits that clash with someone else's, found by the last upload: resolved one by one
	 * (`resolve`), then the upload is made again.
	 */
	conflicts = $state.raw<readonly Conflict[]>([]);

	/**
	 * Uploads the edits in one changeset, then starts a new history from the server's state.
	 * First the edits are rebased onto the server's current versions of what they touch
	 * (P5.4b): someone else's changes are merged as an undo step, and what can't be merged is
	 * returned as conflicts, nothing sent. On failure the edits are kept. Edits and downloads
	 * wait meanwhile: the upload sends the graph as it was, and downloads asked for before it
	 * are dropped and made again once it is done.
	 */
	async upload(
		changesetTags: Tags,
		{ user }: { user?: string } = {},
	): Promise<UploadOutcome> {
		if (this.#uploading) throw new Error("An upload is already under way");
		const count = this.#history.editCount;
		if (count > MAX_CHANGESET_CHANGES) {
			throw new MessageError(
				msg("upload_too_many_changes", { count, max: MAX_CHANGESET_CHANGES }),
			);
		}
		this.#history.lock();
		this.#loader.pause();
		const uploading = this.#rebaseAndUpload(changesetTags, user);
		this.#uploading = uploading;
		try {
			return await uploading;
		} finally {
			this.#uploading = null;
			this.#history.unlock();
			this.#loader.resume();
		}
	}

	async #rebaseAndUpload(
		changesetTags: Tags,
		user: string | undefined,
	): Promise<UploadOutcome> {
		// A retry of a lost answer checks its changeset first: no rebase, the server has it.
		if (this.failedChangeset === undefined) {
			const before = this.#history.graph;
			const current = await this.#api.loadEntities(idsToCheck(before));
			const result = rebase(before, current);
			await this.#apply(result);
			this.conflicts = result.conflicts;
			if (result.conflicts.length > 0) {
				return { kind: "conflicts", conflicts: result.conflicts };
			}
			// Their changes were all the user's too.
			if (before.hasChanges() && !this.#history.graph.hasChanges()) {
				return { kind: "up-to-date" };
			}
		}

		const graph = this.#history.graph;
		// Checked before a changeset is opened: a refusal then leaves none behind (W3).
		const problems = uploadProblems(graph);
		if (problems.length > 0) {
			throw new MessageError(
				msg("upload_check_failed", { problems: describeProblems(problems) }),
			);
		}
		const result = await this.#api
			.upload(graph, changesetTags, { retryOf: this.failedChangeset, user })
			.catch((error: unknown) => {
				if (error instanceof OsmApiError && error.changesetId !== undefined) {
					// Only a failure that may have lost the answer is checked by the next upload; a
					// refusal (409, 410, 412, 400…) is an answer, and the next upload rebases again.
					this.failedChangeset = mayHaveApplied(error)
						? error.changesetId
						: undefined;
				}
				throw error;
			});
		this.failedChangeset = undefined;
		this.#onupload?.(uploadedChanges(graph, result));
		this.#generation++;
		this.#loader.reset();
		this.#selection.remap(result.idMap);
		this.#history.reset(result.graph);
		return {
			kind: "uploaded",
			changesetId: result.changesetId,
			notDeleted: result.notDeleted,
		};
	}

	/**
	 * Resolves a conflict found by the upload: the user's version kept over the server's, or the
	 * server's taken (an undo step). The upload is then made again, and checks again.
	 */
	async resolve(id: EntityId, choice: Resolution): Promise<void> {
		const conflict = this.conflicts.find((c) => c.id === id);
		if (!conflict || this.#uploading) return;
		await this.#apply(resolveConflict(this.#history.graph, conflict, choice));
		this.conflicts = this.conflicts.filter((c) => c.id !== id);
	}

	/** Applies a rebase to the history, with the nodes and members its server data needs. */
	async #apply({ server, gone, action }: Rebase): Promise<void> {
		const graph = this.#history.graph;
		const missing = missingChildren(graph, server);
		const children: Current[] =
			missing.length > 0 ? await this.#api.loadEntities(missing) : [];
		const added = children.flatMap((c) => (c.entity ? [c.entity] : []));
		this.#history.rebase([...server, ...added], gone, action, MERGE_REMOTE);
	}

	/**
	 * Drops the edits and downloads the data again: what a retry does when the server already
	 * has the upload (`uploaded`).
	 */
	discard(): void {
		this.failedChangeset = undefined;
		this.conflicts = [];
		this.#generation++;
		this.#loader.reset();
		this.#history.reset(this.#history.graph.base());
	}

	#receive(entities: Entity[]): void {
		this.#history.merge(entities);
	}
}

/**
 * Whether the server may have applied an upload that failed: its answer was lost (the network)
 * or broken (a 5xx), or a retry found it there (`uploaded`).
 */
function mayHaveApplied(error: OsmApiError): boolean {
	return (
		error.kind === "network" ||
		error.kind === "server" ||
		error.kind === "uploaded"
	);
}

/** The first few problems of an upload, in words. */
function describeProblems(problems: readonly UploadProblem[]): string {
	const shown = problems.slice(0, 3).map((p) => {
		const other = p.other ?? "";
		switch (p.kind) {
			case "twice":
				return t(msg("upload_problem_twice", { id: p.id }));
			case "refers-to-deleted":
				return t(msg("upload_problem_refers_to_deleted", { id: p.id, other }));
			case "refers-to-missing":
				return t(msg("upload_problem_refers_to_missing", { id: p.id, other }));
			case "short-way":
				return t(msg("upload_problem_short_way", { id: p.id }));
			case "repeated-node":
				return t(msg("upload_problem_repeated_node", { id: p.id, other }));
			case "untagged-way":
				return t(msg("upload_problem_untagged_way", { id: p.id }));
			case "still-used":
				return t(msg("upload_problem_still_used", { id: p.id, other }));
			default:
				return p.kind satisfies never;
		}
	});
	const more = problems.length - shown.length;
	return [...shown, ...(more > 0 ? [`+${more}`] : [])].join("; ");
}
