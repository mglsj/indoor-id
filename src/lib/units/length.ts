/**
 * Lengths shown and typed (C.0). Everything is in metres inside; the units setting only
 * changes what is shown (metres to the centimetre, or feet and inches to the quarter inch) and
 * what a bare typed number means. Typed values can name their unit whatever the setting:
 * `3.2`, `3,2`, `3.2 m`, `320 cm`, `12'6"`, `12 ft 6 in`, `6 1/2"`. OSM keeps 7 decimals
 * (about a centimetre), so nothing is promised finer than that.
 */

export type Units = "metric" | "imperial";

/** Regions that measure buildings in feet and inches. */
const IMPERIAL = new Set(["US", "LR", "MM"]);

/** The units usual where the browser's language points (`en-US`, `en` for the US, `de`). */
export function defaultUnits(locale: string): Units {
	try {
		const region = new Intl.Locale(locale).maximize().region;
		return region && IMPERIAL.has(region) ? "imperial" : "metric";
	} catch {
		return "metric";
	}
}

const FOOT = 0.3048;
const INCH = FOOT / 12;

const UNIT_METRES: Record<string, number> = {
	mm: 0.001,
	cm: 0.01,
	m: 1,
	km: 1000,
	ft: FOOT,
	foot: FOOT,
	feet: FOOT,
	"'": FOOT,
	"′": FOOT,
	in: INCH,
	inch: INCH,
	inches: INCH,
	'"': INCH,
	"″": INCH,
};

const PART =
	/\s*(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|[.,]\d+)\s*(mm|cm|km|m|feet|foot|ft|inches|inch|in|'|′|"|″)?/y;

/** A number as typed: `3.5`, `3,5`, `1/4`, `6 1/2`. */
function parseNumber(text: string): number {
	const [whole, fraction] = text.includes("/")
		? text.includes(" ")
			? text.split(/\s+/)
			: ["0", text]
		: [text, undefined];
	let value = Number((whole ?? "0").replace(",", "."));
	if (fraction) {
		const [n, d] = fraction.split("/").map(Number);
		if (!d) return Number.NaN;
		value += (n ?? 0) / d;
	}
	return value;
}

/**
 * Metres for a typed length, or null when it doesn't read as one. A bare number is in the
 * setting's main unit (metres or feet); a bare number after feet is inches (`12'6`). A leading
 * `-` makes it negative (an offset to the other side).
 */
export function parseLength(text: string, units: Units): number | null {
	let rest = text.trim();
	let sign = 1;
	if (rest.startsWith("-")) {
		sign = -1;
		rest = rest.slice(1);
	}
	if (!rest) return null;
	let total = 0;
	let index = 0;
	let previous: number | null = null;
	while (index < rest.length) {
		PART.lastIndex = index;
		const match = PART.exec(rest);
		if (!match) return null;
		index = PART.lastIndex;
		const value = parseNumber(match[1] ?? "");
		if (!Number.isFinite(value)) return null;
		let unit = match[2] ? UNIT_METRES[match[2]] : undefined;
		if (unit === undefined) {
			// A bare number: the main unit first, inches after feet.
			if (previous === FOOT) unit = INCH;
			else if (previous === null) unit = units === "metric" ? 1 : FOOT;
			else return null;
		}
		total += value * unit;
		previous = unit;
		if (/^\s*$/.test(rest.slice(index))) break;
	}
	return sign * total;
}

/** A length for display: `3.42 m`, or `11' 2¼"` in imperial units. */
export function formatLength(metres: number, units: Units): string {
	if (units === "metric") {
		const cm = Math.round(metres * 100);
		return `${(cm / 100).toFixed(2)} m`;
	}
	const sign = metres < 0 ? "-" : "";
	const quarters = Math.round((Math.abs(metres) / INCH) * 4);
	const feet = Math.floor(quarters / 48);
	const inchQuarters = quarters - feet * 48;
	const inches = Math.floor(inchQuarters / 4);
	const fraction = ["", "¼", "½", "¾"][inchQuarters % 4];
	return feet > 0
		? `${sign}${feet}' ${inches}${fraction}"`
		: `${sign}${inches}${fraction}"`;
}

/** An area for display: `12.5 m²`, or `134 ft²`. */
export function formatArea(squareMetres: number, units: Units): string {
	if (units === "metric") {
		return `${squareMetres < 100 ? squareMetres.toFixed(2) : Math.round(squareMetres)} m²`;
	}
	const feet = squareMetres / (FOOT * FOOT);
	return `${feet < 100 ? feet.toFixed(1) : Math.round(feet)} ft²`;
}

/** An angle for display: `90°`, `22.5°`. */
export function formatAngle(degrees: number): string {
	const tenths = Math.round(degrees * 10) / 10;
	return `${Object.is(tenths, -0) ? 0 : tenths}°`;
}
