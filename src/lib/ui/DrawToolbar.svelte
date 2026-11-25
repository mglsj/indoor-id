<!-- The drawing tools (A.2): point, line, area, then building mode's rectangle, split and
     measure (B.3), shown disabled on the map with the reason; measure is a split button that
     also places guides. -->
<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import MapPin from "@lucide/svelte/icons/map-pin";
	import Pentagon from "@lucide/svelte/icons/pentagon";
	import RectangleHorizontal from "@lucide/svelte/icons/rectangle-horizontal";
	import Ruler from "@lucide/svelte/icons/ruler";
	import RulerDimensionLine from "@lucide/svelte/icons/ruler-dimension-line";
	import Scissors from "@lucide/svelte/icons/scissors";
	import Spline from "@lucide/svelte/icons/spline";
	import type { Component } from "svelte";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as ButtonGroup from "#lib/components/shadcn/button-group/index.ts";
	import * as DropdownMenu from "#lib/components/shadcn/dropdown-menu/index.ts";
	import * as Tooltip from "#lib/components/shadcn/tooltip/index.ts";
	import type { MeasureVariant } from "#lib/edit/modes/measure.ts";
	import type { DrawTool, ScopeTools } from "#lib/edit/scope-tools.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import { roving } from "#lib/ui/roving.ts";

	interface Props {
		/** What the scope offers (B.3). */
		offered: ScopeTools;
		/** The tool on, if any. */
		drawing: DrawTool | null;
		/** What the measure tool does while on. */
		measureVariant: MeasureVariant;
		/** No tool starts (an upload is under way). */
		locked: boolean;
		ondraw: (kind: DrawTool) => void;
		/** The menu's "Place guides". */
		onplaceguides: () => void;
		/** The menu's "Measure", once the tool is on. */
		onmeasure: () => void;
	}

	let {
		offered,
		drawing,
		measureVariant,
		locked,
		ondraw,
		onplaceguides,
		onmeasure,
	}: Props = $props();

	/** The measure split button's menu (A.2). */
	let measureMenuOpen = $state(false);
</script>

{#snippet drawButton(
	kind: DrawTool,
	label: string,
	action: string,
	key: string,
	Icon: Component,
)}
	{@const outside = !offered.draw.has(kind)}
	<Tooltip.Root>
		<Tooltip.Trigger onclick={() => ondraw(kind)}>
			{#snippet child({ props })}
				<!-- Tools of building mode stay in their place on the map (A.2), aria-disabled so
				     that the tooltip still says why. -->
				<Button
					{...props}
					variant="outline"
					size="icon"
					aria-label={action}
					aria-pressed={drawing === kind}
					aria-disabled={outside || undefined}
					aria-describedby={outside ? "tool-outside-reason" : undefined}
					class={outside ? "opacity-50" : ""}
					disabled={locked}
				>
					<Icon />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom"
			>{t(msg("with_shortcut", { label, keys: key }))}{outside
				? `: ${t(msg("tool_inside_building_only"))}`
				: ""}</Tooltip.Content
		>
	</Tooltip.Root>
{/snippet}

<ButtonGroup.Root
	role="toolbar"
	aria-label={t(msg("toolbar_draw"))}
	{@attach roving()}
>
	{@render drawButton(
		"point",
		t(msg("tool_point")),
		t(msg("tool_point_action")),
		"1",
		MapPin,
	)}
	{@render drawButton(
		"line",
		t(msg("tool_line")),
		t(msg("tool_line_action")),
		"2",
		Spline,
	)}
	{@render drawButton(
		"area",
		t(msg("tool_area")),
		t(msg("tool_area_action")),
		"3",
		Pentagon,
	)}
	<!-- Building mode's tools (B.3), shown disabled on the map with the reason. -->
	{@render drawButton(
		"rectangle",
		t(msg("tool_rectangle")),
		t(msg("tool_rectangle_action")),
		"4",
		RectangleHorizontal,
	)}
	{@render drawButton(
		"split",
		t(msg("tool_split")),
		t(msg("tool_split_action")),
		"X",
		Scissors,
	)}
	{@render drawButton(
		"measure",
		t(msg("measure_tool")),
		t(msg("measure_tool")),
		"M",
		measureVariant === "guide" && drawing === "measure"
			? RulerDimensionLine
			: Ruler,
	)}
	<!-- Measure or place guides: a split button, not a row of its own (A.2). -->
	<DropdownMenu.Root bind:open={measureMenuOpen}>
		<DropdownMenu.Trigger disabled={!offered.draw.has("measure")}>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					size="icon"
					class="w-6"
					aria-label={t(msg("measure_tool_mode"))}
					data-testid="measure-mode"
				>
					<ChevronDown />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<!-- Focus stays off the trigger: keys typed next go to the tool, and Enter would open
		     the menu again. -->
		<DropdownMenu.Content
			align="start"
			onCloseAutoFocus={(event) => event.preventDefault()}
		>
			<DropdownMenu.RadioGroup
				value={drawing === "measure" ? measureVariant : ""}
				onValueChange={(value) => {
					measureMenuOpen = false;
					if (value === "guide") onplaceguides();
					else if (value === "measure") onmeasure();
				}}
			>
				<DropdownMenu.RadioItem value="measure">
					<Ruler />
					{t(msg("measure_mode_measure"))}
				</DropdownMenu.RadioItem>
				<DropdownMenu.RadioItem value="guide">
					<RulerDimensionLine />
					{t(msg("measure_mode_guide"))}
				</DropdownMenu.RadioItem>
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</ButtonGroup.Root>
