/**
 * OpenStreetMap login with OAuth 2 (PKCE, no client secret) through osm-auth. The login opens
 * a popup that lands on /auth/callback; the token stays in this browser's localStorage.
 */
import { osmAuth } from "osm-auth";
import { MessageError, msg } from "#lib/i18n/messages.ts";

export interface SessionOptions {
	/** OSM website handling OAuth (e.g. https://www.openstreetmap.org). */
	readonly oauthUrl: string;
	/** OSM API (e.g. https://api.openstreetmap.org). */
	readonly apiUrl: string;
	/** Public client id of the OAuth 2 application; empty when not configured. */
	readonly clientId: string;
	/** Absolute URL of the /auth/callback page, as registered for the application. */
	readonly redirectUri: string;
	readonly fetch?: typeof fetch;
	/** The OAuth client (osm-auth's by default; tests give a fake). */
	readonly auth?: AuthClient;
}

/** What the session uses of osm-auth (some of it missing from its type definitions). */
export interface AuthClient {
	authenticated(): boolean;
	authenticate(callback: (error: unknown) => void): unknown;
	logout(): unknown;
	getAccessToken(): string;
	/** The login popup, once opened. */
	popupWindow?: { readonly closed: boolean; close(): void } | null;
}

export interface LoginOptions {
	/** Cancels the login (the dialog's Cancel button). */
	readonly signal?: AbortSignal;
	/** Gives up after this many milliseconds (5 minutes by default). */
	readonly timeout?: number;
}

/** The channel the /auth/callback page answers on (osm-auth's). */
const AUTH_CHANNEL = "osm-api-auth-complete";
/** How often the popup is checked; it counts as closed after two checks in a row. */
const POPUP_POLL_MS = 500;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export class Session {
	/** Display name of the logged-in user, once known. */
	userName = $state<string | null>(null);
	loggedIn = $state(false);
	readonly configured: boolean;

	readonly #auth: AuthClient | null;
	readonly #apiUrl: string;
	readonly #oauthUrl: string;
	readonly #clientId: string;
	readonly #fetch: typeof fetch;
	/** Bumped by each login: only the latest one's answer counts. */
	#attempt = 0;

	constructor(options: SessionOptions) {
		this.configured = options.clientId !== "";
		this.#apiUrl = options.apiUrl.replace(/\/+$/, "");
		this.#oauthUrl = options.oauthUrl.replace(/\/+$/, "");
		this.#clientId = options.clientId;
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.#auth = !this.configured
			? null
			: (options.auth ??
				(new osmAuth({
					url: this.#oauthUrl,
					apiUrl: this.#apiUrl,
					client_id: options.clientId,
					redirect_uri: options.redirectUri,
					scope: "read_prefs write_api",
				}) as unknown as AuthClient));
		this.loggedIn = this.#auth?.authenticated() ?? false;
		if (this.loggedIn) void this.#loadUser();
	}

	/** The access token for API calls, or null when logged out. */
	token(): string | null {
		return this.#auth?.getAccessToken() || null;
	}

	/**
	 * Opens the OSM login popup; resolves once logged in. Rejects when the popup is closed
	 * before the login is done, on `signal`, or after `timeout`; a new login makes the
	 * previous one's answer count for nothing.
	 */
	login({
		signal,
		timeout = LOGIN_TIMEOUT_MS,
	}: LoginOptions = {}): Promise<void> {
		const auth = this.#auth;
		if (!auth) return Promise.reject(new Error("Login is not configured"));
		const attempt = ++this.#attempt;
		return new Promise((resolve, reject) => {
			let settled = false;
			/** The callback page answered: the token is being asked for, the popup is gone. */
			let answered = false;
			let closedChecks = 0;
			const channel =
				typeof BroadcastChannel === "function"
					? new BroadcastChannel(AUTH_CHANNEL)
					: null;
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearInterval(poll);
				clearTimeout(timer);
				channel?.close();
				signal?.removeEventListener("abort", onAbort);
				if (attempt !== this.#attempt) {
					reject(new MessageError(msg("login_cancelled")));
				} else if (error) {
					if (!auth.popupWindow?.closed) auth.popupWindow?.close();
					reject(error);
				} else {
					this.loggedIn = true;
					void this.#loadUser();
					resolve();
				}
			};
			const onAbort = () => finish(new MessageError(msg("login_cancelled")));
			if (channel) channel.onmessage = () => (answered = true);
			const poll = setInterval(() => {
				if (attempt !== this.#attempt) return finish();
				closedChecks = auth.popupWindow?.closed ? closedChecks + 1 : 0;
				if (closedChecks >= 2 && !answered)
					finish(new MessageError(msg("login_popup_closed")));
			}, POPUP_POLL_MS);
			const timer = setTimeout(
				() => finish(new MessageError(msg("login_timed_out"))),
				timeout,
			);
			if (signal?.aborted) return onAbort();
			signal?.addEventListener("abort", onAbort);
			auth.authenticate((error) => {
				// An abandoned login's listener: osm-auth can't take it back.
				if (attempt !== this.#attempt) return;
				if (error) {
					finish(error instanceof Error ? error : new Error(String(error)));
				} else {
					finish();
				}
			});
		});
	}

	/** Logs out here, and revokes the token at OSM (best effort). */
	logout(): void {
		const token = this.token();
		this.#attempt++;
		this.#auth?.logout();
		this.loggedIn = false;
		this.userName = null;
		if (token) void this.#revoke(token);
	}

	async #revoke(token: string): Promise<void> {
		try {
			await this.#fetch(`${this.#oauthUrl}/oauth2/revoke`, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ token, client_id: this.#clientId }),
			});
		} catch {
			// The token is gone from this browser; the server drops it in time.
		}
	}

	async #loadUser(): Promise<void> {
		const token = this.token();
		if (!token) return;
		try {
			const response = await this.#fetch(
				`${this.#apiUrl}/api/0.6/user/details.json`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			);
			if (response.status === 401) {
				this.logout();
				return;
			}
			const details = (await response.json()) as {
				user?: { display_name?: string };
			};
			this.userName = details.user?.display_name ?? null;
		} catch {
			// The name is only informative; uploading will report real problems.
		}
	}
}
