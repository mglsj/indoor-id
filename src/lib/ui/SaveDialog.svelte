<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import { Dialog as DialogPrimitive } from "bits-ui";
	import type { Conflict, Resolution } from "#lib/actions/rebase.ts";
	import { changesetTags, MAX_CHANGESET_CHANGES } from "#lib/api/changeset.ts";
	import { OsmApiError } from "#lib/api/osm-api.ts";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import * as Dialog from "#lib/components/shadcn/dialog/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import { Textarea } from "#lib/components/shadcn/textarea/index.ts";
	import { scopedIssues } from "#lib/edit/scope.ts";
	import { type Message, msg, t } from "#lib/i18n/messages.ts";
	import { labelFor } from "#lib/map/classify.ts";
	import { type ChangeKind, changeSummary } from "#lib/osm/change-summary.ts";
	import type { Entity, EntityId, NodeId } from "#lib/osm/entity.ts";
	import type { Graph } from "#lib/osm/graph.ts";
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import type { Session } from "#lib/state/session.svelte.ts";
	import PresetIcon from "#lib/ui/PresetIcon.svelte";
	import { BLOCKING_RULES } from "#lib/validation/validate.ts";

	interface Props {
		session: Session;
		/** Names of the imagery used while editing. */
		imagery: readonly string[];
		/** Whether floor plans were shown while editing (tagged as custom imagery). */
		floorPlans?: boolean;
		/** Called once the changes are uploaded. */
		onuploaded?: () => void;
		/** OSM website, to link to the uploaded changeset. */
		websiteUrl: string;
		/**
		 * Shows a changed feature on the map, the dialog staying open over `covered` pixels on
		 * the map's right.
		 */
		onshow?: (id: EntityId, covered: number) => void;
		/**
		 * Selects the feature an issue names, to fix it (the dialog closes), showing `at`, the
		 * node the issue is at, when it has one.
		 */
		onpick?: (id: EntityId, at?: NodeId) => void;
		/** A row is hovered or focused for a feature, or none is any more (null). */
		onhover?: (id: EntityId | null) => void;
		onclose: () => void;
	}

	let {
		session,
		imagery,
		floorPlans = false,
		onuploaded,
		websiteUrl,
		onshow,
		onpick,
		onhover,
		onclose,
	}: Props = $props();
	const editor = getEditor();

	let open = $state(true);
	let comment = $state("");
	let source = $state("");
	let reviewRequested = $state(false);
	let phase = $state<
		| { kind: "form" }
		| { kind: "signing-in"; cancel: AbortController }
		| { kind: "uploading" }
		| { kind: "done"; changesetId: number; notDeleted: readonly string[] }
		| { kind: "up-to-date" }
		/** Choosing a version of a conflict. */
		| { kind: "resolving" }
		| { kind: "error"; message: string; uploaded?: number }
	>({ kind: "form" });

	const allIssues = $derived(editor.editIssues);
	/** Issues the upload waits on: the server would take the data broken. */
	const blocking = $derived(
		allIssues.filter((i) => BLOCKING_RULES.has(i.rule)),
	);
	/** Inside a building, its warnings and every error; the rest counted (B.5). */
	const scoped = $derived(
		scopedIssues(
			allIssues,
			editor.scope.current ? (id) => editor.scope.contains(id) : null,
		),
	);
	const issues = $derived(scoped.shown);
	/** The changed features, named as iD's save panel names them (a moved vertex by its way). */
	const changes = $derived(changeSummary(editor.graph));
	/** The dialog itself, to tell `onshow` how much of the map it covers. */
	let content = $state<HTMLElement | null>(null);
	const busy = $derived(
		phase.kind === "uploading" ||
			phase.kind === "signing-in" ||
			phase.kind === "resolving",
	);
	/** Edits that clash with someone else's, found by the last upload (P5.4b). */
	const conflicts = $derived(editor.sync.conflicts);
	/** A changeset takes at most 10,000 changes: more are refused before sending anything. */
	const tooMany = $derived(
		editor.history.editCount > MAX_CHANGESET_CHANGES
			? msg("upload_too_many_changes", {
					count: editor.history.editCount,
					max: MAX_CHANGESET_CHANGES,
				})
			: null,
	);

	async function upload(event: SubmitEvent) {
		event.preventDefault();
		try {
			if (!session.loggedIn) {
				const cancel = new AbortController();
				phase = { kind: "signing-in", cancel };
				await session.login({ signal: cancel.signal });
			}
			phase = { kind: "uploading" };
			const outcome = await editor.sync.upload(
				changesetTags({
					comment,
					source,
					imagery,
					floorPlans,
					reviewRequested,
				}),
				{ user: session.userName ?? undefined },
			);
			if (outcome.kind === "conflicts") {
				phase = { kind: "form" };
				return;
			}
			phase =
				outcome.kind === "uploaded"
					? {
							kind: "done",
							changesetId: outcome.changesetId,
							notDeleted: outcome.notDeleted,
						}
					: { kind: "up-to-date" };
			onuploaded?.();
		} catch (error) {
			// Cancelled: the form is back already.
			if (phase.kind === "form") return;
			if (error instanceof OsmApiError && error.kind === "auth")
				session.logout();
			phase = {
				kind: "error",
				message: explain(error),
				uploaded:
					error instanceof OsmApiError && error.kind === "uploaded"
						? error.changesetId
						: undefined,
			};
		}
	}

	/** Keeps the user's version of conflicts, or takes the server's. */
	async function resolve(ids: readonly Conflict["id"][], choice: Resolution) {
		phase = { kind: "resolving" };
		try {
			for (const id of ids) await editor.sync.resolve(id, choice);
			phase = { kind: "form" };
		} catch (error) {
			phase = { kind: "error", message: explain(error) };
		}
	}

	/** What a conflict is about: the feature's preset and name, then its id. */
	function conflictLabel(conflict: Conflict): string {
		const entity = conflict.mine ?? conflict.theirs.entity ?? conflict.base;
		const name = labelFor(entity.tags);
		const preset = editor.presetOf(entity)?.name;
		return [preset, name].filter(Boolean).join(" ") || entity.id;
	}

	/** How a list names a feature: its preset, and its name when it has one. */
	function nameOf(entity: Entity, graph: Graph = editor.graph) {
		const preset = editor.catalog.presetOf(graph, entity);
		const type = preset?.name ?? t(msg("feature"));
		const label = labelFor(entity.tags);
		return {
			icon: preset?.icon,
			type,
			label,
			text: label ? t(msg("feature_label", { type, label })) : type,
		};
	}

	const CHANGE_MESSAGES = {
		created: "save_change_created",
		modified: "save_change_modified",
		deleted: "save_change_deleted",
	} as const satisfies Record<ChangeKind, string>;

	/** At most this many changes are listed; the rest are counted. */
	const SHOWN_CHANGES = 200;

	/** An issue was picked: the hover it sets for its corner stays once the dialog closes. */
	let picked = false;

	/** Highlights a feature on the map while a row is hovered or focused. */
	function hover(id: EntityId | null, at?: NodeId) {
		// Picked: the row losing focus as the dialog closes leaves the corner pointed out.
		if (picked) return;
		editor.selection.setHover(id, at ?? null);
		onhover?.(id);
	}

	function showChange(id: EntityId) {
		const box = content?.getBoundingClientRect();
		onshow?.(id, box ? window.innerWidth - box.left : 0);
	}

	function pickIssue(id: EntityId, at?: NodeId) {
		hover(null);
		picked = true;
		onpick?.(id, at);
		open = false;
	}

	/** Why a feature is in conflict. */
	function conflictReason(conflict: Conflict): Message {
		const user = conflict.theirs.user ?? t(msg("conflict_someone"));
		switch (conflict.kind) {
			case "deleted-by-them":
				return msg("conflict_deleted_by_them", { user });
			case "deleted-by-me":
				return msg("conflict_deleted_by_me", { user });
			case "deleted-in-use":
				return msg("conflict_deleted_in_use", { user });
			case "both-edited": {
				const keys = conflict.keys.join(", ");
				if (keys && conflict.geometry)
					return msg("conflict_both_edited_all", { keys, user });
				return keys
					? msg("conflict_both_edited_tags", { keys, user })
					: msg("conflict_both_edited_geometry", { user });
			}
		}
	}

	/** Cancel: stops a login under way (an upload, once sent, can't be taken back). */
	function cancel() {
		if (phase.kind === "signing-in") {
			phase.cancel.abort();
			phase = { kind: "form" };
		} else {
			open = false;
		}
	}

	/** The features an error names, or `otherwise`. */
	function named(error: OsmApiError, otherwise: string): string {
		return error.entities.length > 0 ? error.entities.join(", ") : otherwise;
	}

	function explain(error: unknown): string {
		if (!(error instanceof OsmApiError)) return (error as Error).message;
		switch (error.kind) {
			case "conflict":
				return t(
					msg("upload_error_conflict", {
						ids: named(error, t(msg("upload_error_same_data"))),
					}),
				);
			case "precondition":
			case "gone":
				return t(
					msg("upload_error_gone", {
						ids: named(error, t(msg("upload_error_some_data"))),
					}),
				);
			case "auth":
				return t(msg("upload_error_auth"));
			case "rate-limit":
				return t(msg("upload_error_rate_limit"));
			case "network":
				return t(msg("upload_error_network"));
			case "uploaded":
				return t(
					msg("upload_already_uploaded", {
						changeset: String(error.changesetId ?? ""),
					}),
				);
			default:
				return error.message;
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChangeComplete={(isOpen) => {
		if (!isOpen) {
			if (!picked) hover(null);
			onclose();
		}
	}}
>
	<!-- On the map's right, over a clear overlay: hovering a change or an issue highlights its
	     feature on the map (iD's save panel). -->
	<Dialog.Portal>
		<Dialog.Overlay
			class="bg-transparent supports-backdrop-filter:backdrop-blur-none"
		/>
		<DialogPrimitive.Content
			bind:ref={content}
			data-slot="dialog-content"
			class="fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100%_-_2rem)] w-full max-w-[calc(100%_-_2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 overflow-y-auto rounded-xl bg-popover p-6 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none duration-100 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 sm:top-16 sm:right-4 sm:left-auto sm:max-h-[calc(100%_-_5rem)] sm:max-w-md sm:translate-x-0 sm:translate-y-0"
			escapeKeydownBehavior={phase.kind === "uploading" ? "ignore" : "close"}
			interactOutsideBehavior={busy ? "ignore" : "close"}
			onEscapeKeydown={() => {
				if (phase.kind === "signing-in") phase.cancel.abort();
			}}
		>
			<Dialog.Header>
				<Dialog.Title>{t(msg("save_upload_your_edits"))}</Dialog.Title>
				{#if phase.kind !== "done"}
					<Dialog.Description>
						{t(
							msg("save_features_changed", { count: editor.history.editCount }),
						)}
					</Dialog.Description>
				{/if}
			</Dialog.Header>

			{#if phase.kind === "up-to-date"}
				<p role="status">{t(msg("upload_up_to_date"))}</p>
				<Dialog.Footer>
					<Button onclick={() => (open = false)}>{t(msg("view_close"))}</Button>
				</Dialog.Footer>
			{:else if phase.kind === "done"}
				<p role="status">
					{t(msg("save_uploaded_in"))}
					<a
						class="text-primary underline underline-offset-4"
						href={`${websiteUrl.replace(/\/+$/, "")}/changeset/${phase.changesetId}`}
						target="_blank"
						rel="noopener"
						>{t(
							msg("save_changeset_link", { changeset: phase.changesetId }),
						)}</a
					>{t(msg("save_thanks"))}
				</p>
				{#if phase.notDeleted.length > 0}
					<Alert.Root role="note" aria-label={t(msg("save_deletions_kept"))}>
						<TriangleAlert />
						<Alert.Description>
							{t(
								msg("upload_not_deleted", {
									count: phase.notDeleted.length,
									ids: phase.notDeleted.join(", "),
								}),
							)}
						</Alert.Description>
					</Alert.Root>
				{/if}
				<Dialog.Footer>
					<Button onclick={() => (open = false)}>{t(msg("view_close"))}</Button>
				</Dialog.Footer>
			{:else}
				{#if issues.length > 0 || scoped.elsewhere > 0}
					<Alert.Root
						role="note"
						aria-label={t(msg("save_issues_in_your_edits"))}
					>
						<TriangleAlert />
						<Alert.Title
							>{t(msg("save_please_check_before_uploading"))}</Alert.Title
						>
						<Alert.Description>
							<ul
								class="-mx-1.5 flex flex-col"
								aria-label={t(msg("save_issues_in_your_edits"))}
							>
								{#each issues as issue (issue.id)}
									{@const entity = editor.graph.entity(issue.entityId)}
									{@const name = entity ? nameOf(entity) : null}
									<li>
										<button
											type="button"
											class="flex w-full flex-col items-start rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
											aria-label={t(
												msg("save_select_issue", {
													issue: t(issue.message),
													item: name?.text ?? issue.entityId,
												}),
											)}
											onpointerenter={() => hover(issue.entityId, issue.at)}
											onpointerleave={() => hover(null)}
											onfocus={() => hover(issue.entityId, issue.at)}
											onblur={() => hover(null)}
											onclick={() => pickIssue(issue.entityId, issue.at)}
										>
											<span class="text-foreground">{t(issue.message)}</span>
											<span class="text-xs">
												{name?.text ?? issue.entityId}
											</span>
										</button>
									</li>
								{/each}
							</ul>
							{#if scoped.elsewhere > 0}
								<p class="mt-1" data-testid="issues-elsewhere">
									{t(
										msg("save_warnings_elsewhere", {
											count: String(scoped.elsewhere),
										}),
									)}
								</p>
							{/if}
						</Alert.Description>
					</Alert.Root>
				{/if}

				{#if changes.length > 0}
					<section
						class="flex flex-col gap-1"
						aria-labelledby="save-changes-title"
					>
						<h3 id="save-changes-title" class="font-medium">
							{t(msg("save_changes"))}
						</h3>
						<ul
							class="-mx-1.5 flex max-h-48 flex-col overflow-y-auto"
							aria-labelledby="save-changes-title"
							data-testid="changes"
						>
							{#each changes.slice(0, SHOWN_CHANGES) as change (change.entity
								.id)}
								{@const deleted = change.kind === "deleted"}
								{@const name = nameOf(
									change.entity,
									deleted ? editor.graph.base() : editor.graph,
								)}
								{@const kind = t(msg(CHANGE_MESSAGES[change.kind]))}
								<li>
									{#if deleted}
										<!-- Gone from the map: nothing to highlight or show. -->
										<span
											class="flex items-center gap-2 px-1.5 py-1 text-muted-foreground"
										>
											<PresetIcon icon={name.icon} size={18} />
											<span class="min-w-0 flex-1 truncate">
												<span class="font-medium">{name.type}</span>
												{#if name.label}
													{name.label}
												{/if}
											</span>
											<span class="text-xs">{kind}</span>
										</span>
									{:else}
										<button
											type="button"
											class="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
											aria-label={t(
												msg("save_show_change", { item: name.text, kind }),
											)}
											onpointerenter={() => hover(change.entity.id)}
											onpointerleave={() => hover(null)}
											onfocus={() => hover(change.entity.id)}
											onblur={() => hover(null)}
											onclick={() => showChange(change.entity.id)}
										>
											<PresetIcon icon={name.icon} size={18} />
											<span class="min-w-0 flex-1 truncate">
												<span class="font-medium">{name.type}</span>
												{#if name.label}
													<span class="text-muted-foreground"
														>{name.label}</span
													>
												{/if}
											</span>
											<span class="text-xs text-muted-foreground">{kind}</span>
										</button>
									{/if}
								</li>
							{/each}
						</ul>
						{#if changes.length > SHOWN_CHANGES}
							<p class="text-xs text-muted-foreground">
								{t(
									msg("save_more_changes", {
										count: changes.length - SHOWN_CHANGES,
									}),
								)}
							</p>
						{/if}
					</section>
				{/if}

				<form class="flex flex-col gap-6" onsubmit={upload}>
					<Field.Group>
						<Field.Field>
							<Field.Label for="changeset-comment"
								>{t(msg("save_comment"))}</Field.Label
							>
							<Textarea
								id="changeset-comment"
								bind:value={comment}
								required
								rows={2}
								maxlength={255}
								placeholder={t(msg("save_what_did_you_change"))}
							/>
						</Field.Field>
						<Field.Field>
							<Field.Label for="changeset-source"
								>{t(msg("save_source"))}</Field.Label
							>
							<Input
								id="changeset-source"
								type="text"
								bind:value={source}
								placeholder="e.g. survey, floor plan"
							/>
						</Field.Field>
						<Field.Field orientation="horizontal">
							<Checkbox id="changeset-review" bind:checked={reviewRequested} />
							<Field.Label for="changeset-review" class="font-normal">
								{t(msg("save_ask_for_someone_to"))}
							</Field.Label>
						</Field.Field>
						<Field.Description>
							{#if !session.configured}
								{t(msg("save_login_is_not_configured"))}
							{:else if session.loggedIn}
								Logged in{session.userName ? ` as ${session.userName}` : ""}.
								<Button
									variant="link"
									size="xs"
									class="px-0"
									onclick={() => session.logout()}
								>
									{t(msg("save_log_out"))}
								</Button>
							{:else}
								{t(msg("save_you_will_be_asked"))}
							{/if}
						</Field.Description>
					</Field.Group>

					{#if conflicts.length > 0}
						<Alert.Root
							role="note"
							aria-label={t(msg("upload_conflicts_title"))}
						>
							<CircleAlert />
							<Alert.Title>{t(msg("upload_conflicts_title"))}</Alert.Title>
							<Alert.Description>
								<p>{t(msg("upload_conflicts_intro"))}</p>
								<ul
									class="mt-2 flex w-full flex-col gap-2"
									data-testid="conflicts"
								>
									{#each conflicts as conflict (conflict.id)}
										<li class="flex flex-col gap-1">
											<span class="font-medium text-foreground"
												>{conflictLabel(conflict)}
												<span class="text-muted-foreground"
													>({conflict.id})</span
												></span
											>
											<span>{t(conflictReason(conflict))}</span>
											<span class="flex gap-2">
												<Button
													variant="outline"
													size="xs"
													disabled={busy}
													onclick={() => resolve([conflict.id], "mine")}
													>{t(msg("conflict_keep_mine"))}</Button
												>
												<Button
													variant="outline"
													size="xs"
													disabled={busy}
													onclick={() => resolve([conflict.id], "theirs")}
													>{t(msg("conflict_take_theirs"))}</Button
												>
											</span>
										</li>
									{/each}
								</ul>
								{#if conflicts.length > 1}
									<span class="mt-2 flex gap-2">
										<Button
											variant="secondary"
											size="xs"
											disabled={busy}
											onclick={() =>
												resolve(
													conflicts.map((c) => c.id),
													"mine",
												)}
											>{t(msg("conflict_keep_all_mine"))}</Button
										>
										<Button
											variant="secondary"
											size="xs"
											disabled={busy}
											onclick={() =>
												resolve(
													conflicts.map((c) => c.id),
													"theirs",
												)}
											>{t(msg("conflict_take_all_theirs"))}</Button
										>
									</span>
								{/if}
							</Alert.Description>
						</Alert.Root>
					{/if}

					{#if blocking.length > 0}
						<Alert.Root variant="destructive">
							<CircleAlert />
							<Alert.Description>
								{t(msg("save_fix_the_errors_above"))}
							</Alert.Description>
						</Alert.Root>
					{/if}

					{#if tooMany}
						<Alert.Root variant="destructive">
							<CircleAlert />
							<Alert.Description>{t(tooMany)}</Alert.Description>
						</Alert.Root>
					{/if}

					{#if phase.kind === "error"}
						<Alert.Root variant="destructive">
							<CircleAlert />
							<Alert.Description>
								{phase.message}
								{#if phase.uploaded !== undefined}
									<Button
										variant="outline"
										size="sm"
										class="mt-2"
										onclick={() => {
											editor.sync.discard();
											open = false;
										}}
									>
										{t(msg("upload_start_over"))}
									</Button>
								{/if}
							</Alert.Description>
						</Alert.Root>
					{/if}

					<Dialog.Footer>
						<Button
							variant="outline"
							disabled={phase.kind === "uploading"}
							onclick={cancel}
						>
							{t(msg("cancel"))}
						</Button>
						<Button
							type="submit"
							disabled={busy ||
								conflicts.length > 0 ||
								!session.configured ||
								tooMany !== null ||
								blocking.length > 0}
						>
							{#if phase.kind === "signing-in"}
								<Spinner data-icon="inline-start" />
								{t(msg("save_logging_in"))}
							{:else if busy}
								<Spinner data-icon="inline-start" />
								{t(msg("save_uploading"))}
							{:else}
								{t(msg("save_upload"))}
							{/if}
						</Button>
					</Dialog.Footer>
				</form>
			{/if}
		</DialogPrimitive.Content>
	</Dialog.Portal>
</Dialog.Root>
