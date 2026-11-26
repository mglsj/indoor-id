/**
 * Extracts the presets IndoorID needs from iD's tagging schema
 * (@openstreetmap/id-tagging-schema, ISC) into src/lib/presets/generated/, with English
 * labels resolved, and copies the icons they and the categories use into its `icons/`.
 * Runs on `bun install` (the `prepare` script); the output is not committed.
 *
 * Usage: bun scripts/build-presets.ts
 */
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import overlay from "../src/lib/presets/overlay.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = join(root, "node_modules/@openstreetmap/id-tagging-schema/dist");
const out = join(root, "src/lib/presets/generated");

type Json = Record<string, unknown>;
const read = (file: string) =>
	JSON.parse(readFileSync(join(schema, file), "utf8"));

const presets: Record<string, Json> = read("presets.json");
const fields: Record<string, Json> = read("fields.json");
const deprecated: unknown[] = read("deprecated.json");
const categories: Record<string, Json> = read("preset_categories.json");
const strings = read("translations/en.json").en.presets as {
	presets: Record<string, Json>;
	fields: Record<string, Json>;
	categories: Record<string, Json>;
};

/** Top-level preset ids kept whole: things found inside buildings, and the fallbacks. */
const KEPT_GROUPS = new Set([
	"point",
	"line",
	"area",
	"relation",
	"indoor",
	"entrance",
	"amenity",
	"shop",
	"office",
	"craft",
	"healthcare",
	"emergency",
	"tourism",
	"leisure",
	"building",
	"building_part",
	"barrier",
	"public_transport",
	"advertising",
	"police",
	"polling_station",
	"education",
	"club",
]);

/** Single presets kept from other groups. */
const KEPT_PRESETS =
	/^(highway\/(elevator|steps|corridor|footway(\/conveying)?|pedestrian_area)|railway\/platform|type\/multipolygon)$/;

function isKept(id: string, preset: Json): boolean {
	if (id.startsWith("@")) return false;
	if (preset.replacement) return false; // deprecated presets
	if (isForSomeCountries(preset)) return false;
	return KEPT_GROUPS.has(id.split("/")[0] ?? "") || KEPT_PRESETS.test(id);
}

/** iD's geometry icons, for the fallback presets (vendored in `src/lib/presets/id-icons/`). */
const FALLBACK_ICONS: Record<string, string> = {
	point: "iD-icon-point",
	line: "iD-icon-line",
	area: "iD-icon-area",
};

const outPresets: Json[] = [];
const usedFields = new Set<string>();

for (const [id, preset] of Object.entries(presets)) {
	if (!isKept(id, preset)) continue;
	const text = strings.presets[id] ?? {};
	const own = {
		id,
		name: (text.name as string | undefined) ?? id,
		aliases: (text.aliases as string[] | undefined) ?? [],
		terms: (text.terms as string[] | undefined) ?? [],
		// The fallbacks have no icon in the schema; iD shows its geometry icons for them.
		icon: preset.icon ?? FALLBACK_ICONS[id],
		geometry: preset.geometry,
		tags: preset.tags,
		addTags: preset.addTags,
		removeTags: preset.removeTags,
		matchScore: preset.matchScore,
		searchable: preset.searchable,
		fields: preset.fields ?? [],
		moreFields: preset.moreFields ?? [],
		reference: preset.reference,
	};
	for (const field of [...own.fields, ...own.moreFields] as string[]) {
		usedFields.add(field);
	}
	outPresets.push(own);
}

// Local changes to the schema's presets (2026-11-26 conventions audit): `geometry`, `fields`
// and `moreFields` are added to, `addTags` replaces the schema's.
const extensions = overlay.extend as Record<string, Json>;
for (const [id, change] of Object.entries(extensions)) {
	const preset = outPresets.find((p) => p.id === id);
	if (!preset) throw new Error(`overlay.json extends a missing preset: ${id}`);
	for (const key of ["geometry", "fields", "moreFields"]) {
		const more = change[key] as string[] | undefined;
		if (!more) continue;
		const now = (preset[key] as string[] | undefined) ?? [];
		preset[key] = [...now, ...more.filter((v) => !now.includes(v))];
		if (key !== "geometry") for (const field of more) usedFields.add(field);
	}
	if (change.addTags) preset.addTags = change.addTags;
}

// Local presets and fields fill the gaps of the schema for Simple Indoor Tagging.
for (const preset of overlay.presets as Json[]) {
	const fields = [
		...(preset.fields as string[]),
		...((preset.moreFields as string[] | undefined) ?? []),
	];
	for (const field of fields) usedFields.add(field);
	outPresets.push(preset);
}

// Universal fields can be added to any feature, whether or not its preset lists them.
for (const [id, field] of Object.entries(fields)) {
	if (field.universal) usedFields.add(id);
}

// A structure radio shows the type field of the structure chosen (bridge → `bridge`) and `layer`.
for (const id of [...usedFields]) {
	if (fields[id]?.type !== "structureRadio") continue;
	for (const key of [...((fields[id].keys as string[]) ?? []), "layer"]) {
		if (fields[key]) usedFields.add(key);
	}
}

/**
 * Presets and fields for some countries only (US GNIS ID, French SIRET…) are left out:
 * IndoorID doesn't know which country a feature is in. Those for the whole world but a few
 * countries stay.
 */
function isForSomeCountries(item: Json | undefined): boolean {
	const include = (item?.locationSet as { include?: unknown[] } | undefined)
		?.include;
	return (
		include !== undefined &&
		!include.includes("Planet") &&
		!include.includes("001")
	);
}

const outFields: Json[] = [];
let countryFields = 0;
for (const id of usedFields) {
	const field = fields[id];
	const local = (overlay.fields as Record<string, Json>)[id];
	if (!field && !local) continue;
	if (isForSomeCountries(field)) {
		countryFields++;
		continue;
	}
	const text = strings.fields[id] ?? {};
	const labels = (text.options ?? {}) as Record<
		string,
		string | { title: string; description?: string }
	>;
	const values =
		(local?.options as string[] | undefined) ??
		(field?.options as string[] | undefined) ??
		Object.keys(labels);
	outFields.push({
		id,
		key: field?.key ?? local?.key,
		keys: field?.keys,
		type: local?.type ?? field?.type,
		label: (local?.label as string | undefined) ?? text.label ?? id,
		placeholder: text.placeholder,
		options: values.map((value) => {
			const label = labels[value];
			if (typeof label === "string") return { value, label };
			return {
				value,
				label: label?.title ?? humanize(value),
				...(label?.description ? { description: label.description } : {}),
			};
		}),
		terms: (text.terms as string[] | undefined) ?? [],
		universal: field?.universal === true,
		prerequisiteTag: field?.prerequisiteTag,
		// iD's defaults when the schema says nothing.
		snakeCase: field?.snake_case !== false,
		caseSensitive: field?.caseSensitive === true,
		customValues: field?.customValues !== false,
		autoSuggestions: field?.autoSuggestions !== false,
		allowDuplicates: field?.allowDuplicates === true,
		increment: field?.increment,
		minValue: field?.minValue,
		maxValue: field?.maxValue,
		urlFormat: field?.urlFormat,
		pattern: field?.pattern,
		reference: field?.reference,
		default: field?.default,
		geometry: field?.geometry,
		// The access field's rows ("Foot", "Motor Vehicles"…).
		types: text.types,
		// The address field's parts; country variants (`city!jp`) are left out.
		placeholders: text.placeholders
			? Object.fromEntries(
					Object.entries(text.placeholders as Record<string, string>).filter(
						([part]) => !part.includes("!"),
					),
				)
			: undefined,
	});
}

/** Categories of presets, with the kept presets they hold. */
const keptPresets = new Set(outPresets.map((p) => p.id));
const outCategories: Json[] = [];
for (const [id, category] of Object.entries(categories)) {
	const members = (category.members as string[]).filter((m) =>
		keptPresets.has(m),
	);
	if (members.length === 0) continue;
	outCategories.push({
		id,
		name: (strings.categories[id]?.name as string | undefined) ?? id,
		icon: category.icon,
		members,
	});
}

/** `slowdown_button` → `Slowdown button`, for options the schema doesn't label. */
function humanize(value: string): string {
	const text = value.replaceAll("_", " ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

mkdirSync(out, { recursive: true });
const write = (file: string, data: unknown) =>
	writeFileSync(join(out, file), JSON.stringify(data));
write("presets.json", outPresets);
write("fields.json", outFields);
write("deprecated.json", deprecated);
write("categories.json", outCategories);
// Keys iD drops on save and never suggests (`created_by`…).
write("discarded.json", Object.keys(read("discarded.json")));

/**
 * The schema's translations of what was kept, one file per language IndoorID offers (P6),
 * loaded with the presets in that language (`presets/localize.ts`).
 */
const keptFields = new Set(outFields.map((f) => f.id as string));
const keptCategories = new Set(outCategories.map((c) => c.id as string));
const pick = <T>(all: Record<string, T> | undefined, kept: Set<string>) =>
	Object.fromEntries(
		Object.entries(all ?? {}).filter(([id]) => kept.has(id)),
	) as Record<string, T>;
mkdirSync(join(out, "translations"), { recursive: true });
// The languages offered, as Paraglide reads them.
const { locales } = JSON.parse(
	readFileSync(join(root, "project.inlang/settings.json"), "utf8"),
) as { locales: string[] };
for (const locale of locales) {
	if (locale === "en") continue;
	const text = read(`translations/${locale}.json`)[locale]?.presets ?? {};
	writeFileSync(
		join(out, "translations", `${locale}.json`),
		JSON.stringify({
			presets: pick(text.presets, keptPresets),
			fields: pick(text.fields, keptFields),
			categories: Object.fromEntries(
				Object.entries(pick<Json>(text.categories, keptCategories)).map(
					([id, category]) => [id, category.name],
				),
			),
		}),
	);
}

/**
 * Icon sets bundled for the presets and the map, by the prefix of iD's icon names
 * (`maki-toilet`), as iD bundles them: Maki and Temaki (CC0), Pinhead (CC0), Röntgen (CC BY
 * 4.0), the few of iD's own (ISC, vendored in `src/lib/presets/id-icons/`) and Font Awesome
 * (CC BY 4.0, below). Attribution is in LICENSE.md and `thirdPartyNotices()`.
 */
const ICON_SETS: Record<string, string> = {
	maki: "node_modules/@mapbox/maki/icons",
	temaki: "node_modules/@rapideditor/temaki/icons",
	pinhead: "node_modules/@waysidemapping/pinhead/dist/icons",
	roentgen: "node_modules/@enzet/roentgen/icons",
	iD: "src/lib/presets/id-icons",
};

/** A Font Awesome icon definition: width, height, ligatures, unicode, path data. */
type FaIcon = [number, number, unknown[], string, string | string[]];
interface FaDefinition {
	iconName: string;
	icon: FaIcon;
}

/**
 * Font Awesome icons by name and alias: iD's names are Font Awesome 5's (`fas-beer`,
 * `fas-tachometer-alt`), aliases of the current ones.
 */
async function fontAwesome(pkg: string): Promise<Map<string, FaIcon>> {
	const module = (await import(pkg)) as Record<string, unknown>;
	const icons = new Map<string, FaIcon>();
	for (const value of Object.values(module)) {
		const definition = value as Partial<FaDefinition> | undefined;
		if (!definition?.iconName || !Array.isArray(definition.icon)) continue;
		const [, , aliases] = definition.icon;
		for (const name of [definition.iconName, ...aliases]) {
			if (typeof name === "string" && !icons.has(name)) {
				icons.set(name, definition.icon);
			}
		}
	}
	return icons;
}

const FA_SETS: Record<string, Map<string, FaIcon>> = {
	fas: await fontAwesome("@fortawesome/free-solid-svg-icons"),
	far: await fontAwesome("@fortawesome/free-regular-svg-icons"),
};

function faSvg([width, height, , , path]: FaIcon): string {
	const d = Array.isArray(path) ? path.join(" ") : path;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path fill="currentColor" d="${d}"/></svg>`;
}

const iconsOut = join(out, "icons");
rmSync(iconsOut, { recursive: true, force: true });
mkdirSync(iconsOut);
let icons = 0;
const missing: string[] = [];
for (const icon of new Set(
	[...outPresets, ...outCategories].map((p) => p.icon),
)) {
	if (typeof icon !== "string") continue;
	const [, set, name] = icon.match(/^(\w+)-(.+)$/) ?? [];
	if (!set || !name) continue;
	const fa = FA_SETS[set]?.get(name);
	if (fa) {
		writeFileSync(join(iconsOut, `${icon}.svg`), faSvg(fa));
		icons++;
		continue;
	}
	const dir = ICON_SETS[set];
	const file = dir && join(root, dir, `${name}.svg`);
	if (!file || !existsSync(file)) {
		missing.push(icon);
		continue;
	}
	copyFileSync(file, join(iconsOut, `${icon}.svg`));
	icons++;
}

console.log(
	`Presets: ${outPresets.length} presets, ${outFields.length} fields (${countryFields} for some countries left out), ${outCategories.length} categories, ${icons} icons (not found: ${missing.join(", ") || "none"}) → src/lib/presets/generated/`,
);
