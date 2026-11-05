<script lang="ts">
	/**
	 * Asks on start whether to restore autosaved edits (P5.4a): this tab's before a reload, or
	 * those of a tab closed without uploading them.
	 */
	import * as AlertDialog from "#lib/components/shadcn/alert-dialog/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";

	interface Props {
		/** The edits found: how many features they change, and when they were saved (ms). */
		offer: { readonly count: number; readonly saved: number } | null;
		onrestore: () => void;
		ondiscard: () => void;
	}

	let { offer, onrestore, ondiscard }: Props = $props();
</script>

<AlertDialog.Root open={offer !== null}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t(msg("restore_title"))}</AlertDialog.Title>
			<AlertDialog.Description>
				{#if offer}
					{t(
						msg("restore_description", {
							count: String(offer.count),
							saved: new Date(offer.saved).toLocaleString(),
						}),
					)}
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={ondiscard}>
				{t(msg("restore_discard"))}
			</AlertDialog.Cancel>
			<AlertDialog.Action onclick={onrestore}>
				{t(msg("restore_restore"))}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
