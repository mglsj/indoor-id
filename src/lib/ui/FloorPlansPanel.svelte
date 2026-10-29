<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import X from "@lucide/svelte/icons/x";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Separator } from "#lib/components/shadcn/separator/index.ts";
	import type { PlanDecoders } from "#lib/floorplans/import.ts";
	import { type Message, t } from "#lib/i18n/messages.ts";
	import type {
		FloorPlans,
		PlanBuilding,
		View,
	} from "#lib/state/floorplans.svelte.ts";
	import PlanFiles from "#lib/ui/PlanFiles.svelte";
	import PlanList from "#lib/ui/PlanList.svelte";
	import PlanTools from "#lib/ui/PlanTools.svelte";

	interface Props {
		floorplans: FloorPlans;
		/** Read the files picked for import. */
		decoders: PlanDecoders;
		/** The visible map, where new plans are placed. */
		getView: () => View | undefined;
		/** The level shown, which new plans are assigned to. */
		level: number;
		/** Why the alignment tool ignored the last map click, if it did. */
		toolMessage?: Message | null;
		/** Leaves floor plan mode. */
		onclose: () => void;
		/** Switches the map to a level, to show a plan on it. */
		onshowlevel: (level: number) => void;
		/** The buildings under the plan in Edit, the one around its centre first. */
		buildings?: readonly PlanBuilding[];
		/** The name of a plan's building, by its OSM id, when it is known. */
		buildingName?: (id: string) => string | undefined;
	}

	let {
		floorplans,
		decoders,
		getView,
		level,
		toolMessage = null,
		onclose,
		onshowlevel,
		buildings = [],
		buildingName,
	}: Props = $props();
</script>

<aside
	aria-label="Floor plan editor"
	class="flex h-full w-full flex-col border-r bg-background shadow-lg"
>
	<header class="flex items-start gap-2 px-4 py-3">
		<div class="min-w-0 flex-1">
			<h2 class="text-base font-semibold">Floor plans</h2>
			<p class="text-sm text-muted-foreground">
				Place plans against the building outlines. Import PNG, JPEG, WebP, SVG
				or PDF.
			</p>
		</div>
		<Button size="sm" variant="outline" onclick={onclose}>
			<X data-icon="inline-start" />
			Close
		</Button>
	</header>
	<Separator />
	<ScrollArea class="min-h-0 flex-1">
		<div class="flex flex-col gap-4 p-4">
			<PlanFiles {floorplans} {decoders} {getView} {level} />
			{#if floorplans.storageError}
				<Alert.Root variant="destructive">
					<CircleAlert />
					<Alert.Description>{t(floorplans.storageError)}</Alert.Description>
				</Alert.Root>
			{/if}
			<PlanList {floorplans} {level} {onshowlevel} {buildingName} />
			<PlanTools {floorplans} {toolMessage} {buildings} />
		</div>
	</ScrollArea>
</aside>
