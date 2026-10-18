/**
 * The paths and text of a PDF page, from pdf.js's operator list, as vector content in points
 * from the page's top left (the page's viewport at scale 1). Follows the transform, colours,
 * opacity and line width through save and restore and form XObjects, the text position and
 * font size, and the CAD layer (optional content group) each path or text is in. Clipping
 * paths, shadings, images and invisible text are left out.
 * Pure: pdf.js's operator codes come as an argument, so pdf.js loads only when a PDF does.
 */
import {
	type PaintText,
	rgba,
	VectorBuilder,
	type VectorContent,
} from "./vector.ts";

export interface OperatorList {
	readonly fnArray: ArrayLike<number>;
	readonly argsArray: ArrayLike<unknown>;
}

/** The pdf.js operator codes read here (`OPS` from pdf.js). */
export type PdfOps = Record<
	| "save"
	| "restore"
	| "transform"
	| "paintFormXObjectBegin"
	| "paintFormXObjectEnd"
	| "setLineWidth"
	| "setGState"
	| "setStrokeRGBColor"
	| "setFillRGBColor"
	| "setStrokeColorN"
	| "setFillColorN"
	| "setStrokeTransparent"
	| "setFillTransparent"
	| "constructPath"
	| "stroke"
	| "closeStroke"
	| "fill"
	| "eoFill"
	| "fillStroke"
	| "eoFillStroke"
	| "closeFillStroke"
	| "closeEOFillStroke"
	| "endPath"
	| "rawFillPath"
	| "beginMarkedContent"
	| "beginMarkedContentProps"
	| "endMarkedContent"
	| "paintImageXObject"
	| "paintInlineImageXObject"
	| "paintImageMaskXObject"
	| "paintImageXObjectRepeat"
	| "beginText"
	| "setFont"
	| "setTextMatrix"
	| "moveText"
	| "setLeadingMoveText"
	| "nextLine"
	| "setLeading"
	| "setCharSpacing"
	| "setWordSpacing"
	| "setHScale"
	| "setTextRise"
	| "setTextRenderingMode"
	| "showText",
	number
>;

/** How a PDF page is drawn: from its paths, or rendered as an image. */
export type PageMode = "vector" | "image";

/** Images covering this share of a page or more make Auto render it as an image. */
export const IMAGE_SHARE = 0.5;

/**
 * How Auto draws a page: from its paths, unless it has none or images cover at least half of
 * it (a scan saved as a PDF). An image fills the unit square of its transform; overlaps and
 * clipping aren't taken off.
 */
export function pdfPageKind(
	list: OperatorList,
	viewport: PageViewport,
	{ OPS }: { readonly OPS: PdfOps },
): PageMode {
	let ctm: Matrix = [1, 0, 0, 1, 0, 0];
	const saved: Matrix[] = [];
	let images = 0;
	let paths = 0;
	const imageOps = new Set([
		OPS.paintImageXObject,
		OPS.paintInlineImageXObject,
		OPS.paintImageMaskXObject,
		OPS.paintImageXObjectRepeat,
	]);
	for (let i = 0; i < list.fnArray.length; i++) {
		const fn = list.fnArray[i] ?? -1;
		const args = (list.argsArray[i] ?? []) as unknown[];
		if (fn === OPS.save) saved.push(ctm);
		else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd)
			ctm = saved.pop() ?? ctm;
		else if (fn === OPS.transform) ctm = multiply(ctm, args as number[]);
		else if (fn === OPS.paintFormXObjectBegin) {
			saved.push(ctm);
			const matrix = args[0] as number[] | null;
			if (matrix) ctm = multiply(ctm, matrix);
		} else if (fn === OPS.constructPath && args[0] !== OPS.endPath) paths++;
		else if (imageOps.has(fn))
			images += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
	}
	const share = images / (viewport.width * viewport.height);
	return paths > 0 && share < IMAGE_SHARE ? "vector" : "image";
}

export interface PageViewport {
	readonly width: number;
	readonly height: number;
	/** From PDF user space to the viewport: `[a, b, c, d, e, f]`. */
	readonly transform: ArrayLike<number>;
}

/** pdf.js's path codes. */
const MOVE = 0;
const LINE = 1;
const CUBIC = 2;
const QUAD = 3;
const CLOSE = 4;

/** Colour given to pattern paint: patterns aren't drawn. */
const PATTERN = "#808080";

type Matrix = [number, number, number, number, number, number];

interface State {
	ctm: Matrix;
	stroke: string | null;
	fill: string | null;
	strokeAlpha: number;
	fillAlpha: number;
	width: number;
	/** The text state: font size, spacing in unscaled text space, horizontal scale (1 is 100%). */
	fontSize: number;
	charSpacing: number;
	wordSpacing: number;
	hScale: number;
	leading: number;
	rise: number;
	/** 3 and 7 draw nothing. */
	textMode: number;
}

/** A glyph as pdf.js gives it in `showText`; numbers between glyphs move the next one back. */
interface Glyph {
	readonly unicode?: string;
	/** Thousandths of an em. */
	readonly width: number;
	readonly isSpace?: boolean;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: ArrayLike<number>): Matrix {
	const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = Array.from(n);
	return [
		m[0] * a + m[2] * b,
		m[1] * a + m[3] * b,
		m[0] * c + m[2] * d,
		m[1] * c + m[3] * d,
		m[0] * e + m[2] * f + m[4],
		m[1] * e + m[3] * f + m[5],
	];
}

/** A PDF page's paths, with the page's optional content groups (`id → name, visible`). */
export function extractPdfPage(
	list: OperatorList,
	viewport: PageViewport,
	{
		OPS,
		groups = new Map(),
	}: {
		readonly OPS: PdfOps;
		readonly groups?: ReadonlyMap<string, { name: string; visible: boolean }>;
	},
): VectorContent {
	const builder = new VectorBuilder();
	let state: State = {
		ctm: multiply([1, 0, 0, 1, 0, 0], viewport.transform),
		stroke: "#000000",
		fill: "#000000",
		strokeAlpha: 1,
		fillAlpha: 1,
		width: 1,
		fontSize: 0,
		charSpacing: 0,
		wordSpacing: 0,
		hScale: 1,
		leading: 0,
		rise: 0,
		textMode: 0,
	};
	const saved: State[] = [];
	/** The text matrix and the matrix of the line's start. */
	let tm: Matrix = IDENTITY;
	let tlm: Matrix = IDENTITY;
	const lines = new Lines(builder);
	const moveText = (x: number, y: number) => {
		tlm = multiply(tlm, [1, 0, 0, 1, x, y]);
		tm = tlm;
	};
	/** The layer of each open marked content section: inner sections inherit it. */
	const layers: (string | null)[] = [];
	const strokes = new Set([
		OPS.stroke,
		OPS.closeStroke,
		OPS.fillStroke,
		OPS.eoFillStroke,
		OPS.closeFillStroke,
		OPS.closeEOFillStroke,
	]);
	const fills = new Set([
		OPS.fill,
		OPS.eoFill,
		OPS.fillStroke,
		OPS.eoFillStroke,
		OPS.closeFillStroke,
		OPS.closeEOFillStroke,
		OPS.rawFillPath,
	]);

	for (let i = 0; i < list.fnArray.length; i++) {
		const fn = list.fnArray[i];
		const args = (list.argsArray[i] ?? []) as unknown[];
		switch (fn) {
			case OPS.save:
				saved.push(state);
				state = { ...state };
				break;
			case OPS.restore:
				state = saved.pop() ?? state;
				break;
			case OPS.transform:
				state = { ...state, ctm: multiply(state.ctm, args as number[]) };
				break;
			case OPS.paintFormXObjectBegin: {
				saved.push(state);
				const matrix = args[0] as number[] | null;
				state = matrix
					? { ...state, ctm: multiply(state.ctm, matrix) }
					: { ...state };
				break;
			}
			case OPS.paintFormXObjectEnd:
				state = saved.pop() ?? state;
				break;
			case OPS.setLineWidth:
				state = { ...state, width: Number(args[0]) };
				break;
			case OPS.setGState:
				for (const [key, value] of args[0] as [string, unknown][]) {
					if (key === "LW") state = { ...state, width: Number(value) };
					else if (key === "CA")
						state = { ...state, strokeAlpha: Number(value) };
					else if (key === "ca") state = { ...state, fillAlpha: Number(value) };
				}
				break;
			case OPS.setStrokeRGBColor:
				state = { ...state, stroke: String(args[0]) };
				break;
			case OPS.setFillRGBColor:
				state = { ...state, fill: String(args[0]) };
				break;
			case OPS.setStrokeColorN:
				state = { ...state, stroke: PATTERN };
				break;
			case OPS.setFillColorN:
				state = { ...state, fill: PATTERN };
				break;
			case OPS.setStrokeTransparent:
				state = { ...state, stroke: null };
				break;
			case OPS.setFillTransparent:
				state = { ...state, fill: null };
				break;
			case OPS.beginMarkedContentProps: {
				const [tag, props] = args as [
					string,
					{ type?: string; id?: string; ids?: string[] } | null,
				];
				const layer =
					tag === "OC" && props
						? ((props.type === "OCG" ? props.id : props.ids?.[0]) ?? null)
						: (layers.at(-1) ?? null);
				layers.push(layer);
				break;
			}
			case OPS.beginMarkedContent:
				layers.push(layers.at(-1) ?? null);
				break;
			case OPS.endMarkedContent:
				layers.pop();
				break;
			case OPS.beginText:
				tm = IDENTITY;
				tlm = IDENTITY;
				break;
			case OPS.setTextMatrix:
				tm = multiply(IDENTITY, args[0] as ArrayLike<number>);
				tlm = tm;
				break;
			case OPS.moveText:
				moveText(Number(args[0]), Number(args[1]));
				break;
			case OPS.setLeadingMoveText:
				state = { ...state, leading: -Number(args[1]) };
				moveText(Number(args[0]), Number(args[1]));
				break;
			case OPS.nextLine:
				moveText(0, -state.leading);
				break;
			case OPS.setFont:
				state = { ...state, fontSize: Math.abs(Number(args[1])) };
				break;
			case OPS.setLeading:
				state = { ...state, leading: Number(args[0]) };
				break;
			case OPS.setCharSpacing:
				state = { ...state, charSpacing: Number(args[0]) };
				break;
			case OPS.setWordSpacing:
				state = { ...state, wordSpacing: Number(args[0]) };
				break;
			case OPS.setHScale:
				state = { ...state, hScale: Number(args[0]) / 100 };
				break;
			case OPS.setTextRise:
				state = { ...state, rise: Number(args[0]) };
				break;
			case OPS.setTextRenderingMode:
				state = { ...state, textMode: Number(args[0]) };
				break;
			case OPS.showText: {
				const advance = show(
					lines,
					args[0] as readonly (Glyph | number)[],
					state,
					multiply(state.ctm, tm),
					layers.at(-1) ?? null,
				);
				tm = multiply(tm, [1, 0, 0, 1, advance, 0]);
				break;
			}
			case OPS.constructPath: {
				const paint = args[0] as number;
				const data = (args[1] as ArrayLike<number>[] | undefined)?.[0];
				const stroked = strokes.has(paint) && state.stroke !== null;
				const filled = fills.has(paint) && state.fill !== null;
				if (!data || !(stroked || filled)) break;
				walk(builder, data, state.ctm);
				const layer = layers.at(-1) ?? null;
				if (filled) {
					builder.fill({
						color: rgba(state.fill ?? "", state.fillAlpha),
						width: 0,
						layer,
					});
				}
				if (stroked) {
					const [a, b, c, d] = state.ctm;
					builder.stroke({
						color: rgba(state.stroke ?? "", state.strokeAlpha),
						width: state.width * Math.sqrt(Math.abs(a * d - b * c)),
						layer,
					});
				}
				builder.clear();
				break;
			}
		}
	}
	lines.flush();
	return builder.build(
		{ width: viewport.width, height: viewport.height },
		groups,
	);
}

/** A capital's middle, above the baseline: half of a typical capital height. */
const MIDDLE = 0.35;

/**
 * Shows glyphs at the text rendering matrix `m` (the text matrix through the CTM) and gives
 * how far they move the text position, in text space.
 */
function show(
	lines: Lines,
	glyphs: readonly (Glyph | number)[],
	state: State,
	m: Matrix,
	layer: string | null,
): number {
	const { fontSize, charSpacing, wordSpacing, hScale } = state;
	let x = 0;
	let text = "";
	let start: number | null = null;
	let end = 0;
	for (const glyph of glyphs) {
		if (typeof glyph === "number") {
			x -= (glyph * fontSize) / 1000;
			continue;
		}
		const width = (glyph.width * fontSize) / 1000;
		const unicode = glyph.unicode ?? "";
		text += unicode;
		if (unicode.trim()) {
			start ??= x;
			end = x + width;
		}
		x += width + charSpacing + (glyph.isSpace ? wordSpacing : 0);
	}
	const shown = text.replace(/\s+/g, " ").trim();
	if (start !== null && shown && (state.textMode & 3) !== 3) {
		const at = (u: number): [number, number] => [
			m[0] * u * hScale + m[2] * state.rise + m[4],
			m[1] * u * hScale + m[3] * state.rise + m[5],
		];
		const up = Math.hypot(m[2], m[3]);
		lines.add({
			text: shown,
			start: at(start),
			end: at(end),
			size: fontSize * up,
			angle: (Math.atan2(m[1], m[0]) * 180) / Math.PI + 0,
			up: [m[2] / up, m[3] / up],
			layer,
		});
	}
	return x * hScale;
}

/** A line of text shown, its baseline from `start` to `end` in plan units. */
interface Run {
	readonly text: string;
	readonly start: readonly [number, number];
	readonly end: readonly [number, number];
	readonly size: number;
	readonly angle: number;
	/** The text's up, a unit vector. */
	readonly up: readonly [number, number];
	readonly layer: string | null;
}

/**
 * Joins the pieces of a line shown one after another (a word, a subscript, a CAD label's
 * parts) into one text: a piece in the same layer and direction that starts on the last
 * one's baseline, between half an em back and JOIN_GAP ems on from its end.
 */
class Lines {
	readonly #builder: VectorBuilder;
	#run: Run | null = null;

	constructor(builder: VectorBuilder) {
		this.#builder = builder;
	}

	add(run: Run): void {
		const last = this.#run;
		if (last && this.#joins(last, run)) {
			const em = Math.max(last.size, run.size);
			const gap = this.#along(last, run);
			this.#run = {
				...last,
				text: last.text + (gap > SPACE_GAP * em ? " " : "") + run.text,
				end: run.end,
				size: em,
			};
			return;
		}
		this.flush();
		this.#run = run;
	}

	flush(): void {
		const run = this.#run;
		if (!run) return;
		const lift = MIDDLE * run.size;
		const text: PaintText = {
			text: run.text,
			x: (run.start[0] + run.end[0]) / 2 + run.up[0] * lift,
			y: (run.start[1] + run.end[1]) / 2 + run.up[1] * lift,
			size: run.size,
			angle: run.angle,
			layer: run.layer,
		};
		this.#builder.text(text);
		this.#run = null;
	}

	#joins(last: Run, run: Run): boolean {
		if (last.layer !== run.layer || Math.abs(last.angle - run.angle) > 1)
			return false;
		const em = Math.max(last.size, run.size);
		const gap = this.#along(last, run);
		// Off the baseline: the distance along the text's up.
		const dx = run.start[0] - last.end[0];
		const dy = run.start[1] - last.end[1];
		const off = Math.abs(dx * last.up[0] + dy * last.up[1]);
		return (
			off < BASELINE_SLACK * em && gap >= -0.5 * em && gap <= JOIN_GAP * em
		);
	}

	/** How far on from the last piece's end the next one starts, along the line. */
	#along(last: Run, run: Run): number {
		const radians = (last.angle * Math.PI) / 180;
		return (
			(run.start[0] - last.end[0]) * Math.cos(radians) +
			(run.start[1] - last.end[1]) * Math.sin(radians)
		);
	}
}

/** Pieces further apart than this, in ems, are separate texts. */
const JOIN_GAP = 0.6;
/** Pieces further apart than this, in ems, get a space between them. */
const SPACE_GAP = 0.15;
/** How far off the line, in ems, a piece can start and still join it. */
const BASELINE_SLACK = 0.25;

/** Feeds pdf.js path data to the builder, placed by `m`. */
function walk(
	builder: VectorBuilder,
	data: ArrayLike<number>,
	m: Matrix,
): void {
	const x = (u: number, v: number) => m[0] * u + m[2] * v + m[4];
	const y = (u: number, v: number) => m[1] * u + m[3] * v + m[5];
	const at = (k: number) => data[k] ?? 0;
	for (let k = 0; k < data.length; ) {
		switch (data[k++]) {
			case MOVE:
				builder.moveTo(x(at(k), at(k + 1)), y(at(k), at(k + 1)));
				k += 2;
				break;
			case LINE:
				builder.lineTo(x(at(k), at(k + 1)), y(at(k), at(k + 1)));
				k += 2;
				break;
			case CUBIC:
				builder.cubicTo(
					x(at(k), at(k + 1)),
					y(at(k), at(k + 1)),
					x(at(k + 2), at(k + 3)),
					y(at(k + 2), at(k + 3)),
					x(at(k + 4), at(k + 5)),
					y(at(k + 4), at(k + 5)),
				);
				k += 6;
				break;
			case QUAD:
				builder.quadTo(
					x(at(k), at(k + 1)),
					y(at(k), at(k + 1)),
					x(at(k + 2), at(k + 3)),
					y(at(k + 2), at(k + 3)),
				);
				k += 4;
				break;
			case CLOSE:
				builder.close();
				break;
			default:
				return;
		}
	}
}
