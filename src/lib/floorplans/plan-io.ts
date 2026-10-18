/**
 * Floor plans in and out of files: a picked file opened as a plan, a PDF to pick pages from,
 * or a plan file's plans; and plans written to a plan file (version 2, an archive carrying
 * the files they come from). Files are decoded through `PlanDecoders`, so this runs in tests
 * without a browser.
 */
import { MessageError, msg } from "#lib/i18n/messages.ts";
import {
	type PlanContent,
	type PlanMode,
	type PlanOrigin,
	type PlanSize,
	type PlanSource,
	rasterContent,
} from "./content.ts";
import type { ControlPoint, Transform, TransformKind } from "./georef.ts";
import {
	kindOf,
	type PdfDocument,
	type PlanDecoders,
	planName,
} from "./import.ts";
import {
	type ArchivedPlan,
	isPlanArchive,
	type PlanFileBuildings,
	type PlanFileEntry,
	parsePlanFile,
	readPlanArchive,
	transformOf,
	writePlanArchive,
} from "./plan-file.ts";

/** A plan's settings, as files carry them. */
interface PlanFields {
	readonly name: string;
	readonly size: PlanSize;
	readonly transform: Transform;
	readonly controlPoints: readonly ControlPoint[];
	readonly fitKind: TransformKind;
	readonly opacity: number;
	readonly level: string | null;
	readonly visible: boolean;
	/** Ids of the CAD layers not shown; files from before have none. */
	readonly hiddenLayers?: readonly string[];
}

/** A plan read from a plan file, placed as saved, with its content and the file it is from. */
export interface ImportedPlan extends PlanFields, PlanOrigin {
	/** Files from before colours have none. */
	readonly color?: string;
	readonly content: PlanContent;
}

/** A plan file's plans, bottom first, and where it had the building outlines. */
export interface ImportedPlans {
	readonly plans: readonly ImportedPlan[];
	readonly buildings?: PlanFileBuildings;
}

/** A PDF opened for its pages to be picked. */
export interface OpenedPdf {
	readonly name: string;
	readonly document: PdfDocument;
	/** The PDF and its id: its pages' plans share it. */
	readonly origin: { readonly file: Blob; readonly id: string };
}

export type OpenedFile =
	| {
			readonly kind: "plan";
			readonly name: string;
			readonly content: PlanContent;
			readonly origin: PlanOrigin;
	  }
	| ({ readonly kind: "pdf" } & OpenedPdf)
	| { readonly kind: "plans"; readonly plans: ImportedPlans };

/** Opens a file picked for import. */
export async function openPlanFile(
	file: File,
	decoders: PlanDecoders,
): Promise<OpenedFile> {
	const name = planName(file);
	const id = crypto.randomUUID();
	switch (kindOf(file)) {
		case "raster":
		case "svg": {
			const kind = kindOf(file) as "raster" | "svg";
			return {
				kind: "plan",
				name,
				...(await drawing(kind, id, file, decoders)),
			};
		}
		case "pdf":
			return {
				kind: "pdf",
				name,
				document: await decoders.pdf(file),
				origin: { file, id },
			};
		case "plans":
			return { kind: "plans", plans: await readPlans(file, decoders) };
		default:
			throw new MessageError(msg("plan_import_unsupported"));
	}
}

/** A photo's or a drawing's content and origin; a drawing's mode is what it was drawn as. */
async function drawing(
	kind: "raster" | "svg",
	id: string,
	file: Blob,
	decoders: PlanDecoders,
): Promise<{ content: PlanContent; origin: PlanOrigin }> {
	const content = await decoders[kind](file);
	const source: PlanSource =
		kind === "raster"
			? { kind, file: id }
			: { kind, file: id, mode: content.vector ? "vector" : "image" };
	return { content, origin: { source, file } };
}

/**
 * A page of an opened PDF as a new plan's content: from its paths, as an image rendered at
 * `dpi`, or as Auto finds best for the page.
 */
export async function pdfPage(
	{ name, document, origin }: OpenedPdf,
	page: number,
	dpi: number,
	mode: PlanMode | "auto",
): Promise<{ name: string; content: PlanContent; origin: PlanOrigin }> {
	const drawn = mode === "auto" ? await document.pageMode(page) : mode;
	return {
		name: document.pageCount > 1 ? `${name}, page ${page}` : name,
		content:
			drawn === "vector"
				? await document.vector(page)
				: await document.render(page, dpi),
		origin: {
			source: { kind: "pdf", file: origin.id, page, dpi, mode: drawn },
			file: origin.file,
		},
	};
}

/** Reads a plan file: an archive (version 2), or JSON (version 1, OsmInEdit 1.x). */
export async function readPlans(
	file: Blob,
	decoders: PlanDecoders,
): Promise<ImportedPlans> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	return isPlanArchive(bytes)
		? readArchive(bytes, decoders)
		: readJson(new TextDecoder().decode(bytes), decoders);
}

async function readArchive(
	bytes: Uint8Array,
	decoders: PlanDecoders,
): Promise<ImportedPlans> {
	const { plans, files, buildings } = readPlanArchive(bytes);
	// Each file gets a new id here: its plans share it, other plans don't.
	const blobs = new Map(
		[...files].map(([path, data]) => [
			path,
			{
				id: crypto.randomUUID(),
				blob: new Blob([new Uint8Array(data)], { type: typeOf(path) }),
			},
		]),
	);
	const pdfs = new Map<string, Promise<PdfDocument>>();
	try {
		const imported: ImportedPlan[] = [];
		for (const plan of plans) {
			const file = blobs.get(plan.source.file);
			if (!file) continue;
			const source = { ...plan.source, file: file.id };
			imported.push({
				...plan,
				source,
				file: file.blob,
				content: await contentOf(plan, file.blob, decoders, pdfs),
			});
		}
		return { plans: imported, ...(buildings ? { buildings } : {}) };
	} finally {
		for (const pdf of pdfs.values()) void pdf.then((d) => d.close());
	}
}

/** A plan's content drawn from its file again, measured as saved. */
async function contentOf(
	plan: ArchivedPlan,
	file: Blob,
	decoders: PlanDecoders,
	pdfs: Map<string, Promise<PdfDocument>>,
): Promise<PlanContent> {
	const { source, size } = plan;
	let decoded: PlanContent;
	if (source.kind === "pdf") {
		let pdf = pdfs.get(source.file);
		if (!pdf) {
			pdf = decoders.pdf(file);
			pdfs.set(source.file, pdf);
		}
		const document = await pdf;
		decoded =
			source.mode === "vector"
				? await document.vector(source.page)
				: await document.render(source.page, source.dpi);
	} else {
		decoded = await decoders[source.kind](file);
	}
	return decoded.raster
		? rasterContent(decoded.raster.image, size)
		: { ...decoded, size };
}

async function readJson(
	text: string,
	decoders: PlanDecoders,
): Promise<ImportedPlans> {
	const { plans, buildings } = parsePlanFile(text);
	const imported: ImportedPlan[] = [];
	for (const entry of plans) imported.push(await readEntry(entry, decoders));
	return { plans: imported, ...(buildings ? { buildings } : {}) };
}

async function readEntry(
	entry: PlanFileEntry,
	decoders: PlanDecoders,
): Promise<ImportedPlan> {
	const file = await (await fetch(entry.image)).blob();
	const kind = file.type === "image/svg+xml" ? "svg" : "raster";
	const decoded = await decoders[kind](file);
	// Measured as saved: files from before plan units give the image's pixels.
	const size =
		entry.width && entry.height
			? { width: entry.width, height: entry.height }
			: decoded.size;
	return {
		name: entry.name,
		size,
		transform: transformOf(entry, size.width, size.height),
		controlPoints: entry.controlPoints,
		fitKind:
			"transform" in entry.placement
				? entry.placement.transform.kind
				: "projective",
		opacity: entry.opacity,
		level: entry.level,
		visible: entry.visible,
		...(entry.color ? { color: entry.color } : {}),
		source:
			kind === "svg"
				? {
						kind,
						file: crypto.randomUUID(),
						mode: decoded.vector ? "vector" : "image",
					}
				: { kind, file: crypto.randomUUID() },
		file,
		content: decoded.raster
			? rasterContent(decoded.raster.image, size)
			: decoded,
	};
}

/** What a plan file keeps of a plan. */
export interface ExportedPlan extends PlanFields {
	readonly id: string;
	readonly source: PlanSource;
	readonly color: string;
}

/**
 * A plan file (version 2) of `plans`, bottom first, with the files they come from (each once),
 * from `fileOf`; a plan without one (its saving failed) is left out.
 */
export async function writePlanFile(
	plans: readonly ExportedPlan[],
	buildings: PlanFileBuildings,
	fileOf: (plan: ExportedPlan) => Promise<Blob | undefined>,
): Promise<Blob> {
	const blobs = await Promise.all(plans.map(fileOf));
	const paths = new Map<string, string>();
	const files = new Map<string, Uint8Array>();
	const archived: ArchivedPlan[] = [];
	let below = 0;
	for (const [index, plan] of plans.entries()) {
		const blob = blobs[index];
		if (!blob) continue;
		if (index < buildings.below) below++;
		let path = paths.get(plan.source.file);
		if (!path) {
			path = `files/${paths.size + 1}.${extensionOf(blob, plan.source)}`;
			paths.set(plan.source.file, path);
			files.set(path, new Uint8Array(await blob.arrayBuffer()));
		}
		const { id: _, source, ...fields } = plan;
		archived.push({ ...fields, source: { ...source, file: path } });
	}
	const bytes = writePlanArchive({
		plans: archived,
		files,
		buildings: { below, visible: buildings.visible },
	});
	return new Blob([new Uint8Array(bytes)], { type: "application/zip" });
}

const TYPES: Record<string, string> = {
	pdf: "application/pdf",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	webp: "image/webp",
};

function extensionOf(blob: Blob, source: PlanSource): string {
	if (source.kind !== "raster") return source.kind;
	const known = Object.entries(TYPES).find(([, type]) => type === blob.type);
	return known?.[0] ?? "img";
}

function typeOf(path: string): string {
	return TYPES[path.slice(path.lastIndexOf(".") + 1)] ?? "";
}
