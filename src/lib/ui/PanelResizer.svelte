<script lang="ts">
	import GripVertical from "@lucide/svelte/icons/grip-vertical";
	import {
		clampWidth,
		DEFAULT_WIDTH,
		type WidthBounds,
		widthForKey,
	} from "#lib/ui/panel-width.ts";

	interface Props {
		/** The panel's width, in pixels. */
		width: number;
		bounds: WidthBounds;
		/** What is resized, for screen readers. */
		label: string;
		/** Called while the edge moves. */
		onresize: (width: number) => void;
		/** Called once the user lets go, with the width to keep. */
		oncommit: (width: number) => void;
	}

	let { width, bounds, label, onresize, oncommit }: Props = $props();

	/** Where the drag started: the pointer's x and the panel's width then. */
	let drag = $state<{ x: number; width: number } | null>(null);

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		// No text selection while dragging; the handle still takes focus, as a splitter.
		event.preventDefault();
		const handle = event.currentTarget as HTMLElement;
		handle.focus();
		handle.setPointerCapture(event.pointerId);
		drag = { x: event.clientX, width };
	}

	function onpointermove(event: PointerEvent) {
		if (!drag) return;
		onresize(clampWidth(drag.width + event.clientX - drag.x, bounds));
	}

	function onpointerup() {
		if (!drag) return;
		drag = null;
		oncommit(width);
	}

	function onkeydown(event: KeyboardEvent) {
		const next = widthForKey(event.key, width, bounds);
		if (next === undefined) return;
		event.preventDefault();
		onresize(next);
		oncommit(next);
	}

	function ondblclick() {
		const next = clampWidth(DEFAULT_WIDTH, bounds);
		onresize(next);
		oncommit(next);
	}
</script>

<!-- A window splitter (WAI-ARIA): drag, arrows, Home and End; a double click resets it.
	A focusable separator is a widget there, which the linters don't know: <hr> can't hold the grip. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<!-- biome-ignore lint/a11y/useSemanticElements: a focusable window splitter -->
<div
	role="separator"
	aria-orientation="vertical"
	aria-label={label}
	aria-valuenow={width}
	aria-valuemin={bounds.min}
	aria-valuemax={bounds.max}
	tabindex="0"
	title="Drag to resize, double-click to reset"
	data-dragging={drag ? "" : undefined}
	class="group absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none items-center justify-center outline-none select-none"
	{onpointerdown}
	{onpointermove}
	{onpointerup}
	onpointercancel={onpointerup}
	{onkeydown}
	{ondblclick}
>
	<span
		class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring group-data-dragging:bg-ring"
	></span>
	<span
		class="relative flex h-6 w-3 items-center justify-center rounded-sm border bg-background text-muted-foreground shadow-xs group-focus-visible:ring-2 group-focus-visible:ring-ring/50"
	>
		<GripVertical class="size-2.5" />
	</span>
</div>
