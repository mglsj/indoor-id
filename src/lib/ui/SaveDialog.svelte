<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
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
	import { getEditor } from "#lib/state/editor.svelte.ts";
	import type { Session } from "#lib/state/session.svelte.ts";
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
		onclose: () => void;
	}

	let {
		session,
		imagery,
		floorPlans = false,
		onuploaded,
		websiteUrl,
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
		if (!isOpen) onclose();
	}}
>
	<Dialog.Content
		showCloseButton={false}
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
					{t(msg("save_features_changed", { count: editor.history.editCount }))}
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
					>{t(msg("save_changeset_link", { changeset: phase.changesetId }))}</a
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
						<ul class="list-disc pl-4">
							{#each issues as issue (issue.id)}
								<li>{t(issue.message)} ({issue.entityId})</li>
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
					<Alert.Root role="note" aria-label={t(msg("upload_conflicts_title"))}>
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
	</Dialog.Content>
</Dialog.Root>
