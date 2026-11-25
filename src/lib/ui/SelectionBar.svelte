<!-- The selection bar (A.3): the main operations labelled, the rest in More and Transform, and
     zoom to the selection. -->
<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import Scan from "@lucide/svelte/icons/scan";
	import Shapes from "@lucide/svelte/icons/shapes";
	import type { Component } from "svelte";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import * as DropdownMenu from "#lib/components/shadcn/dropdown-menu/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";
	import type { Operation, OperationGroup } from "#lib/edit/operations.ts";
	import { type Message, msg, t } from "#lib/i18n/messages.ts";
	import OperationItem from "#lib/ui/OperationItem.svelte";
	import {
		type OfferedOperation,
		OPERATION_ICONS,
	} from "#lib/ui/operation-icons.ts";
	import { roving } from "#lib/ui/roving.ts";

	interface Props {
		/** The selection's operations, in the bar's groups (`groupOperations`). */
		grouped: Record<OperationGroup, readonly OfferedOperation[]>;
		/** An operation's key, formatted ("" for none). */
		keyOf: (operation: Operation) => string;
		onrun: (operation: Operation) => void;
		onzoom: () => void;
	}

	let { grouped, keyOf, onrun, onzoom }: Props = $props();
</script>

{#snippet operationButton(operation: Operation, disabled: Message | null)}
	{@const Icon = OPERATION_ICONS[operation.id]}
	{@const label = t(operation.label)}
	{@const reasonId = `operation-reason-${operation.id}`}
	<Tooltip.Root>
		<Tooltip.Trigger onclick={() => onrun(operation)}>
			{#snippet child({ props })}
				<!-- aria-disabled, not disabled: the tooltip still says why, and so does the
				     description (A.3). Labelled: the six main actions (A.3). -->
				<Button
					{...props}
					variant="outline"
					aria-label={label}
					aria-disabled={disabled !== null}
					aria-describedby={disabled ? reasonId : undefined}
					class={disabled ? "opacity-50" : ""}
				>
					<Icon data-icon="inline-start" />
					<!-- Icons only when the map is narrow (the side panel open on a small screen). -->
					<span class="hidden @min-[44rem]:inline"
						>{t(operation.short ?? operation.label)}</span
					>
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom">
			{@const key = keyOf(operation)}
			{label}{key ? ` (${key})` : ""}{disabled ? `: ${t(disabled)}` : ""}
		</Tooltip.Content>
	</Tooltip.Root>
	{#if disabled}
		<span id={reasonId} class="sr-only">{t(disabled)}</span>
	{/if}
{/snippet}

<!-- More ▾ or Transform ▾ (A.3). -->
{#snippet operationMenu(
	label: string,
	Icon: Component,
	entries: readonly OfferedOperation[],
)}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline">
					<Icon data-icon="inline-start" />
					{label}
					<ChevronDown data-icon="inline-end" />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<!-- Focus stays off the trigger: a transform tool takes typed values next. -->
		<DropdownMenu.Content
			align="start"
			class="w-64"
			onCloseAutoFocus={(event) => event.preventDefault()}
		>
			{#each entries as { operation, disabled } (operation.id)}
				<OperationItem {operation} {disabled} keys={keyOf(operation)} {onrun} />
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<div class="flex flex-wrap gap-2" data-testid="selection-bar">
	<div class="rounded-md bg-background shadow-md">
		<ButtonGroup.Root
			role="toolbar"
			aria-label={t(msg("toolbar_selection"))}
			{@attach roving()}
		>
			{#each grouped.main as { operation, disabled } (operation.id)}
				{@render operationButton(operation, disabled)}
			{/each}
			{#if grouped.more.length > 0}
				{@render operationMenu(
					t(msg("operations_more")),
					Ellipsis,
					grouped.more,
				)}
			{/if}
			{#if grouped.transform.length > 0}
				{@render operationMenu(
					t(msg("operations_transform")),
					Shapes,
					grouped.transform,
				)}
			{/if}
		</ButtonGroup.Root>
	</div>
	<div class="rounded-md bg-background shadow-md">
		<Tooltip.Root>
			<Tooltip.Trigger onclick={onzoom}>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="outline"
						size="icon"
						aria-label={t(msg("zoom_to_selection"))}
					>
						<Scan />
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom"
				>{t(
					msg("with_shortcut", {
						label: t(msg("zoom_to_selection")),
						keys: "Z",
					}),
				)}</Tooltip.Content
			>
		</Tooltip.Root>
	</div>
</div>
