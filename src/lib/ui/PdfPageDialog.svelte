<script lang="ts">
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Checkbox } from "#lib/components/shadcn/checkbox/index.ts";
	import * as Dialog from "#lib/components/shadcn/dialog/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import { Input } from "#lib/components/shadcn/input/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import * as ToggleGroup from "#lib/components/shadcn/toggle-group/index.ts";
	import type { PlanMode } from "#lib/floorplans/content.ts";
	import type { PdfDocument } from "#lib/floorplans/import.ts";

	interface Props {
		pdf: PdfDocument;
		/**
		 * Called with the chosen pages (from 1, in order), the resolution and how to draw them;
		 * resolves once imported.
		 */
		onimport: (
			pages: number[],
			dpi: number,
			mode: PlanMode | "auto",
		) => Promise<void>;
		onclose: () => void;
	}

	let { pdf, onimport, onclose }: Props = $props();

	const pages = $derived(
		Array.from({ length: pdf.pageCount }, (_, i) => i + 1),
	);
	let open = $state(true);
	/** The chosen pages, in page order. */
	let chosen = $state<number[]>([1]);
	let dpi = $state(150);
	let mode = $state<PlanMode | "auto">("auto");
	let busy = $state(false);
	let thumbnails = $state<Record<number, string>>({});
	let size = $state<{ width: number; height: number } | null>(null);

	// Thumbnails render one after the other, in the background, and stop once a page is being
	// imported (which waits for pdf.js) or the dialog closes (which ends the document).
	$effect(() => {
		let cancelled = false;
		void (async () => {
			for (const n of pages) {
				if (cancelled || busy) return;
				const url = await pdf.thumbnail(n).catch(() => null);
				if (cancelled || url === null) return;
				thumbnails = { ...thumbnails, [n]: url };
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	// The size in pixels shown is the first chosen page's.
	$effect(() => {
		const n = chosen[0];
		if (n === undefined) return;
		void pdf.pageSize(n).then((inches) => {
			if (chosen[0] === n) size = inches;
		});
	});

	function choose(n: number, on: boolean) {
		chosen = on
			? [...new Set([...chosen, n])].sort((a, b) => a - b)
			: chosen.filter((p) => p !== n);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (chosen.length === 0) return;
		busy = true;
		try {
			await onimport(chosen, dpi, mode);
			open = false;
		} finally {
			busy = false;
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
		escapeKeydownBehavior={busy ? "ignore" : "close"}
		interactOutsideBehavior={busy ? "ignore" : "close"}
	>
		<Dialog.Header>
			<Dialog.Title>Import PDF pages</Dialog.Title>
			<Dialog.Description>
				Choose the pages with floor plans, and how finely to render them. Each
				page becomes a plan on the level shown.
			</Dialog.Description>
		</Dialog.Header>
		<form class="flex flex-col gap-6" onsubmit={submit}>
			<Field.Set>
				<Field.Legend class="sr-only">Pages</Field.Legend>
				<ScrollArea class="*:data-[slot=scroll-area-viewport]:max-h-72">
					<div class="grid grid-cols-3 gap-3">
						{#each pages as n (n)}
							{@const id = `pdf-page-${n}`}
							<Field.Label
								for={id}
								class="flex-col items-center gap-2 rounded-md border p-2 has-data-checked:border-primary"
							>
								{#if thumbnails[n]}
									<img
										src={thumbnails[n]}
										alt=""
										class="h-24 w-full object-contain"
									>
								{:else}
									<span class="flex h-24 items-center"><Spinner /></span>
								{/if}
								<span class="flex items-center gap-2">
									<Checkbox
										{id}
										checked={chosen.includes(n)}
										onCheckedChange={(on) => choose(n, on)}
									/>
									Page {n}
								</span>
							</Field.Label>
						{/each}
					</div>
				</ScrollArea>
			</Field.Set>
			<Field.Field>
				<Field.Label id="pdf-mode-label">Draw as</Field.Label>
				<ToggleGroup.Root
					type="single"
					variant="outline"
					size="sm"
					aria-labelledby="pdf-mode-label"
					class="w-full"
					value={mode}
					onValueChange={(value) => {
						if (value) mode = value as PlanMode | "auto";
					}}
				>
					<ToggleGroup.Item value="auto" class="flex-1">Auto</ToggleGroup.Item>
					<ToggleGroup.Item value="vector" class="flex-1"
						>Vector</ToggleGroup.Item
					>
					<ToggleGroup.Item value="image" class="flex-1"
						>Image</ToggleGroup.Item
					>
				</ToggleGroup.Root>
				<Field.Description>
					Vector draws the page's lines sharp at any zoom, best for plans from
					CAD; Image renders it, best for scans. Auto picks for each page.
				</Field.Description>
			</Field.Field>
			<Field.Field data-disabled={mode === "vector" || undefined}>
				<Field.Label for="pdf-dpi">Resolution (DPI)</Field.Label>
				<Input
					id="pdf-dpi"
					type="number"
					min={36}
					max={600}
					step={1}
					required
					disabled={mode === "vector"}
					bind:value={dpi}
				/>
				{#if size && dpi > 0}
					<Field.Description>
						{Math.round(size.width * dpi)}
						×
						{Math.round(size.height * dpi)}
						px. Higher shows more detail but takes more memory.
					</Field.Description>
				{/if}
			</Field.Field>
			<Dialog.Footer>
				<Button
					variant="outline"
					disabled={busy}
					onclick={() => (open = false)}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={busy || chosen.length === 0}>
					{#if busy}
						<Spinner data-icon="inline-start" />
					{/if}
					{chosen.length > 1 ? `Import ${chosen.length} pages` : "Import"}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
