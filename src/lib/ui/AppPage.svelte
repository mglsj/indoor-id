<script lang="ts">
	/**
	 * A page of the app: the header (name, version, the editor and viewer, licenses) and the
	 * instance's `config.json` loaded before `children` render with it.
	 */
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import type { Snippet } from "svelte";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import { type EditorConfig, loadConfig } from "#lib/config.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	interface Props {
		/** Which page this is: its link in the header is shown as current. */
		page: "edit" | "view";
		children: Snippet<[EditorConfig]>;
	}

	let { page, children }: Props = $props();

	const configPromise = loadConfig();

	/** The other page, at the same place and level (the URL hash). */
	function open(event: MouseEvent, target: "/" | "/view") {
		event.preventDefault();
		void goto(`${resolve(target)}${location.hash}`);
	}
</script>

{#snippet link(
	target: "/" | "/view",
	current: boolean,
	label: string,
	title: string,
)}
	<a
		class={[
			"rounded-md px-2 py-1 text-sm underline-offset-2 hover:underline",
			current ? "bg-muted font-medium" : "text-muted-foreground",
		]}
		href={resolve(target)}
		aria-current={current ? "page" : undefined}
		{title}
		onclick={(event) => open(event, target)}
		>{label}</a
	>
{/snippet}

<div class="flex h-full flex-col">
	<header class="flex h-12 shrink-0 items-center gap-3 border-b px-4">
		<h1 class="text-base font-semibold">IndoorID</h1>
		<span class="text-xs text-muted-foreground"
			>{__APP_VERSION__}
			· {__GIT_HASH__}</span
		>
		<nav class="flex items-center gap-1" aria-label="Pages">
			{@render link(
				"/",
				page === "edit",
				t(msg("nav_edit")),
				t(msg("nav_edit_title")),
			)}
			{@render link(
				"/view",
				page === "view",
				t(msg("nav_view")),
				t(msg("nav_view_title")),
			)}
		</nav>
		<!-- The licenses of IndoorID and of what it ships, written by the build (vite.config.ts);
		     relative, as the app may be served from a subfolder (pages have no trailing slash, so
		     it is the same file from `/view`). -->
		<a
			class="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
			href="./licenses.md"
			target="_blank"
			rel="noopener"
			>Licenses</a
		>
	</header>

	<main class="relative min-h-0 flex-1">
		{#await configPromise}
			<div class="flex items-center gap-2 p-4 text-sm text-muted-foreground">
				<Spinner />
				Loading…
			</div>
		{:then config}
			{@render children(config)}
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
