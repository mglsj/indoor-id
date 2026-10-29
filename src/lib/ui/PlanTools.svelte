<script lang="ts">
	import Eraser from "@lucide/svelte/icons/eraser";
	import Info from "@lucide/svelte/icons/info";
	import X from "@lucide/svelte/icons/x";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import * as RadioGroup from "#lib/components/shadcn/radio-group/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Slider } from "#lib/components/shadcn/slider/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import {
		type PlanPosition,
		positionOf,
		type TransformKind,
	} from "#lib/floorplans/georef.ts";
	import { type Message, t } from "#lib/i18n/messages.ts";
	import {
		type FloorPlans,
		MIN_POINTS,
		type PlanBuilding,
		type Tool,
	} from "#lib/state/floorplans.svelte.ts";

	interface Props {
		floorplans: FloorPlans;
		/** Why the alignment tool ignored the last map click, if it did. */
		toolMessage?: Message | null;
		/** The buildings under the plan in Edit, the one around its centre first. */
		buildings?: readonly PlanBuilding[];
	}

	let { floorplans, toolMessage = null, buildings = [] }: Props = $props();

	let east = $state<number>(0);
	let north = $state<number>(0);

	function offset(event: SubmitEvent) {
		event.preventDefault();
		if (Number.isFinite(east) && Number.isFinite(north)) {
			floorplans.offset(east ?? 0, north ?? 0);
		}
	}

	/** The buildings to pick from: those under the plan, and the one assigned if elsewhere. */
	const buildingChoices = $derived.by(() => {
		const assigned = floorplans.editing?.building;
		return assigned && !buildings.some((b) => b.id === assigned)
			? [...buildings, { id: assigned, name: `Building ${assigned}` }]
			: buildings;
	});

	let distance = $state<number>();
	let layerQuery = $state("");
	let angle = $state<number>(90);

	/** Where the plan in Edit is, following it as it is dragged. */
	const position = $derived.by(() => {
		const plan = floorplans.editing;
		return (
			plan && positionOf(plan.transform, plan.size.width, plan.size.height)
		);
	});
	/** The position as the fields show it: rounded to a centimetre or so, 0.1°. */
	const shown = $derived(
		position && {
			latitude: round(position.center[1], 7),
			longitude: round(position.center[0], 7),
			rotation: round(position.bearing, 1) % 360,
			width: round(position.width, 2),
		},
	);

	function round(value: number, digits: number): number {
		return Number(value.toFixed(digits));
	}

	/**
	 * Places the plan from a field's value, or puts the field back when its value can't be one
	 * (`change` gives null).
	 */
	function place(
		event: Event & { currentTarget: HTMLInputElement },
		change: (value: number) => Partial<PlanPosition> | null,
		shownValue: number,
	) {
		const value = event.currentTarget.valueAsNumber;
		const changes = Number.isFinite(value) ? change(value) : null;
		if (changes) floorplans.setPosition(changes);
		else event.currentTarget.value = String(shownValue);
	}

	/** The CAD layers of the plan in Edit, when it is drawn from paths that have some. */
	const cadLayers = $derived.by(() => {
		const plan = floorplans.editing;
		return (plan && floorplans.contents.get(plan.id)?.vector?.layers) ?? [];
	});
	/** The layers whose name has what was typed in the search box. */
	const listedLayers = $derived.by(() => {
		const query = layerQuery.trim().toLocaleLowerCase();
		return query
			? cadLayers.filter((l) => l.name.toLocaleLowerCase().includes(query))
			: cadLayers;
	});

	function setLayerShown(id: string, shown: boolean) {
		const plan = floorplans.editing;
		if (!plan) return;
		const others = plan.hiddenLayers.filter((h) => h !== id);
		floorplans.setHiddenLayers(plan.id, shown ? others : [...others, id]);
	}

	/** Shows or hides every layer listed, leaving the others as they are. */
	function setListedShown(shown: boolean) {
		const plan = floorplans.editing;
		if (!plan) return;
		const listed = new Set(listedLayers.map((l) => l.id));
		const hidden = plan.hiddenLayers.filter((id) => !listed.has(id));
		floorplans.setHiddenLayers(
			plan.id,
			shown
				? hidden
				: [
						...plan.hiddenLayers,
						...[...listed].filter((id) => !plan.hiddenLayers.includes(id)),
					],
		);
	}

	const tool = $derived(floorplans.tool);
	/** Whether the plan has control points, or the tool a half-done pick, to clear. */
	const canClear = $derived.by(() => {
		if ((floorplans.editing?.controlPoints.length ?? 0) > 0) return true;
		switch (tool?.kind) {
			case "points":
				return tool.pending !== null;
			case "measure":
				return tool.points.length > 0;
			case "rotate":
				return tool.pin !== null;
			default:
				return false;
		}
	});
	const fit = $derived(floorplans.fit);
	const hint = $derived.by(() => {
		switch (tool?.kind) {
			case "points":
				return tool.pending
					? "Now click where that spot is on the map. Clicks near an OSM node or side, such as a building's corner or wall, snap to it."
					: "Click a spot on the plan, such as a corner, then where it is on the map.";
			case "measure":
				return tool.points.length < 2
					? "Click two spots on the plan whose real distance you know."
					: "Give the real distance between the two spots.";
			case "rotate":
				return tool.pin
					? "Turn the plan around the picked spot."
					: "Click the spot on the plan to turn around.";
			default:
				return "Drag the plan to move it, a corner to resize it, the round handle above it to turn it. While dragging a corner: Shift stretches, Ctrl (⌘) resizes from the centre, Alt moves that corner alone. Shift turns in 15° steps. For precise placement, type its position or pick a tool.";
		}
	});
	const FIT_KINDS: { kind: TransformKind; label: string }[] = [
		{ kind: "similarity", label: "Similarity" },
		{ kind: "affine", label: "Affine" },
		{ kind: "projective", label: "Perspective" },
	];

	function scale(event: SubmitEvent) {
		event.preventDefault();
		if (distance && distance > 0) floorplans.scaleTo(distance);
	}

	function rotate(event: SubmitEvent) {
		event.preventDefault();
		if (Number.isFinite(angle)) floorplans.rotate(angle);
	}
</script>

<!-- The plan in Edit's settings and alignment tools; nothing while no plan is in Edit. -->
{#if floorplans.editing}
	{@const plan = floorplans.editing}
	<section
		aria-label={`Editing ${plan.name}`}
		class="flex flex-col gap-4 rounded-md border p-3"
	>
		<div class="flex items-center gap-2">
			<h3 class="min-w-0 flex-1 truncate text-sm font-medium">
				Editing {plan.name}
			</h3>
			<Button size="sm" variant="outline" onclick={() => floorplans.cancel()}
				>Cancel</Button
			>
			<Button size="sm" onclick={() => floorplans.done()}>Done</Button>
		</div>
		<Field.Field>
			<Field.Label for="plan-level">Level</Field.Label>
			<Input
				id="plan-level"
				type="text"
				autocomplete="off"
				placeholder="Every level"
				value={plan.level ?? ""}
				onchange={(event) =>
					floorplans.update(plan.id, {
						level: event.currentTarget.value.trim() || null,
					})}
			/>
			<Field.Description>
				The plan only shows on this level, like 0 or -1.
			</Field.Description>
		</Field.Field>

		{#if buildingChoices.length > 0}
			<Field.Set>
				<Field.Legend variant="label">Building</Field.Legend>
				<RadioGroup.Root
					value={plan.building ?? ""}
					onValueChange={(value) => floorplans.setBuilding(value || null)}
				>
					{#each [
						{ id: "", name: "None" },
						...buildingChoices,
					] as choice (choice.id)}
						{@const radioId = `plan-building-${choice.id || "none"}`}
						<Field.Field orientation="horizontal">
							<RadioGroup.Item value={choice.id} id={radioId} />
							<Field.Label for={radioId} class="font-normal">
								{choice.name}
							</Field.Label>
						</Field.Field>
					{/each}
				</RadioGroup.Root>
				<Field.Description>
					The building the plan is of, named in the plan list.
				</Field.Description>
			</Field.Set>
		{/if}

		<Field.Field>
			<Field.Label for="plan-opacity">Opacity</Field.Label>
			<Slider
				id="plan-opacity"
				type="single"
				min={0}
				max={1}
				step={0.05}
				value={plan.opacity}
				onValueChange={(opacity: number) =>
					floorplans.update(plan.id, { opacity })}
			/>
		</Field.Field>

		{#if cadLayers.length > 0}
			{@const hidden = new Set(plan.hiddenLayers)}
			<Field.Set>
				<Field.Legend variant="label">Layers</Field.Legend>
				<Field.Description>
					The drawing's CAD layers, {cadLayers.length - hidden.size} of
					{cadLayers.length}
					shown. Show all and Hide all act on the layers listed.
				</Field.Description>
				<Input
					type="search"
					placeholder="Find a layer"
					aria-label="Find a layer"
					autocomplete="off"
					bind:value={layerQuery}
				/>
				<div class="flex gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={listedLayers.length === 0}
						onclick={() => setListedShown(true)}
						>Show all</Button
					>
					<Button
						size="sm"
						variant="outline"
						disabled={listedLayers.length === 0}
						onclick={() => setListedShown(false)}
						>Hide all</Button
					>
				</div>
				<ScrollArea class="*:data-[slot=scroll-area-viewport]:max-h-60">
					<ul class="flex flex-col gap-2">
						{#each listedLayers as layer (layer.id)}
							{@const id = `plan-layer-${layer.id}`}
							<li class="flex items-center gap-2">
								<Checkbox
									{id}
									checked={!hidden.has(layer.id)}
									onCheckedChange={(on) => setLayerShown(layer.id, on)}
								/>
								<Field.Label for={id} class="min-w-0 truncate font-normal"
									>{layer.name}</Field.Label
								>
							</li>
						{:else}
							<li class="text-sm text-muted-foreground">
								No layer has that name.
							</li>
						{/each}
					</ul>
				</ScrollArea>
			</Field.Set>
		{/if}

		{#if position && shown}
			<Field.Set>
				<Field.Legend variant="label">Position</Field.Legend>
				<div class="grid grid-cols-2 gap-3">
					<Field.Field>
						<Field.Label for="plan-latitude">Latitude</Field.Label>
						<Input
							id="plan-latitude"
							type="number"
							step="any"
							min={-85}
							max={85}
							value={shown.latitude}
							onchange={(event) =>
								place(
									event,
									(lat) =>
										Math.abs(lat) <= 85
											? { center: [position.center[0], lat] }
											: null,
									shown.latitude,
								)}
						/>
					</Field.Field>
					<Field.Field>
						<Field.Label for="plan-longitude">Longitude</Field.Label>
						<Input
							id="plan-longitude"
							type="number"
							step="any"
							min={-180}
							max={180}
							value={shown.longitude}
							onchange={(event) =>
								place(
									event,
									(lon) =>
										Math.abs(lon) <= 180
											? { center: [lon, position.center[1]] }
											: null,
									shown.longitude,
								)}
						/>
					</Field.Field>
					<Field.Field>
						<Field.Label for="plan-rotation">Rotation (°)</Field.Label>
						<Input
							id="plan-rotation"
							type="number"
							step="any"
							value={shown.rotation}
							onchange={(event) =>
								place(
									event,
									(degrees) => ({ bearing: ((degrees % 360) + 360) % 360 }),
									shown.rotation,
								)}
						/>
					</Field.Field>
					<Field.Field>
						<Field.Label for="plan-width">Width (m)</Field.Label>
						<Input
							id="plan-width"
							type="number"
							step="any"
							min={0}
							value={shown.width}
							onchange={(event) =>
								place(
									event,
									(width) => (width > 0 ? { width } : null),
									shown.width,
								)}
						/>
					</Field.Field>
				</div>
				<Field.Description>
					The centre, the direction the plan's top faces (clockwise from north)
					and its real width. A value typed moves the plan around its centre;
					its control points go.
				</Field.Description>
			</Field.Set>

			<form class="flex flex-col gap-2" onsubmit={offset}>
				<Field.Set>
					<Field.Legend variant="label">Move by</Field.Legend>
					<div class="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
						<Field.Field>
							<Field.Label for="plan-east">East (m)</Field.Label>
							<Input
								id="plan-east"
								type="number"
								step="any"
								bind:value={east}
							/>
						</Field.Field>
						<Field.Field>
							<Field.Label for="plan-north">North (m)</Field.Label>
							<Input
								id="plan-north"
								type="number"
								step="any"
								bind:value={north}
							/>
						</Field.Field>
						<Button type="submit" variant="outline" size="sm">Move</Button>
					</div>
					<Field.Description>
						Negative values move it west or south.
					</Field.Description>
				</Field.Set>
			</form>
		{/if}

		<Field.Field>
			<Field.Label id="plan-tool-label">Align</Field.Label>
			<ToggleGroup.Root
				type="single"
				variant="outline"
				size="sm"
				aria-labelledby="plan-tool-label"
				class="w-full"
				value={tool?.kind ?? ""}
				onValueChange={(kind) =>
					floorplans.setTool((kind || null) as Tool["kind"] | null)}
			>
				<ToggleGroup.Item value="points" class="flex-1"
					>Control points
				</ToggleGroup.Item>
				<ToggleGroup.Item value="measure" class="flex-1"
					>Measure
				</ToggleGroup.Item>
				<ToggleGroup.Item value="rotate" class="flex-1"
					>Rotate
				</ToggleGroup.Item>
			</ToggleGroup.Root>
			<Field.Description>{hint}</Field.Description>
			{#if tool}
				<Button
					variant="outline"
					size="sm"
					class="self-start"
					disabled={!canClear}
					onclick={() => floorplans.clearPoints()}
				>
					<Eraser data-icon="inline-start" />
					Clear
				</Button>
			{/if}
		</Field.Field>

		{#if toolMessage && tool}
			<Alert.Root>
				<Info />
				<Alert.Description>{t(toolMessage)}</Alert.Description>
			</Alert.Root>
		{/if}

		{#if tool?.kind === "points"}
			{#if plan.controlPoints.length > 0}
				<ol aria-label="Control points" class="flex flex-col gap-1 text-sm">
					{#each plan.controlPoints as _, i (i)}
						<li class="flex items-center gap-2">
							<span class="w-5 text-muted-foreground tabular-nums"
								>{i + 1}</span
							>
							{" "}
							<span class="flex-1 tabular-nums">
								{fit
									? `${(fit.residuals[i] ?? 0).toFixed(2)} m`
									: "Moves the plan"}
							</span>
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={`Remove control point ${i + 1}`}
								onclick={() => floorplans.removeControlPoint(i)}
							>
								<X />
							</Button>
						</li>
					{/each}
				</ol>
			{/if}
			<Field.Field>
				<Field.Label id="plan-fit-label">Fit</Field.Label>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					size="sm"
					aria-labelledby="plan-fit-label"
					class="w-full"
					value={plan.fitKind}
					onValueChange={(kind) => {
						if (kind) floorplans.setFitKind(kind as TransformKind);
					}}
				>
					{#each FIT_KINDS as { kind, label } (kind)}
						<ToggleGroup.Item value={kind} class="flex-1"
							>{label}</ToggleGroup.Item
						>
					{/each}
				</ToggleGroup.Root>
				<Field.Description>
					{#if plan.controlPoints.length < MIN_POINTS[plan.fitKind]}
						Needs {MIN_POINTS[plan.fitKind]} points; until then the plan keeps
						its shape.
					{:else if fit}
						RMS error {fit.rms.toFixed(2)} m
					{/if}
				</Field.Description>
			</Field.Field>
		{:else if tool?.kind === "measure" && tool.points.length === 2}
			<form class="flex items-end gap-2" onsubmit={scale}>
				<Field.Field>
					<Field.Label for="plan-distance">Real distance (m)</Field.Label>
					<Input
						id="plan-distance"
						type="number"
						min={0}
						step="any"
						required
						bind:value={distance}
					/>
				</Field.Field>
				<Button type="submit">Scale</Button>
			</form>
		{:else if tool?.kind === "rotate" && tool.pin}
			<form class="flex items-end gap-2" onsubmit={rotate}>
				<Field.Field>
					<Field.Label for="plan-angle">Angle (°, clockwise)</Field.Label>
					<Input
						id="plan-angle"
						type="number"
						step="any"
						required
						bind:value={angle}
					/>
				</Field.Field>
				<Button type="submit">Rotate</Button>
			</form>
		{/if}
	</section>
{/if}
