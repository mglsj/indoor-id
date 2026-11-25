/**
 * What a page puts in the app's header (A.2): `AppPage` draws the header, and the page under it
 * (`MapShell`, `EditorView`) fills these slots while it is shown. Read and set through
 * `getHeader()`.
 */
import { getContext, type Snippet, setContext } from "svelte";

export class HeaderSlots {
	/** After the page links: where you are inside the page (the building entered). */
	crumb = $state.raw<Snippet | undefined>();
	/** Place search, between the page links and the right side. */
	search = $state.raw<Snippet | undefined>();
	/** The page's actions on the right, before Licenses, Language and Theme (Save, Issues). */
	actions = $state.raw<Snippet | undefined>();
}

const KEY = Symbol("header");

export function setHeader(slots: HeaderSlots): HeaderSlots {
	return setContext(KEY, slots);
}

/** The header's slots, or a detached set outside `AppPage` (component tests). */
export function getHeader(): HeaderSlots {
	return getContext<HeaderSlots | undefined>(KEY) ?? new HeaderSlots();
}

/**
 * Shows `snippet` in one of the header's slots while the calling component lives. Call it in a
 * component's script: it registers an effect.
 */
export function useHeaderSlot(
	slots: HeaderSlots,
	slot: "crumb" | "search" | "actions",
	snippet: () => Snippet | undefined,
): void {
	$effect(() => {
		slots[slot] = snippet();
		return () => {
			slots[slot] = undefined;
		};
	});
}
