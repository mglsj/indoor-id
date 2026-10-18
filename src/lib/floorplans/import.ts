/**
 * Turns floor plan files into content the map can draw: raster files (PNG, JPEG, WebP), SVG
 * drawings and PDF pages. SVG and PDF are rendered here (they need the page's `<img>` and
 * canvas); decoding, cutting and encoding go to the codec (the plan worker).
 */
import { MessageError, msg } from "#lib/i18n/messages.ts";
import type { PlanCodec } from "./codec.ts";
import {
	type PlanContent,
	type PlanMode,
	rasterContent,
	vectorContent,
} from "./content.ts";
import { MAX_IMAGE_SIZE } from "./pyramid.ts";
import { extractPdfPage, pdfPageKind } from "./vector-pdf.ts";
import { extractSvg } from "./vector-svg.ts";

/** Longest side SVG drawings are rendered at: they have no resolution of their own. */
const SVG_SIZE = 4096;

export type PlanFileKind = "raster" | "svg" | "pdf" | "plans";

/** Accepted by the import file picker. */
export const ACCEPTED_FILES =
	"image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,.zip,.json";

export function kindOf(file: File): PlanFileKind | null {
	const name = file.name.toLowerCase();
	if (file.type === "image/svg+xml" || name.endsWith(".svg")) return "svg";
	if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
	if (file.type.startsWith("image/")) return "raster";
	if (
		["application/zip", "application/json"].includes(file.type) ||
		name.endsWith(".zip") ||
		name.endsWith(".json")
	) {
		return "plans";
	}
	return null;
}

/** File name without its extension, as the plan's name. */
export function planName(file: File): string {
	return file.name.replace(/\.[^.]+$/, "") || "Floor plan";
}

/** Reads each kind of plan file; an interface so that plan files are read in tests. */
export interface PlanDecoders {
	/** A PNG, JPEG or WebP plan, measured in its pixels (a large one is drawn smaller). */
	raster(file: Blob): Promise<PlanContent>;
	/** An SVG drawing, measured in its user units. */
	svg(file: Blob): Promise<PlanContent>;
	pdf(file: Blob): Promise<PdfDocument>;
}

/** The decoders of this page, cutting and encoding through `codec`. */
export function planDecoders(codec: PlanCodec): PlanDecoders {
	return {
		raster: (file) => importRaster(file, codec),
		svg: (file) => importDrawing(file, codec),
		pdf: (file) => openPdf(file, codec),
	};
}

async function importRaster(
	file: Blob,
	codec: PlanCodec,
): Promise<PlanContent> {
	const { image, width, height } = await codec.decodeFile(file);
	return rasterContent(image, { width, height });
}

/**
 * An SVG drawing as vector content, drawn sharp at any zoom; one holding images is rendered
 * instead, as vector plans don't draw images.
 */
async function importDrawing(
	file: Blob,
	codec: PlanCodec,
): Promise<PlanContent> {
	const text = await file.text();
	if (/<([\w-]+:)?image[\s/>]/.test(text)) return importSvg(file, codec);
	return vectorContent(extractSvg(text));
}

/**
 * Renders an SVG drawing through an `<img>`: images never run the scripts or load the
 * resources an SVG may contain.
 */
async function importSvg(file: Blob, codec: PlanCodec): Promise<PlanContent> {
	const url = URL.createObjectURL(
		file.type === "image/svg+xml"
			? file
			: new Blob([file], { type: "image/svg+xml" }),
	);
	try {
		const image = new Image();
		image.src = url;
		await image.decode().catch(() => {
			throw new MessageError(msg("plan_import_svg_unreadable"));
		});
		// Measured in the drawing's own units (CSS pixels of its intrinsic size).
		const width = image.naturalWidth || SVG_SIZE;
		const height = image.naturalHeight || SVG_SIZE;
		const scale = SVG_SIZE / Math.max(width, height);
		const canvas = new OffscreenCanvas(
			Math.max(1, Math.round(width * scale)),
			Math.max(1, Math.round(height * scale)),
		);
		canvas
			.getContext("2d")
			?.drawImage(image, 0, 0, canvas.width, canvas.height);
		return rasterContent(
			await codec.fromRendering(canvas.transferToImageBitmap()),
			{ width, height },
		);
	} finally {
		URL.revokeObjectURL(url);
	}
}

export interface PdfDocument {
	readonly pageCount: number;
	/** Page size in inches. */
	pageSize(page: number): Promise<{ width: number; height: number }>;
	/** A small PNG of the page, as an object URL (revoked by `close`). */
	thumbnail(page: number): Promise<string>;
	/** Renders a page (from 1) at `dpi` dots per inch, measured in points. */
	render(page: number, dpi: number): Promise<PlanContent>;
	/** A page's paths, measured in points. */
	vector(page: number): Promise<PlanContent>;
	/** How Auto draws a page: from its paths, or as an image for a scan (`pdfPageKind`). */
	pageMode(page: number): Promise<PlanMode>;
	close(): void;
}

/** Opens a PDF; pdf.js is only downloaded when a PDF is imported. */
async function openPdf(file: Blob, codec: PlanCodec): Promise<PdfDocument> {
	const [pdfjs, { default: workerUrl }] = await Promise.all([
		// The legacy build polyfills recent JavaScript (Map.getOrInsertComputed…) that pdf.js
		// 6 uses and many browsers still lack.
		import("pdfjs-dist/legacy/build/pdf.mjs"),
		import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
	]);
	pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
	const task = pdfjs.getDocument({
		data: new Uint8Array(await file.arrayBuffer()),
	});
	const pdf = await task.promise.catch(() => {
		throw new MessageError(msg("plan_import_pdf_unreadable"));
	});
	const urls: string[] = [];
	/** The PDF's CAD layers (optional content groups), by id. */
	let layers:
		| Promise<Map<string, { name: string; visible: boolean }>>
		| undefined;
	const groups = () => {
		layers ??= pdf
			.getOptionalContentConfig()
			.then(
				(config) =>
					new Map(
						[...config].map(([id, group]) => [
							id,
							{ name: group.name ?? id, visible: group.visible },
						]),
					),
			);
		return layers;
	};

	async function draw(page: number, scale: number): Promise<HTMLCanvasElement> {
		const pdfPage = await pdf.getPage(page);
		const viewport = pdfPage.getViewport({ scale });
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(viewport.width);
		canvas.height = Math.round(viewport.height);
		await pdfPage.render({ canvas, viewport, background: "white" }).promise;
		return canvas;
	}

	return {
		pageCount: pdf.numPages,
		async pageSize(page) {
			const viewport = (await pdf.getPage(page)).getViewport({ scale: 1 });
			// PDF units are points, 72 per inch.
			return { width: viewport.width / 72, height: viewport.height / 72 };
		},
		async thumbnail(page) {
			const { width, height } = (await pdf.getPage(page)).getViewport({
				scale: 1,
			});
			const canvas = await draw(page, 160 / Math.max(width, height));
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve),
			);
			const url = blob ? URL.createObjectURL(blob) : "";
			urls.push(url);
			return url;
		},
		async render(page, dpi) {
			const { width, height } = (await pdf.getPage(page)).getViewport({
				scale: 1,
			});
			const scale = Math.min(
				dpi / 72,
				MAX_IMAGE_SIZE / Math.max(width, height),
			);
			const canvas = await draw(page, scale);
			return rasterContent(
				await codec.fromRendering(await createImageBitmap(canvas)),
				{ width, height },
			);
		},
		async vector(page) {
			const pdfPage = await pdf.getPage(page);
			return vectorContent(
				extractPdfPage(
					await pdfPage.getOperatorList(),
					pdfPage.getViewport({ scale: 1 }),
					{ OPS: pdfjs.OPS, groups: await groups() },
				),
			);
		},
		async pageMode(page) {
			const pdfPage = await pdf.getPage(page);
			return pdfPageKind(
				await pdfPage.getOperatorList(),
				pdfPage.getViewport({ scale: 1 }),
				{ OPS: pdfjs.OPS },
			);
		},
		close() {
			for (const url of urls) URL.revokeObjectURL(url);
			void task.destroy();
		},
	};
}
