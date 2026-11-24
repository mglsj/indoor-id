import { startLocale } from "#lib/i18n/locale.ts";

// The editor runs entirely in the browser (MapLibre, IndexedDB, OSM OAuth), with OSM as its backend.
// Each route is prerendered as an empty shell and rendered on the client.
export const ssr = false;
export const prerender = true;

/** The page is marked with its language before any page renders (P6). */
export function load() {
	// Not while prerendering the empty shells, where there is no browser to ask.
	if (typeof document !== "undefined") startLocale();
	return {};
}
