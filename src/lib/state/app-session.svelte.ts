/**
 * The app's one OSM login, made by `AppPage` once the configuration is loaded, shown in the
 * header on every page and used by the editor's uploads. Read with `getAppSession()`.
 */
import { getContext, setContext } from "svelte";
import type { EditorConfig } from "#lib/config.ts";
import { Session } from "#lib/state/session.svelte.ts";
import { resolve } from "$app/paths";

/** The session for `config`'s OSM website and OAuth application. */
export function sessionFor(config: EditorConfig): Session {
	return new Session({
		oauthUrl: config.oauth_url ?? config.osm_api_url,
		apiUrl: config.osm_api_url,
		clientId: config.oauth_client_id,
		redirectUri: new URL(resolve("/auth/callback"), location.href).href,
	});
}

export class AppSession {
	/** Null until the configuration is loaded. */
	current = $state.raw<Session | null>(null);
}

const KEY = Symbol("session");

export function setAppSession(session: AppSession): AppSession {
	return setContext(KEY, session);
}

/** The app's session, or one made for `config` outside `AppPage` (component tests). */
export function getAppSession(config: EditorConfig): Session {
	return getContext<AppSession | undefined>(KEY)?.current ?? sessionFor(config);
}
