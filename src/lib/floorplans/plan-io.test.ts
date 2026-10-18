import { describe, expect, it } from "vitest";
import type { MessageError } from "#lib/i18n/messages.ts";
import { fakeImage } from "#lib/state/testing/plan-store.ts";
import { rasterContent, vectorContent } from "./content.ts";
import { corners, place } from "./georef.ts";
import type { PdfDocument, PlanDecoders } from "./import.ts";
import { exportPlans } from "./plan-file.ts";
import {
	type ExportedPlan,
	openPlanFile,
	pdfPage,
	readPlans,
	writePlanFile,
} from "./plan-io.ts";
import { RENNES } from "./test-geometry.ts";
import type { VectorContent } from "./vector.ts";

/** An A4 page's paths: one line across it. */
const paths: VectorContent = {
	size: { width: 595.28, height: 841.89 },
	segments: new Float32Array([0, 0, 595.28, 841.89]),
	segmentStyles: new Uint32Array([0]),
	triangles: new Float32Array([]),
	triangleStyles: new Uint32Array([]),
	texts: [],
	styles: [{ color: [0, 0, 0, 255], width: 0, layer: -1 }],
	layers: [],
};

/**
 * Photos are 400 × 300 px; SVG drawings 800 × 600 user units, rendered at 400 × 300 px; PDF
 * pages A4 in points, rendered at 400 × 300 px whatever the DPI. Records what it was asked.
 */
function fakeDecoders() {
	const pdfs: string[] = [];
	const rendered: [number, number][] = [];
	const drawn: number[] = [];
	const decoders: PlanDecoders = {
		raster: async () => rasterContent(fakeImage()),
		svg: async () => rasterContent(fakeImage(), { width: 800, height: 600 }),
		pdf: async (file): Promise<PdfDocument> => {
			pdfs.push(await file.text());
			return {
				pageCount: 2,
				pageSize: async () => ({ width: 8.27, height: 11.69 }),
				thumbnail: async () => "",
				render: async (page, dpi) => {
					rendered.push([page, dpi]);
					return rasterContent(fakeImage(), {
						width: 595.28,
						height: 841.89,
					});
				},
				vector: async (page) => {
					drawn.push(page);
					return vectorContent(paths);
				},
				// Page 1 is drawn, page 2 scanned.
				pageMode: async (page) => (page === 1 ? "vector" : "image"),
				close: () => {},
			};
		},
	};
	return { decoders, pdfs, rendered, drawn };
}

const file = (name: string, type: string, content = "x") =>
	new File([content], name, { type });

describe("openPlanFile: what a file picked for import gives", () => {
	it("decodes a photo, an SVG drawing, named after the file and kept as their source", async () => {
		const { decoders } = fakeDecoders();
		const picked = file("Ground floor.png", "image/png");
		const photo = await openPlanFile(picked, decoders);
		if (photo.kind !== "plan") throw new Error("not a plan");
		expect(photo.name).toBe("Ground floor");
		expect(photo.content.size).toEqual({ width: 400, height: 300 });
		expect(photo.origin.source).toEqual({
			kind: "raster",
			file: expect.any(String),
		});
		expect(photo.origin.file).toBe(picked);

		const drawing = await openPlanFile(
			file("first.svg", "image/svg+xml"),
			decoders,
		);
		if (drawing.kind !== "plan") throw new Error("not a plan");
		expect(drawing.content.size).toEqual({ width: 800, height: 600 });
		expect(drawing.origin.source).toMatchObject({ kind: "svg", mode: "image" });
		expect(drawing.origin.source.file).not.toBe(photo.origin.source.file);
	});

	it("opens a PDF whose pages, picked, come from the PDF stored once", async () => {
		const { decoders, rendered } = fakeDecoders();
		const picked = file("Mall.pdf", "application/pdf", "%PDF");
		const opened = await openPlanFile(picked, decoders);
		if (opened.kind !== "pdf") throw new Error("not a PDF");
		expect(opened.name).toBe("Mall");

		const [one, two] = await Promise.all([
			pdfPage(opened, 1, 150, "image"),
			pdfPage(opened, 2, 300, "image"),
		]);
		expect(rendered).toEqual([
			[1, 150],
			[2, 300],
		]);
		expect([one.name, two.name]).toEqual(["Mall, page 1", "Mall, page 2"]);
		expect(two.content.size).toEqual({ width: 595.28, height: 841.89 });
		expect(two.origin.source).toEqual({
			kind: "pdf",
			file: one.origin.source.file,
			page: 2,
			dpi: 300,
			mode: "image",
		});
		expect(two.origin.file).toBe(picked);
	});

	it("draws a page as chosen: its paths, its image, or as Auto finds it", async () => {
		const { decoders, rendered, drawn } = fakeDecoders();
		const opened = await openPlanFile(
			file("Mall.pdf", "application/pdf"),
			decoders,
		);
		if (opened.kind !== "pdf") throw new Error("not a PDF");
		const vector = await pdfPage(opened, 2, 150, "vector");
		expect(vector.content).toEqual({ size: paths.size, vector: paths });
		expect(vector.origin.source).toMatchObject({ page: 2, mode: "vector" });
		const auto = await Promise.all([
			pdfPage(opened, 1, 150, "auto"),
			pdfPage(opened, 2, 150, "auto"),
		]);
		expect(auto.map((p) => p.origin.source)).toMatchObject([
			{ page: 1, mode: "vector" },
			{ page: 2, mode: "image" },
		]);
		expect(drawn).toEqual([2, 1]);
		expect(rendered).toEqual([[2, 150]]);
	});

	it("names a page after the file alone when it has one page", async () => {
		const { decoders } = fakeDecoders();
		const opened = await openPlanFile(
			file("Mall.pdf", "application/pdf"),
			decoders,
		);
		if (opened.kind !== "pdf") throw new Error("not a PDF");
		const single = {
			...opened,
			document: { ...opened.document, pageCount: 1 },
		};
		expect((await pdfPage(single, 1, 150, "image")).name).toBe("Mall");
	});

	it("reads a plan file, an archive or JSON from earlier versions", async () => {
		const { decoders } = fakeDecoders();
		const archive = await writePlanFile([], { below: 0, visible: true }, () =>
			Promise.resolve(undefined),
		);
		expect(
			await openPlanFile(
				new File([archive], "plans.zip", { type: "application/zip" }),
				decoders,
			),
		).toEqual({
			kind: "plans",
			plans: { plans: [], buildings: { below: 0, visible: true } },
		});
		expect(
			await openPlanFile(
				file("plans.json", "application/json", exportPlans([])),
				decoders,
			),
		).toEqual({ kind: "plans", plans: { plans: [] } });
	});

	it("refuses other files", async () => {
		const { decoders } = fakeDecoders();
		const failure = await openPlanFile(
			file("notes.txt", "text/plain"),
			decoders,
		).catch((e: unknown) => e);
		expect((failure as MessageError).msg).toEqual({
			key: "plan_import_unsupported",
		});
	});
});

const transform = place(
	{ center: RENNES, metresPerPixel: 0.05, bearing: 30 },
	800,
	600,
);

describe("writePlanFile and readPlans: plan files, version 2", () => {
	const plan = (
		id: string,
		name: string,
		source: ExportedPlan["source"],
	): ExportedPlan => ({
		id,
		name,
		size: { width: 595.28, height: 841.89 },
		source,
		transform,
		fitKind: "affine",
		controlPoints: [{ image: [1, 2], map: RENNES }],
		opacity: 0.3,
		level: "1",
		visible: false,
		color: "#16a34a",
	});
	const files = new Map([
		["mall", new Blob(["%PDF"], { type: "application/pdf" })],
		["drawing", new Blob(["<svg/>"], { type: "image/svg+xml" })],
	]);
	const fileOf = async (plan: ExportedPlan) => files.get(plan.source.file);

	it("carries each plan with its file, a PDF once for its pages, drawn again when read", async () => {
		const { decoders, pdfs, rendered, drawn } = fakeDecoders();
		const archive = await writePlanFile(
			[
				{
					...plan("a", "Mall, page 1", {
						kind: "pdf",
						file: "mall",
						page: 1,
						dpi: 150,
						mode: "vector",
					}),
					hiddenLayers: ["232R"],
				},
				plan("b", "Mall, page 2", {
					kind: "pdf",
					file: "mall",
					page: 2,
					dpi: 200,
				}),
				{
					...plan("c", "Drawing", { kind: "svg", file: "drawing" }),
					size: { width: 800, height: 600 },
				},
			],
			{ below: 2, visible: false },
			fileOf,
		);
		expect(archive.type).toBe("application/zip");

		const { plans, buildings } = await readPlans(archive, decoders);
		expect(buildings).toEqual({ below: 2, visible: false });
		expect(plans.map((p) => p.name)).toEqual([
			"Mall, page 1",
			"Mall, page 2",
			"Drawing",
		]);
		const [one, two, drawing] = plans;
		expect(one).toMatchObject({
			size: { width: 595.28, height: 841.89 },
			transform,
			fitKind: "affine",
			controlPoints: [{ image: [1, 2], map: RENNES }],
			opacity: 0.3,
			level: "1",
			visible: false,
			color: "#16a34a",
			hiddenLayers: ["232R"],
		});
		expect(two?.hiddenLayers).toBeUndefined();
		// The PDF, opened once, its pages drawn again as they were: page 1 from its paths,
		// page 2 (saved before modes, so an image) rendered at its DPI; shared again once
		// imported.
		expect(pdfs).toEqual(["%PDF"]);
		expect(drawn).toEqual([1]);
		expect(rendered).toEqual([[2, 200]]);
		expect(one?.source).toMatchObject({ page: 1, mode: "vector" });
		expect(one?.content.vector).toBe(paths);
		expect(two?.source).toEqual({
			kind: "pdf",
			file: one?.source.file,
			page: 2,
			dpi: 200,
		});
		expect(two?.file).toBe(one?.file);
		expect(await one?.file.text()).toBe("%PDF");
		expect(one?.file.type).toBe("application/pdf");
		// Rendered at 400 px over 595.28 pt.
		expect(two?.content.raster?.unit).toBeCloseTo(595.28 / 400, 9);
		expect(drawing?.source.kind).toBe("svg");
		expect(await drawing?.file.text()).toBe("<svg/>");
		expect(drawing?.content.size).toEqual({ width: 800, height: 600 });
	});

	it("leaves out a plan whose file is gone, from under the outlines too", async () => {
		const { decoders } = fakeDecoders();
		const archive = await writePlanFile(
			[
				plan("x", "Lost", { kind: "raster", file: "lost" }),
				plan("c", "Drawing", { kind: "svg", file: "drawing" }),
			],
			{ below: 1, visible: true },
			fileOf,
		);
		const { plans, buildings } = await readPlans(archive, decoders);
		expect(plans.map((p) => p.name)).toEqual(["Drawing"]);
		expect(buildings).toEqual({ below: 0, visible: true });
	});
});

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = `data:image/svg+xml;base64,${btoa("<svg/>")}`;

describe("readPlans: plan files of earlier versions", () => {
	it("reads a version 1 file: each image its plan's source, measured as the file says", async () => {
		const { decoders } = fakeDecoders();
		const text = exportPlans(
			[
				{
					name: "Drawing",
					image: SVG,
					width: 800,
					height: 600,
					level: "1",
					opacity: 0.3,
					visible: false,
					color: "#16a34a",
					placement: { transform },
					controlPoints: [{ image: [1, 2], map: RENNES }],
				},
			],
			{ below: 1, visible: false },
		);
		const { plans, buildings } = await readPlans(new Blob([text]), decoders);
		expect(buildings).toEqual({ below: 1, visible: false });
		const [plan] = plans;
		expect(plan).toMatchObject({
			name: "Drawing",
			size: { width: 800, height: 600 },
			transform,
			fitKind: "similarity",
			opacity: 0.3,
			level: "1",
			visible: false,
			color: "#16a34a",
		});
		expect(plan?.source.kind).toBe("svg");
		expect(await plan?.file.text()).toBe("<svg/>");
		// Rendered at 400 px over 800 units: two units per pixel.
		expect(plan?.content.raster?.unit).toBe(2);
	});

	it("reads a 1.x plan, measured by its image, placed by its four corners", async () => {
		const { decoders } = fakeDecoders();
		const text = JSON.stringify([
			{
				label: "Old",
				image: PNG,
				topleft: [48.1, -1.7],
				topright: [48.1, -1.6],
				bottomright: [48.0, -1.6],
				bottomleft: [48.0, -1.7],
				level: -1,
				opacity: 1,
			},
		]);
		const [plan] = (await readPlans(new Blob([text]), decoders)).plans;
		expect(plan).toMatchObject({
			name: "Old",
			size: { width: 400, height: 300 },
			fitKind: "projective",
			level: "-1",
			source: { kind: "raster" },
		});
		expect(plan?.content.raster?.unit).toBe(1);
		const [tl] = corners(plan?.transform ?? transform, 400, 300);
		expect(tl?.[0]).toBeCloseTo(-1.7, 9);
		expect(tl?.[1]).toBeCloseTo(48.1, 9);
	});
});
