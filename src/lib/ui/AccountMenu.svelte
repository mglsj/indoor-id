<script lang="ts">
	/**
	 * The OSM login at the header's right end: "Sign in" when logged out; once logged in, the
	 * user's OSM picture opening a menu with their account page on OSM and "Sign out" (asked
	 * first). Nothing when the instance has no OAuth application (`oauth_client_id`).
	 */
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import LogIn from "@lucide/svelte/icons/log-in";
	import LogOut from "@lucide/svelte/icons/log-out";
	import UserRound from "@lucide/svelte/icons/user-round";
	import * as AlertDialog from "#lib/components/shadcn/alert-dialog/index.ts";
	import { Button } from "#lib/components/shadcn/button/index.ts";
	import * as DropdownMenu from "#lib/components/shadcn/dropdown-menu/index.ts";
	import { Spinner } from "#lib/components/shadcn/spinner/index.ts";
	import { msg, t } from "#lib/i18n/messages.ts";
	import type { Session } from "#lib/state/session.svelte.ts";

	interface Props {
		session: Session;
	}

	let { session }: Props = $props();

	let signingIn = $state(false);
	let confirming = $state(false);
	/** The picture failed to load: the icon instead. */
	let brokenAvatar = $state<string | null>(null);

	const menuLabel = $derived(
		session.userName
			? t(msg("account_menu", { name: session.userName }))
			: t(msg("account_menu_unnamed")),
	);
	const avatar = $derived(
		session.avatarUrl && session.avatarUrl !== brokenAvatar
			? session.avatarUrl
			: null,
	);

	async function signIn() {
		signingIn = true;
		try {
			await session.login();
		} catch {
			// Closed, cancelled or timed out: the button is back; uploading says why it failed.
		} finally {
			signingIn = false;
		}
	}

	function openAccount() {
		if (session.profileUrl)
			window.open(session.profileUrl, "_blank", "noopener");
	}
</script>

{#if session.configured}
	{#if !session.loggedIn}
		<Button
			variant="outline"
			size="sm"
			disabled={signingIn}
			title={t(msg("account_sign_in_title"))}
			onclick={signIn}
			data-testid="sign-in"
		>
			{#if signingIn}
				<Spinner data-icon="inline-start" />
				<span class="max-sm:sr-only">{t(msg("account_signing_in"))}</span>
			{:else}
				<LogIn data-icon="inline-start" />
				<span class="max-sm:sr-only">{t(msg("account_sign_in"))}</span>
			{/if}
		</Button>
	{:else}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon-sm"
						class="rounded-full"
						aria-label={menuLabel}
						title={menuLabel}
						data-testid="account-menu"
					>
						{#if avatar}
							<img
								src={avatar}
								alt=""
								class="size-7 rounded-full object-cover ring-1 ring-border"
								referrerpolicy="no-referrer"
								onerror={() => (brokenAvatar = avatar)}
							>
						{:else}
							<span
								class="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"
							>
								<UserRound class="size-4" />
							</span>
						{/if}
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				align="end"
				class="w-auto min-w-56 whitespace-nowrap"
			>
				{#if session.userName}
					<DropdownMenu.Label class="font-normal">
						<span class="block text-xs text-muted-foreground"
							>{t(msg("account_signed_in_as"))}</span
						>
						<span class="block truncate font-medium">{session.userName}</span>
					</DropdownMenu.Label>
					<DropdownMenu.Separator />
				{/if}
				<DropdownMenu.Item
					disabled={!session.profileUrl}
					onSelect={openAccount}
				>
					<ExternalLink />
					{t(msg("account_on_osm"))}
				</DropdownMenu.Item>
				<DropdownMenu.Item
					variant="destructive"
					onSelect={() => (confirming = true)}
				>
					<LogOut />
					{t(msg("account_sign_out"))}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/if}
{/if}

<AlertDialog.Root bind:open={confirming}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{t(msg("account_sign_out_title"))}</AlertDialog.Title>
			<AlertDialog.Description>
				{t(msg("account_sign_out_description"))}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel
				>{t(msg("account_sign_out_cancel"))}</AlertDialog.Cancel
			>
			<AlertDialog.Action
				variant="destructive"
				onclick={() => {
					confirming = false;
					session.logout();
				}}
			>
				{t(msg("account_sign_out"))}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
