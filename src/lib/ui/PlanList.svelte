<script lang="ts">
	import Building2 from "@lucide/svelte/icons/building-2";
	import Eye from "@lucide/svelte/icons/eye";
	import EyeOff from "@lucide/svelte/icons/eye-off";
	import GripVertical from "@lucide/svelte/icons/grip-vertical";
	import Pencil from "@lucide/svelte/icons/pencil";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import { tick } from "svelte";
	import type { Attachment } from "svelte/attachments";
	import * as AlertDialog from "#lib/components/shadcn/alert-dialog/index.ts";
	import { Badge } from "#lib/components/shadcn/badge/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import { BUILDING_COLOR, PLAN_COLORS } from "#lib/floorplans/colors.ts";
	import { levelToShow } from "#lib/levels/levels.ts";
	import {
		BUILDINGS,
		type FloorPlan,
		type FloorPlans,
		type LayerEntry,
	} from "#lib/state/floorplans.svelte.ts";

	interface Props {
		floorplans: FloorPlans;
		/** The level shown. */
		level: number;
		/** Switches the map to a level, to show a plan on it. */
		onshowlevel: (level: number) => void;
	}

	let { floorplans, level, onshowlevel }: Props = $props();

	/** The layer list, top first: the map draws the first row on top. */
	const rows = $derived([...floorplans.layers].reverse());
	/** The row being dragged by its grip (plan id or BUILDINGS), and where it would land. */
	let dragging = $state<string | null>(null);
	/** Row index the dragged row would be dropped before (`rows.length`: after the last). */
	let dropAt = $state<number | null>(null);
	/** The plan whose removal is being confirmed. */
	let removing = $state.raw<FloorPlan | null>(null);
	/** The plan whose colour palette is open. */
	let choosingColor = $state<string | null>(null);

	function keyOf(row: LayerEntry): string {
		return row.kind === "plan" ? row.plan.id : BUILDINGS;
	}

	/** Moves the row `key` so it is shown at `row` in the list (0 = top). */
	async function moveRow(key: string, row: number) {
		floorplans.move(key, rows.length - 1 - row);
		// Keyed rows move with their grip, which keeps the focus for further Alt+arrows.
		await tick();
		document.querySelector<HTMLElement>(`[data-grip="${key}"]`)?.focus();
	}

	function drop() {
		const key = dragging;
		const at = dropAt;
		dragging = null;
		dropAt = null;
		if (key === null || at === null) return;
		const from = rows.findIndex((r) => keyOf(r) === key);
		void moveRow(key, at > from ? at - 1 : at);
	}

	function onGripKey(event: KeyboardEvent, key: string, row: number) {
		if (!event.altKey) return;
		if (event.key === "ArrowUp" && row > 0) {
			event.preventDefault();
			void moveRow(key, row - 1);
		} else if (event.key === "ArrowDown" && row < rows.length - 1) {
			event.preventDefault();
			void moveRow(key, row + 1);
		}
	}

	/** Shows the plan's level: its own, or with several, the shown one if it is among them. */
	function showLevelOf(plan: { readonly level: string | null }) {
		onshowlevel(levelToShow(plan.level, level));
	}

	/** A plan's size as the list shows it: its raster's pixels, else its plan units. */
	function sizeLabel(plan: FloorPlan): string {
		const image = floorplans.contents.get(plan.id)?.raster?.image;
		const { width, height } = image ?? plan.size;
		return `${Math.round(width)} × ${Math.round(height)}${image ? " px" : ""}`;
	}

	/** Shows a plan's image, through an object URL freed with the element. */
	function thumbnail(blob: Blob | undefined): Attachment<HTMLImageElement> {
		return (img) => {
			if (!blob) return;
			const url = URL.createObjectURL(blob);
			img.src = url;
			return () => URL.revokeObjectURL(url);
		};
	}
</script>

{#snippet swatch(
	color: string,
)}
	<span
		data-slot="swatch"
		class="size-4 rounded-full ring-1 ring-foreground/20"
		style:background-color={color}
	></span>
{/snippet}

<ul aria-label="Layers" class="flex flex-col">
	{#each rows as row, i (keyOf(row))}
		{@const key = keyOf(row)}
		{@const editing =
			row.kind === "plan" && row.plan.id === floorplans.editingId}
		<li
			class={[
				"flex items-center gap-2 rounded-md border-y-2 border-transparent p-1",
				editing && "bg-muted",
				dropAt === i && "border-t-primary",
				dropAt === rows.length && i === rows.length - 1 && "border-b-primary",
			]}
			aria-current={editing}
			ondragover={(event) => {
				if (!dragging) return;
				event.preventDefault();
				const box = event.currentTarget.getBoundingClientRect();
				dropAt = event.clientY < box.top + box.height / 2 ? i : i + 1;
			}}
			ondrop={(event) => {
				event.preventDefault();
				drop();
			}}
		>
			<button
				type="button"
				draggable="true"
				data-grip={key}
				class="flex h-8 w-4 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
				aria-label={`Move ${row.kind === "plan" ? row.plan.name : "buildings"}`}
				title="Drag to reorder, or Alt+↑ / Alt+↓"
				ondragstart={(event) => {
					dragging = key;
					event.dataTransfer?.setData("text/plain", key);
					if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
				}}
				ondragend={() => {
					dragging = null;
					dropAt = null;
				}}
				onkeydown={(event) => onGripKey(event, key, i)}
			>
				<GripVertical class="size-4" />
			</button>
			{#if row.kind === "buildings"}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Show buildings"
					aria-pressed={floorplans.buildings.visible}
					onclick={() =>
						floorplans.setBuildingsVisible(!floorplans.buildings.visible)}
				>
					{#if floorplans.buildings.visible}
						<Eye />
					{:else}
						<EyeOff />
					{/if}
				</Button>
				<span class="flex size-6 shrink-0 items-center justify-center">
					{@render swatch(BUILDING_COLOR)}
				</span>
				<span
					class="flex size-10 shrink-0 items-center justify-center rounded-sm border"
				>
					<Building2 class="size-5 text-muted-foreground" />
				</span>
				<span class="min-w-0 flex-1 text-sm">
					<span class="block truncate font-medium">Buildings</span>
					{" "}
					<span class="block text-xs text-muted-foreground"
						>Outlines from OpenStreetMap</span
					>
				</span>
			{:else}
				{@const plan = row.plan}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Show ${plan.name}`}
					aria-pressed={plan.visible}
					onclick={() => floorplans.setVisible(plan.id, !plan.visible)}
				>
					{#if plan.visible}
						<Eye />
					{:else}
						<EyeOff />
					{/if}
				</Button>
				{#if editing}
					<Popover.Root
						open={choosingColor === plan.id}
						onOpenChange={(open) => (choosingColor = open ? plan.id : null)}
					>
						<Popover.Trigger
							class="flex size-6 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							aria-label={`Colour of ${plan.name}`}
						>
							{@render swatch(plan.color)}
						</Popover.Trigger>
						<Popover.Content align="start" class="w-auto p-2">
							<fieldset class="grid grid-cols-4 gap-1">
								<legend class="sr-only">Colours for {plan.name}</legend>
								{#each PLAN_COLORS as color (color.value)}
									<button
										type="button"
										aria-label={color.name}
										title={color.name}
										aria-pressed={plan.color === color.value}
										class="flex size-8 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-muted"
										onclick={() => {
											floorplans.update(plan.id, { color: color.value });
											choosingColor = null;
										}}
									>
										<span
											class="size-5 rounded-full ring-1 ring-foreground/20"
											style:background-color={color.value}
										></span>
									</button>
								{/each}
							</fieldset>
						</Popover.Content>
					</Popover.Root>
				{:else}
					<span class="flex size-6 shrink-0 items-center justify-center">
						{@render swatch(plan.color)}
					</span>
				{/if}
				{#if editing}
					<img
						{@attach thumbnail(floorplans.thumbnails.get(plan.id))}
						alt=""
						class="size-10 shrink-0 rounded-sm border object-contain"
					>
					<span class="min-w-0 flex-1 text-sm">
						<Input
							aria-label="Name"
							autocomplete="off"
							class="h-7 px-2 font-medium"
							value={plan.name}
							onchange={(event) => {
								const name = event.currentTarget.value.trim();
								if (name) floorplans.update(plan.id, { name });
								else event.currentTarget.value = plan.name;
							}}
						/>
						<span class="mt-0.5 block truncate text-xs text-muted-foreground"
							>{sizeLabel(plan)}</span
						>
					</span>
				{:else}
					<!-- The row itself: shows the plan's level. -->
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
						title="Show this plan's level"
						onclick={() => showLevelOf(plan)}
					>
						<img
							{@attach thumbnail(floorplans.thumbnails.get(plan.id))}
							alt=""
							class="size-10 shrink-0 rounded-sm border object-contain"
						>
						<span class="min-w-0 flex-1 text-sm">
							<span class="block truncate font-medium">{plan.name}</span>
							{" "}
							<span class="block truncate text-xs text-muted-foreground"
								>{sizeLabel(plan)}</span
							>
						</span>
					</button>
				{/if}
				<Badge
					variant="outline"
					class="shrink-0 tabular-nums"
					title="Level the plan shows on"
				>
					<span class="sr-only">Level</span>
					{plan.level ?? "All"}
				</Badge>
				{#if !editing}
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Edit ${plan.name}`}
						onclick={() =>
							floorplans.whenSaved(() => {
								floorplans.edit(plan.id);
								showLevelOf(plan);
							})}
					>
						<Pencil />
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="icon-sm"
					class="text-destructive hover:text-destructive"
					aria-label={`Remove ${plan.name}`}
					onclick={() => (removing = plan)}
				>
					<Trash2 />
				</Button>
			{/if}
		</li>
	{/each}
</ul>
{#if floorplans.plans.length === 0}
	<p class="text-sm text-muted-foreground">No floor plan yet.</p>
{:else if !floorplans.editing}
	<p class="text-sm text-muted-foreground">
		Plans are locked: press Edit on one to move, align or change it.
	</p>
{/if}

<AlertDialog.Root
	open={removing !== null}
	onOpenChange={(open) => {
		if (!open) removing = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove {removing?.name}?</AlertDialog.Title>
			<AlertDialog.Description>
				The plan and its image are deleted from this browser. Export the plans
				first to keep a copy.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				variant="destructive"
				onclick={() => {
					if (removing) floorplans.remove(removing.id);
					removing = null;
				}}
			>
				Remove
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
