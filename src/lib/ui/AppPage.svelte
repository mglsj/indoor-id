<script lang="ts">
	/**
	 * A page of the app: the header (name, version, the editor and viewer, licenses, the light or
	 * dark theme: the system's until toggled, then remembered by mode-watcher, the language) and
	 * the instance's `config.json` loaded before `children` render with it.
	 */
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import Languages from "@lucide/svelte/icons/languages";
	import Moon from "@lucide/svelte/icons/moon";
	import Search from "@lucide/svelte/icons/search";
	import Sun from "@lucide/svelte/icons/sun";
	import X from "@lucide/svelte/icons/x";
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

	const PAGE_NAMES = {
		edit: msg("nav_edit"),
		view: msg("nav_view"),
		help: msg("nav_help"),
	} as const;
	/** The page's title (A.6, WCAG 2.4.2): "Edit · Grand Quartier · IndoorID". */
	const title = $derived(
		[t(PAGE_NAMES[page]), header.place, "IndoorID"].filter(Boolean).join(" · "),
	);

	/** On a phone (A.7), the search opens over the header from its icon. */
	let searchOpen = $state(false);

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

<!-- Escape closes the phone's search (A.7). -->
<svelte:window
	onkeydown={(event) => {
		if (searchOpen && event.key === "Escape") searchOpen = false;
	}}
/>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<div class="flex h-full flex-col">
	{@render header.skips?.()}
	<!-- Fits a phone (A.7): below `sm` no version, the pages and Licenses in a menu, the search
	     behind an icon. -->
	<header
		class="relative flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:gap-3 sm:px-4"
	>
		<!-- The app's name; the help page's own heading is its h1 (A.6). -->
		<svelte:element
			this={page === "help" ? "p" : "h1"}
			class="text-base font-semibold"
			>IndoorID</svelte:element
		>
		<span class="hidden text-xs text-muted-foreground sm:inline"
			>{__APP_VERSION__}
			· {__GIT_HASH__}</span
		>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="sm"
						class="sm:hidden"
						aria-label={t(msg("nav_pages"))}
					>
						{t(PAGE_NAMES[page])}
						<ChevronDown data-icon="inline-end" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start">
				{#each [
					["/", "edit"],
					["/view", "view"],
					["/help", "help"],
				] as const as [target, name] (name)}
					<DropdownMenu.Item
						onSelect={() => void goto(`${resolve(target)}${location.hash}`)}
						aria-current={page === name ? "page" : undefined}
						>{t(PAGE_NAMES[name])}</DropdownMenu.Item
					>
				{/each}
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					onSelect={() => window.open("./licenses.md", "_blank", "noopener")}
					>{t(msg("nav_licenses"))}</DropdownMenu.Item
				>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<nav
			class="hidden items-center gap-1 sm:flex"
			aria-label={t(msg("nav_pages"))}
		>
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
			<Button
				variant="ghost"
				size="icon-sm"
				class="sm:hidden"
				aria-label={t(msg("search_open"))}
				aria-expanded={searchOpen}
				onclick={() => (searchOpen = true)}
			>
				<Search />
			</Button>
			<!-- One search box: over the whole header on a phone once opened. -->
			<div
				class={[
					"min-w-0 shrink sm:block sm:w-72",
					searchOpen
						? "max-sm:absolute max-sm:inset-0 max-sm:z-50 max-sm:flex max-sm:items-center max-sm:gap-2 max-sm:bg-background max-sm:px-2"
						: "max-sm:hidden",
				]}
			>
				{@render header.search()}
				<Button
					variant="ghost"
					size="icon-sm"
					class="sm:hidden"
					aria-label={t(msg("search_close"))}
					onclick={() => (searchOpen = false)}
				>
					<X />
				</Button>
			</div>
		{/if}
		<div class="ml-auto flex items-center gap-2">
			{@render header.actions?.()}
		</div>
		<!-- The licenses of IndoorID and of what it ships, written by the build (vite.config.ts);
		     relative, as the app may be served from a subfolder (pages have no trailing slash, so
		     it is the same file from `/view`). -->
		<a
			class="hidden text-xs text-muted-foreground underline-offset-2 hover:underline sm:inline"
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
