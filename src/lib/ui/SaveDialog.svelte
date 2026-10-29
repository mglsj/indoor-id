<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
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
	import { msg, t } from "#lib/i18n/messages.ts";
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
		| { kind: "error"; message: string }
	>({ kind: "form" });

	const issues = $derived(editor.editIssues);
	/** Issues the upload waits on: the server would take the data broken. */
	const blocking = $derived(issues.filter((i) => BLOCKING_RULES.has(i.rule)));
	const busy = $derived(
		phase.kind === "uploading" || phase.kind === "signing-in",
	);
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
			const { changesetId, notDeleted } = await editor.sync.upload(
				changesetTags({
					comment,
					source,
					imagery,
					floorPlans,
					reviewRequested,
				}),
			);
			phase = { kind: "done", changesetId, notDeleted };
			onuploaded?.();
		} catch (error) {
			// Cancelled: the form is back already.
			if (phase.kind === "form") return;
			if (error instanceof OsmApiError && error.kind === "auth")
				session.logout();
			phase = { kind: "error", message: explain(error) };
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

	function explain(error: unknown): string {
		if (!(error instanceof OsmApiError)) return (error as Error).message;
		switch (error.kind) {
			case "conflict":
				return "Someone else changed the same data in the meantime. Your edits are kept: reload the area to get their changes, then upload again.";
			case "precondition":
				return "Some data you edited was deleted or changed on the server. Your edits are kept: reload the area and check them.";
			case "auth":
				return "OpenStreetMap refused your login. Log in again, then upload.";
			case "rate-limit":
				return "OpenStreetMap is limiting requests right now. Wait a moment and try again.";
			case "network":
				return "OpenStreetMap could not be reached. Check your connection and try again.";
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
			<Dialog.Title>Upload your edits</Dialog.Title>
			{#if phase.kind !== "done"}
				<Dialog.Description>
					{editor.history.editCount}
					feature{editor.history.editCount === 1 ? "" : "s"}
					changed.
				</Dialog.Description>
			{/if}
		</Dialog.Header>

		{#if phase.kind === "done"}
			<p role="status">
				Uploaded in
				<a
					class="text-primary underline underline-offset-4"
					href={`${websiteUrl.replace(/\/+$/, "")}/changeset/${phase.changesetId}`}
					target="_blank"
					rel="noopener"
					>changeset {phase.changesetId}</a
				>. Thank you!
			</p>
			{#if phase.notDeleted.length > 0}
				<Alert.Root role="note" aria-label="Deletions kept">
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
				<Button onclick={() => (open = false)}>Close</Button>
			</Dialog.Footer>
		{:else}
			{#if issues.length > 0}
				<Alert.Root role="note" aria-label="Issues in your edits">
					<TriangleAlert />
					<Alert.Title>Please check before uploading</Alert.Title>
					<Alert.Description>
						<ul class="list-disc pl-4">
							{#each issues as issue (issue.id)}
								<li>{t(issue.message)} ({issue.entityId})</li>
							{/each}
						</ul>
					</Alert.Description>
				</Alert.Root>
			{/if}

			<form class="flex flex-col gap-6" onsubmit={upload}>
				<Field.Group>
					<Field.Field>
						<Field.Label for="changeset-comment">Comment</Field.Label>
						<Textarea
							id="changeset-comment"
							bind:value={comment}
							required
							rows={2}
							maxlength={255}
							placeholder="What did you change? e.g. Add room numbers on the 2nd floor"
						/>
					</Field.Field>
					<Field.Field>
						<Field.Label for="changeset-source">Source</Field.Label>
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
							Ask for someone to review my edits
						</Field.Label>
					</Field.Field>
					<Field.Description>
						{#if !session.configured}
							Login is not configured for this IndoorID instance
							(oauth_client_id).
						{:else if session.loggedIn}
							Logged in{session.userName ? ` as ${session.userName}` : ""}.
							<Button
								variant="link"
								size="xs"
								class="px-0"
								onclick={() => session.logout()}
							>
								Log out
							</Button>
						{:else}
							You will be asked to log in to OpenStreetMap.
						{/if}
					</Field.Description>
				</Field.Group>

				{#if blocking.length > 0}
					<Alert.Root variant="destructive">
						<CircleAlert />
						<Alert.Description>
							Fix the errors above to upload: OSM would get them broken.
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
						<Alert.Description>{phase.message}</Alert.Description>
					</Alert.Root>
				{/if}

				<Dialog.Footer>
					<Button
						variant="outline"
						disabled={phase.kind === "uploading"}
						onclick={cancel}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						disabled={busy ||
							!session.configured ||
							tooMany !== null ||
							blocking.length > 0}
					>
						{#if phase.kind === "signing-in"}
							<Spinner data-icon="inline-start" />
							Logging in…
						{:else if busy}
							<Spinner data-icon="inline-start" />
							Uploading…
						{:else}
							Upload
						{/if}
					</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>
