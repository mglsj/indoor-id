<!-- An operation in a menu (the bar's More and Transform, the right-click menu): a disabled
     one says why under its name (A.3). -->
<script lang="ts">
	import * as DropdownMenu from "#lib/components/shadcn/dropdown-menu/index.ts";
	import type { Operation } from "#lib/edit/operations.ts";
	import { type Message, t } from "#lib/i18n/messages.ts";
	import { OPERATION_ICONS } from "#lib/ui/operation-icons.ts";

	interface Props {
		operation: Operation;
		/** Why it can't run now, or null. */
		disabled: Message | null;
		/** Its key, formatted ("" for none). */
		keys: string;
		onrun: (operation: Operation) => void;
	}

	let { operation, disabled, keys, onrun }: Props = $props();
	const Icon = $derived(OPERATION_ICONS[operation.id]);
</script>

<DropdownMenu.Item
	disabled={disabled !== null}
	class={disabled ? "items-start" : ""}
	onSelect={() => onrun(operation)}
>
	<Icon />
	<span class="flex min-w-0 flex-col">
		{t(operation.label)}
		{#if disabled}
			<span class="text-xs text-muted-foreground">{t(disabled)}</span>
		{/if}
	</span>
	<DropdownMenu.Shortcut>{keys}</DropdownMenu.Shortcut>
</DropdownMenu.Item>
