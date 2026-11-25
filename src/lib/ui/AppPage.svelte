<script lang="ts">
	/**
	 * A page of the app: the header (name, version, the editor and viewer, licenses, the light or
	 * dark theme: the system's until toggled, then remembered by mode-watcher, the language) and
	 * the instance's `config.json` loaded before `children` render with it.
	 */
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Languages from "@lucide/svelte/icons/languages";
	import Moon from "@lucide/svelte/icons/moon";
	import Sun from "@lucide/svelte/icons/sun";
	import { mode, toggleMode } from "mode-watcher";
	import type { Snippet } from "svelte";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as DropdownMenu from "#lib/components/shadcn/dropdown-menu/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import { type EditorConfig, loadConfig } from "#lib/config.ts";
	import {
		chooseLocale,
		currentLocale,
		type Locale,
		localeNames,
	} from "#lib/i18n/locale.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import { HeaderSlots, setHeader } from "#lib/ui/header.svelte.ts";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	interface Props {
		/** Which page this is: its link in the header is shown as current. */
		page: "edit" | "view" | "help";
		children: Snippet<[EditorConfig]>;
	}

	let { page, children }: Props = $props();

	// The language is loaded before any page renders (`+layout.ts`).
	const configPromise = loadConfig();
	/** What the page shows in the header: the breadcrumb, place search, its actions (A.2). */
	const header = setHeader(new HeaderSlots());
	const languages = localeNames();

	const dark = $derived(mode.current === "dark");
	const label = $derived(t(msg(dark ? "theme_to_light" : "theme_to_dark")));

	/** The other page, at the same place and level (the URL hash). */
	function open(event: MouseEvent, target: "/" | "/view" | "/help") {
		event.preventDefault();
		void goto(`${resolve(target)}${location.hash}`);
	}
</script>

{#snippet link(
	target: "/" | "/view" | "/help",
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
		<nav class="flex items-center gap-1" aria-label={t(msg("nav_pages"))}>
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
			{@render link(
				"/help",
				page === "help",
				t(msg("nav_help")),
				t(msg("nav_help_title")),
			)}
		</nav>
		{@render header.crumb?.()}
		{#if header.search}
			<div class="w-72 min-w-0 shrink">
				{@render header.search()}
			</div>
		{/if}
		<div class="ml-auto flex items-center gap-2">
			{@render header.actions?.()}
		</div>
		<!-- The licenses of IndoorID and of what it ships, written by the build (vite.config.ts);
		     relative, as the app may be served from a subfolder (pages have no trailing slash, so
		     it is the same file from `/view`). -->
		<a
			class="text-xs text-muted-foreground underline-offset-2 hover:underline"
			href="./licenses.md"
			target="_blank"
			rel="noopener"
			>{t(msg("nav_licenses"))}</a
		>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						aria-label={t(msg("language_choose"))}
						title={t(msg("language_choose"))}
					>
						<Languages />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.RadioGroup
					value={currentLocale()}
					onValueChange={(value) => chooseLocale(value as Locale)}
				>
					{#each languages as { locale, name } (locale)}
						<DropdownMenu.RadioItem value={locale} lang={locale}
							>{name}</DropdownMenu.RadioItem
						>
					{/each}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={label}
			title={label}
			onclick={toggleMode}
		>
			{#if dark}
				<Sun />
			{:else}
				<Moon />
			{/if}
		</Button>
	</header>

	<main class="relative min-h-0 flex-1">
		{#await configPromise}
			<div class="flex items-center gap-2 p-4 text-sm text-muted-foreground">
				<Spinner />
				{t(msg("app_loading"))}
			</div>
		{:then config}
			{@render children(config)}
		{:catch error}
			<div class="p-4">
				<Alert.Root variant="destructive" class="max-w-lg">
					<CircleAlert />
					<Alert.Title>{t(msg("app_start_failed"))}</Alert.Title>
					<Alert.Description>{error.message}</Alert.Description>
				</Alert.Root>
			</div>
		{/await}
	</main>
</div>
