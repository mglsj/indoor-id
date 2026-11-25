/**
 * The browser's Web Storage, where it can be used. A browser blocking site data (cookies
 * blocked, some private modes) throws as soon as `localStorage` or `sessionStorage` is read,
 * so they are only ever read through here.
 */
export function browserStorage(
	kind: "local" | "session" = "local",
): Storage | undefined {
	try {
		return (
			(kind === "local"
				? globalThis.localStorage
				: globalThis.sessionStorage) ?? undefined
		);
	} catch {
		return undefined;
	}
}

/** A storage that keeps nothing, for where the browser's can't be used. */
export const NO_STORAGE: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
};
