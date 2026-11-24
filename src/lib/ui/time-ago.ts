import { currentLanguage, msg, t } from "#lib/i18n/messages.ts";

/**
 * "3 months ago": how long before `now` an ISO 8601 date was, in the largest whole unit, in the
 * language messages are shown in.
 */
export function timeAgo(iso: string, now = new Date()): string | null {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return null;
	const seconds = (then - now.getTime()) / 1000;
	if (Math.abs(seconds) < 60) return t(msg("time_just_now"));
	const format = new Intl.RelativeTimeFormat(currentLanguage(), {
		numeric: "auto",
	});
	for (const [unit, size] of UNITS) {
		if (Math.abs(seconds) >= size) {
			return format.format(Math.trunc(seconds / size), unit);
		}
	}
	return format.format(Math.trunc(seconds / 60), "minute");
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 3600],
	["month", 30 * 24 * 3600],
	["day", 24 * 3600],
	["hour", 3600],
	["minute", 60],
];
