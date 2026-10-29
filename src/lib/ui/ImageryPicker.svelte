<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Layers from "@lucide/svelte/icons/layers";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as Field from "#lib/components/shadcn/field/index.ts";
	import * as Popover from "#lib/components/shadcn/popover/index.ts";
	import * as RadioGroup from "#lib/components/shadcn/radio-group/index.ts";
	import { ScrollArea } from "#lib/components/shadcn/scroll-area/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import {
		availableImagery,
		type ImageryEntry,
		loadImageryIndex,
	} from "#lib/map/imagery.ts";

	interface Props {
		/** Map centre, [lon, lat], to list the imagery covering it. */
		center: [number, number] | undefined;
		/** Selected imagery id, or null for the basemap only. */
		selected: string | null;
		onselect: (entry: ImageryEntry | null) => void;
		indexUrl?: string;
	}

	let { center, selected, onselect, indexUrl }: Props = $props();

	/** Radio value of the basemap alone (imagery ids never start with a colon). */
	const MAP = ":map";

	let entries = $state.raw<ImageryEntry[] | null>(null);
	let error = $state<string | null>(null);

	const available = $derived(
		entries && center ? availableImagery(entries, center) : [],
	);

	/** The imagery index is large: it is only downloaded when first needed. */
	async function onOpenChange(open: boolean) {
		if (!open || entries) return;
		try {
			entries = await loadImageryIndex(indexUrl);
		} catch (e) {
			error = (e as Error).message;
		}
	}

	function choose(id: string) {
		onselect(id === MAP ? null : (available.find((e) => e.id === id) ?? null));
	}
</script>

<Popover.Root {onOpenChange}>
	<div class="rounded-md bg-background shadow-md">
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline">
					<Layers data-icon="inline-start" />
					Background
				</Button>
			{/snippet}
		</Popover.Trigger>
	</div>
	<Popover.Content align="start" class="p-0">
		<ScrollArea class="*:data-[slot=scroll-area-viewport]:max-h-72">
			<Field.Set class="p-3">
				<Field.Legend class="sr-only">Background imagery</Field.Legend>
				<RadioGroup.Root value={selected ?? MAP} onValueChange={choose}>
					{@render option(MAP, "Map")}
					{#if error}
						<Alert.Root variant="destructive">
							<CircleAlert />
							<Alert.Description>{error}</Alert.Description>
						</Alert.Root>
					{:else if !entries}
						<p class="flex items-center gap-2 text-muted-foreground">
							<Spinner />
							Loading imagery list…
						</p>
					{:else}
						{#each available as entry (entry.id)}
							{@render option(entry.id, entry.name)}
						{/each}
					{/if}
				</RadioGroup.Root>
			</Field.Set>
		</ScrollArea>
	</Popover.Content>
</Popover.Root>

{#snippet option(value: string, name: string)}
	{@const id = `imagery-${value}`}
	<Field.Field orientation="horizontal">
		<RadioGroup.Item {value} {id} />
		<Field.Label for={id} class="truncate font-normal">{name}</Field.Label>
	</Field.Field>
{/snippet}
