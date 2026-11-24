<script lang="ts">
	/**
	 * The shortcuts help (P6, `?`): every key of the editor, listed from `edit/keymap.ts`, so it
	 * shows what the keys do rather than a copy that can drift.
	 */
	import * as Dialog from "#lib/components/shadcn/dialog/index.ts";
	import { KEY_GROUPS } from "#lib/edit/keymap.ts";
	import { formatCombo } from "#lib/edit/keys.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import { resolve } from "$app/paths";

	interface Props {
		open: boolean;
		/** Whether to show the Mac's symbols (⌘) rather than Ctrl. */
		mac: boolean;
	}

	let { open = $bindable(), mac }: Props = $props();

	/** A key as shown: modifiers alone ("Shift") and words ("Arrows") as they are. */
	function shown(combo: string): string {
		if (combo === "Shift" || combo === "Alt" || combo === "Arrows")
			return mac && combo === "Alt"
				? "⌥"
				: combo === "Arrows"
					? "← ↑ → ↓"
					: combo;
		return formatCombo(combo, mac);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{t(msg("shortcuts_title"))}</Dialog.Title>
			<Dialog.Description>{t(msg("shortcuts_description"))}</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-6 sm:grid-cols-2">
			{#each KEY_GROUPS as group (group.title.key)}
				<section aria-label={t(group.title)}>
					<h3 class="mb-2 text-sm font-medium">{t(group.title)}</h3>
					<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
						{#each group.keys as entry (entry.action)}
							<dt>
								<kbd
									class="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs whitespace-nowrap"
									>{shown(entry.combo)}</kbd
								>
							</dt>
							<dd class="text-muted-foreground">{t(entry.label)}</dd>
						{/each}
					</dl>
				</section>
			{/each}
		</div>
		<p class="text-sm">
			<a
				class="underline underline-offset-2"
				href={resolve("/help")}
				target="_blank"
				rel="noopener"
				>{t(msg("help_page_link"))}</a
			>
		</p>
	</Dialog.Content>
</Dialog.Root>
