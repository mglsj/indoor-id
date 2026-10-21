import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AuthClient, Session } from "./session.svelte.ts";

/** An osm-auth stand-in: `answer` ends the pending login, `popup` is its window. */
function fakeAuth(token = "") {
	const popup = { closed: false, close: vi.fn(() => (popup.closed = true)) };
	const callbacks: ((error: unknown) => void)[] = [];
	const auth: AuthClient & { token: string } = {
		token,
		popupWindow: null,
		authenticated: () => auth.token !== "",
		authenticate(callback) {
			auth.popupWindow = popup;
			popup.closed = false;
			callbacks.push(callback);
		},
		logout: () => (auth.token = ""),
		getAccessToken: () => auth.token,
	};
	return { auth, popup, callbacks };
}

function session(
	auth: AuthClient,
	fetch = vi.fn(async () => new Response("{}")),
) {
	return new Session({
		oauthUrl: "https://osm.example/",
		apiUrl: "https://api.example",
		clientId: "client",
		redirectUri: "https://indoor.example/auth/callback",
		auth,
		fetch: fetch as unknown as typeof globalThis.fetch,
	});
}

describe("Session.login: a login that can't hang", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("resolves once osm-auth has the token", async () => {
		const { auth, callbacks } = fakeAuth();
		const s = session(auth);
		const login = s.login();
		auth.token = "secret";
		callbacks[0]?.(null);
		await expect(login).resolves.toBeUndefined();
		expect(s.loggedIn).toBe(true);
	});

	it("rejects when the popup is closed before logging in", async () => {
		const { auth, popup } = fakeAuth();
		const s = session(auth);
		const login = s.login();
		popup.closed = true;
		vi.advanceTimersByTime(1000);
		await expect(login).rejects.toThrow("closed");
		expect(s.loggedIn).toBe(false);
	});

	it("rejects when cancelled, closing the popup", async () => {
		const { auth, popup } = fakeAuth();
		const controller = new AbortController();
		const login = session(auth).login({ signal: controller.signal });
		controller.abort();
		await expect(login).rejects.toThrow("cancelled");
		expect(popup.close).toHaveBeenCalled();
	});

	it("rejects after the timeout", async () => {
		const { auth } = fakeAuth();
		const login = session(auth).login({ timeout: 60_000 });
		vi.advanceTimersByTime(60_000);
		await expect(login).rejects.toThrow("too long");
	});

	it("ignores the answer of a login given up for a new one", async () => {
		const { auth, popup, callbacks } = fakeAuth();
		const s = session(auth);
		const first = s.login();
		popup.closed = true;
		vi.advanceTimersByTime(1000);
		await expect(first).rejects.toThrow();

		const second = s.login();
		// The first login's listener hears the second popup's answer: osm-auth says "Invalid state".
		callbacks[0]?.(new Error("Invalid state"));
		auth.token = "secret";
		callbacks[1]?.(null);
		await expect(second).resolves.toBeUndefined();
	});
});

describe("Session.logout", () => {
	it("revokes the token at OSM", async () => {
		const { auth } = fakeAuth("secret");
		const fetch = vi.fn(async () => new Response("{}"));
		const s = session(auth, fetch);
		s.logout();
		expect(s.loggedIn).toBe(false);
		const calls = fetch.mock.calls as unknown as [string, RequestInit][];
		const revoke = calls.find(([url]) => url.endsWith("/oauth2/revoke"));
		expect(revoke?.[0]).toBe("https://osm.example/oauth2/revoke");
		expect(String(revoke?.[1].body)).toBe("token=secret&client_id=client");
	});
});
