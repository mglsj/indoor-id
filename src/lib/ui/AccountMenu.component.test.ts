import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { type AuthClient, Session } from "#lib/state/session.svelte.ts";
import AccountMenu from "./AccountMenu.svelte";

/** A real session on a fake osm-auth: logged in when `token` is set, as Jane Mapper. */
function session({ token = "secret", clientId = "client" } = {}) {
	const auth: AuthClient & { token: string } = {
		token,
		authenticated: () => auth.token !== "",
		authenticate: vi.fn(),
		logout: vi.fn(() => (auth.token = "")),
		getAccessToken: () => auth.token,
	};
	const fetch = vi.fn(async () =>
		Response.json({ user: { display_name: "Jane Mapper" } }),
	);
	const s = new Session({
		oauthUrl: "https://osm.example",
		apiUrl: "https://api.example",
		clientId,
		redirectUri: "https://indoor.example/auth/callback",
		auth,
		fetch: fetch as unknown as typeof globalThis.fetch,
	});
	return { s, auth };
}

describe("AccountMenu", () => {
	it("offers to sign in when logged out", async () => {
		const { s, auth } = session({ token: "" });
		render(AccountMenu, { session: s });
		await page.getByRole("button", { name: "Sign in" }).click();
		expect(auth.authenticate).toHaveBeenCalledOnce();
	});

	it("shows nothing when login isn't set up", async () => {
		render(AccountMenu, { session: session({ clientId: "" }).s });
		await expect
			.element(page.getByRole("button", { name: "Sign in" }))
			.not.toBeInTheDocument();
	});

	it("opens the user's OSM page from the menu", async () => {
		const open = vi.spyOn(window, "open").mockReturnValue(null);
		render(AccountMenu, { session: session().s });
		await page.getByRole("button", { name: "Account: Jane Mapper" }).click();
		await page
			.getByRole("menuitem", { name: "Account on OpenStreetMap" })
			.click();
		expect(open).toHaveBeenCalledWith(
			"https://osm.example/user/Jane%20Mapper",
			"_blank",
			"noopener",
		);
		open.mockRestore();
	});

	it("signs out only once confirmed", async () => {
		const { s, auth } = session();
		render(AccountMenu, { session: s });
		const menu = page.getByRole("button", { name: "Account: Jane Mapper" });

		await menu.click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();
		await page.getByRole("button", { name: "Stay signed in" }).click();
		expect(auth.logout).not.toHaveBeenCalled();

		await menu.click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Sign out" })
			.click();
		expect(auth.logout).toHaveBeenCalledOnce();
		await expect
			.element(page.getByRole("button", { name: "Sign in" }))
			.toBeInTheDocument();
	});
});
