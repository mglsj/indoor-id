<script lang="ts">
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Dialog from "#lib/components/shadcn/dialog/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { FloorPlans } from "#lib/state/floorplans.svelte.ts";

	interface Props {
		/** Asks while `floorplans.confirming`, and answers with `floorplans.resolve`. */
		floorplans: FloorPlans;
	}

	let { floorplans }: Props = $props();
</script>

<Dialog.Root
	open={floorplans.confirming}
	onOpenChange={(open) => {
		// Escape or a click outside: back to editing.
		if (!open && floorplans.confirming) floorplans.resolve("keep");
	}}
>
	<Dialog.Content showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>Save changes to {floorplans.editing?.name}?</Dialog.Title>
			<Dialog.Description>
				{t(msg("unsaved_plan_this_floor_plan_has"))}
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => floorplans.resolve("keep")}>
				{t(msg("unsaved_plan_keep_editing"))}
			</Button>
			<Button variant="outline" onclick={() => floorplans.resolve("discard")}>
				{t(msg("restore_discard"))}
			</Button>
			<Button onclick={() => floorplans.resolve("save")}
				>{t(msg("save"))}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
