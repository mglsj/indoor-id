<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Download from "@lucide/svelte/icons/download";
	import Upload from "@lucide/svelte/icons/upload";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import type {
		PlanContent,
		PlanMode,
		PlanOrigin,
	} from "#lib/floorplans/content.ts";
	import { ACCEPTED_FILES, type PlanDecoders } from "#lib/floorplans/import.ts";
	import {
		type OpenedPdf,
		openPlanFile,
		pdfPage,
		writePlanFile,
	} from "#lib/floorplans/plan-io.ts";
	import { MessageError, msg } from "#lib/i18n/messages.ts";
	import type { FloorPlans, View } from "#lib/state/floorplans.svelte.ts";
	import PdfPageDialog from "#lib/ui/PdfPageDialog.svelte";

	interface Props {
		floorplans: FloorPlans;
		/** Read the files picked for import. */
		decoders: PlanDecoders;
		/** The visible map, where new plans are placed. */
		getView: () => View | undefined;
		/** The level shown, which new plans are assigned to. */
		level: number;
	}

	let { floorplans, decoders, getView, level }: Props = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);
	let pdf = $state.raw<OpenedPdf | null>(null);
	let input = $state<HTMLInputElement>();

	async function onFileChange(
		event: Event & { currentTarget: HTMLInputElement },
	) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = "";
		if (!file) return;
		error = null;
		busy = true;
		try {
			const opened = await openPlanFile(file, decoders);
			switch (opened.kind) {
				case "plan":
					add(opened);
					break;
				case "pdf":
					pdf = opened;
					break;
				case "plans":
					floorplans.insertPlans(opened.plans);
			}
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	/** Adds a plan in the middle of the view, on the level shown. */
	function add({
		content,
		name,
		origin,
	}: {
		content: PlanContent;
		name: string;
		origin: PlanOrigin;
	}) {
		const view = getView();
		if (!view) throw new MessageError(msg("plan_import_map_not_ready"));
		floorplans.add(content, name, view, String(level), origin);
	}

	/** Each page becomes a plan, all in the same spot on the level shown. */
	async function importPdfPages(
		pages: number[],
		dpi: number,
		mode: PlanMode | "auto",
	) {
		if (!pdf) return;
		const opened = pdf;
		try {
			for (const page of pages) add(await pdfPage(opened, page, dpi, mode));
		} catch (e) {
			error = (e as Error).message;
		}
	}

	/** Downloads every plan, with the files they come from, as an IndoorID plan file. */
	async function exportFile() {
		// Plans off the shown level have no content loaded: their file comes from storage.
		const archive = await writePlanFile(
			floorplans.plans,
			floorplans.buildings,
			(plan) => floorplans.fileOf(plan),
		);
		const url = URL.createObjectURL(archive);
		const link = document.createElement("a");
		link.href = url;
		link.download = "indoorid-floorplans.zip";
		link.click();
		URL.revokeObjectURL(url);
	}

	function closePdf() {
		pdf?.document.close();
		pdf = null;
	}
</script>

<div class="flex gap-2">
	<Button
		size="sm"
		disabled={busy}
		onclick={() => floorplans.whenSaved(() => input?.click())}
	>
		{#if busy}
			<Spinner data-icon="inline-start" />
		{:else}
			<Upload data-icon="inline-start" />
		{/if}
		Import
	</Button>
	{#if floorplans.plans.length > 0}
		<Button
			size="icon-sm"
			variant="outline"
			aria-label="Export floor plans"
			onclick={exportFile}
		>
			<Download />
		</Button>
	{/if}
	<input
		bind:this={input}
		type="file"
		accept={ACCEPTED_FILES}
		aria-label="Import a floor plan"
		class="sr-only"
		tabindex="-1"
		onchange={onFileChange}
	>
</div>
{#if error}
	<Alert.Root variant="destructive">
		<CircleAlert />
		<Alert.Description>{error}</Alert.Description>
	</Alert.Root>
{/if}

{#if pdf}
	<PdfPageDialog
		pdf={pdf.document}
		onimport={importPdfPages}
		onclose={closePdf}
	/>
{/if}
