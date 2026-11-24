/**
 * The language IndoorID is shown in (P6), as Paraglide resolves it (`bun run messages`'s
 * strategy): the one chosen in the header's menu, kept in `localStorage`, else the browser's,
 * else English. Choosing another reloads the page, Paraglide's default: the text already shown
 * isn't reactive, and edits are autosaved.
 */
import {
	getLocale,
	type Locale,
	locales,
	setLocale,
} from "./paraglide/runtime.js";

export type { Locale };

/** Marks the page with its language (`<html lang>`), before the first page renders. */
export function startLocale(): Locale {
	const locale = getLocale();
	document.documentElement.lang = locale;
	return locale;
}

/** The language shown. */
export function currentLocale(): Locale {
	return getLocale();
}

/** Shows IndoorID in another language from now on: kept in this browser, the page reloaded. */
export function chooseLocale(locale: Locale): void {
	void setLocale(locale);
}

/** Each language by its own name ("Français"), for the picker. */
export function localeNames(): { locale: Locale; name: string }[] {
	return locales.map((locale) => {
		const name =
			new Intl.DisplayNames([locale], { type: "language" }).of(locale) ??
			locale;
		return {
			locale,
			name: name.charAt(0).toLocaleUpperCase(locale) + name.slice(1),
		};
	});
}
