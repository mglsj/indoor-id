<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import { loadConfig } from "#lib/config.ts";
	import EditorView from "#lib/ui/EditorView.svelte";

	const configPromise = loadConfig();
</script>

<div class="flex h-full flex-col">
	<header class="flex h-12 shrink-0 items-center gap-3 border-b px-4">
		<h1 class="text-base font-semibold">IndoorID</h1>
		<span class="text-xs text-muted-foreground"
			>{__APP_VERSION__}
			· {__GIT_HASH__}</span
		>
	</header>

	<main class="relative min-h-0 flex-1">
		{#await configPromise}
			<div class="flex items-center gap-2 p-4 text-sm text-muted-foreground">
				<Spinner />
				Loading…
			</div>
		{:then config}
			<EditorView {config} />
		{:catch error}
			<div class="p-4">
				<Alert.Root variant="destructive" class="max-w-lg">
					<CircleAlert />
					<Alert.Title>IndoorID could not start</Alert.Title>
					<Alert.Description>{error.message}</Alert.Description>
				</Alert.Root>
			</div>
		{/await}
	</main>
</div>
