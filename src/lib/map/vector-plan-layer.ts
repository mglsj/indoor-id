/**
 * A vector floor plan on the map: a MapLibre custom layer drawing the plan's fills as
 * triangles, then its segments as quads widened on screen (hairlines one device pixel, other
 * lines their width in plan units). The geometry is uploaded once, in plan units; moving the
 * plan or the camera only changes the matrix, composed in float64 each frame (`plan-matrix.ts`).
 */
import type { Transform } from "#lib/floorplans/georef.ts";
import type { VectorContent } from "#lib/floorplans/vector.ts";
import type {
	CustomLayerInterface,
	CustomRenderMethodInput,
	Map as MapLibreMap,
} from "./maplibre.ts";
import { planToClip, unitPixels } from "./plan-matrix.ts";

const LINE_VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_unit;
in vec2 a_corner;
in vec2 a_from;
in vec2 a_to;
in vec4 a_color;
in float a_width;
out vec4 v_color;
void main() {
	vec2 half_view = u_viewport * 0.5;
	vec4 c0 = u_matrix * vec4(a_from, 0.0, 1.0);
	vec4 c1 = u_matrix * vec4(a_to, 0.0, 1.0);
	vec2 s0 = c0.xy / c0.w * half_view;
	vec2 s1 = c1.xy / c1.w * half_view;
	vec2 d = s1 - s0;
	float len = length(d);
	vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
	float width = max(1.0, a_width * u_unit);
	vec2 s = mix(s0, s1, a_corner.x) + vec2(-dir.y, dir.x) * a_corner.y * width * 0.5;
	gl_Position = vec4(s / half_view, 0.0, 1.0);
	v_color = a_color;
}`;

const FILL_VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
in vec2 a_position;
in vec4 a_color;
out vec4 v_color;
void main() {
	gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
	v_color = a_color;
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform float u_opacity;
in vec4 v_color;
out vec4 color;
void main() {
	float alpha = v_color.a * u_opacity;
	color = vec4(v_color.rgb * alpha, alpha);
}`;

interface Program {
	readonly program: WebGLProgram;
	readonly uniforms: Record<string, WebGLUniformLocation | null>;
	readonly attributes: Record<string, number>;
}

interface Buffers {
	readonly lines: WebGLVertexArrayObject;
	readonly fills: WebGLVertexArrayObject;
	readonly owned: WebGLBuffer[];
	/** Each segment's and each fill vertex's colour, rewritten when layers are hidden. */
	readonly lineColors: WebGLBuffer;
	readonly fillColors: WebGLBuffer;
	readonly segments: number;
	readonly vertices: number;
}

export class VectorPlanLayer implements CustomLayerInterface {
	readonly type = "custom";
	readonly renderingMode = "2d";
	readonly id: string;
	#content: VectorContent;
	#transform: Transform;
	#opacity: number;
	#hidden: ReadonlySet<string>;
	#map: MapLibreMap | undefined;
	#gl: WebGL2RenderingContext | undefined;
	#lineProgram: Program | undefined;
	#fillProgram: Program | undefined;
	#buffers: Buffers | undefined;

	constructor(
		id: string,
		content: VectorContent,
		transform: Transform,
		opacity: number,
		hidden: ReadonlySet<string> = new Set(),
	) {
		this.id = id;
		this.#content = content;
		this.#transform = transform;
		this.#opacity = opacity;
		this.#hidden = hidden;
	}

	setTransform(transform: Transform): void {
		this.#transform = transform;
		this.#map?.triggerRepaint();
	}

	setOpacity(opacity: number): void {
		this.#opacity = opacity;
		this.#map?.triggerRepaint();
	}

	/** Leaves out the paths of these CAD layers (by id). */
	setHiddenLayers(hidden: ReadonlySet<string>): void {
		this.#hidden = hidden;
		const gl = this.#gl;
		const buffers = this.#buffers;
		if (!gl || !buffers) return;
		const content = this.#content;
		const shown = shownStyles(content, hidden);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lineColors);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			colorsOf(content, content.segmentStyles, 1, shown),
			gl.STATIC_DRAW,
		);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffers.fillColors);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			colorsOf(content, content.triangleStyles, 3, shown),
			gl.STATIC_DRAW,
		);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		this.#map?.triggerRepaint();
	}

	onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
		this.#map = map;
		this.#gl = gl;
		this.#lineProgram = program(
			gl,
			LINE_VERTEX,
			["u_matrix", "u_viewport", "u_unit", "u_opacity"],
			["a_corner", "a_from", "a_to", "a_color", "a_width"],
		);
		this.#fillProgram = program(
			gl,
			FILL_VERTEX,
			["u_matrix", "u_opacity"],
			["a_position", "a_color"],
		);
		this.#buffers = upload(
			gl,
			this.#content,
			this.#lineProgram,
			this.#fillProgram,
			shownStyles(this.#content, this.#hidden),
		);
	}

	onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
		const buffers = this.#buffers;
		if (buffers) {
			gl.deleteVertexArray(buffers.lines);
			gl.deleteVertexArray(buffers.fills);
			for (const buffer of buffers.owned) gl.deleteBuffer(buffer);
		}
		for (const p of [this.#lineProgram, this.#fillProgram]) {
			if (p) gl.deleteProgram(p.program);
		}
		this.#buffers = undefined;
		this.#map = undefined;
		this.#gl = undefined;
	}

	render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
		const map = this.#map;
		const buffers = this.#buffers;
		const lines = this.#lineProgram;
		const fills = this.#fillProgram;
		if (!map || !buffers || !lines || !fills) return;
		const matrix = planToClip(
			this.#transform,
			options.modelViewProjectionMatrix,
			512 * 2 ** map.getZoom(),
		);
		const viewport = {
			width: gl.drawingBufferWidth,
			height: gl.drawingBufferHeight,
		};
		const { width, height } = this.#content.size;
		const unit = unitPixels(matrix, viewport, [width / 2, height / 2]);
		const m32 = Float32Array.from(matrix);

		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

		if (buffers.vertices > 0) {
			gl.useProgram(fills.program);
			gl.uniformMatrix4fv(fills.uniforms.u_matrix ?? null, false, m32);
			gl.uniform1f(fills.uniforms.u_opacity ?? null, this.#opacity);
			gl.bindVertexArray(buffers.fills);
			gl.drawArrays(gl.TRIANGLES, 0, buffers.vertices);
		}
		if (buffers.segments > 0) {
			gl.useProgram(lines.program);
			gl.uniformMatrix4fv(lines.uniforms.u_matrix ?? null, false, m32);
			gl.uniform2f(
				lines.uniforms.u_viewport ?? null,
				viewport.width,
				viewport.height,
			);
			gl.uniform1f(lines.uniforms.u_unit ?? null, unit);
			gl.uniform1f(lines.uniforms.u_opacity ?? null, this.#opacity);
			gl.bindVertexArray(buffers.lines);
			gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, buffers.segments);
		}
		gl.bindVertexArray(null);
	}
}

function program(
	gl: WebGL2RenderingContext,
	vertexSource: string,
	uniformNames: readonly string[],
	attributeNames: readonly string[],
): Program {
	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type);
		if (!shader) throw new Error("No WebGL shader");
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			throw new Error(
				gl.getShaderInfoLog(shader) ?? "Shader failed to compile",
			);
		}
		return shader;
	};
	const p = gl.createProgram();
	gl.attachShader(p, compile(gl.VERTEX_SHADER, vertexSource));
	gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FRAGMENT));
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
		throw new Error(gl.getProgramInfoLog(p) ?? "Program failed to link");
	}
	return {
		program: p,
		uniforms: Object.fromEntries(
			uniformNames.map((n) => [n, gl.getUniformLocation(p, n)]),
		),
		attributes: Object.fromEntries(
			attributeNames.map((n) => [n, gl.getAttribLocation(p, n)]),
		),
	};
}

/** Whether each style shows: not in a hidden layer. */
function shownStyles(
	content: VectorContent,
	hidden: ReadonlySet<string>,
): boolean[] {
	return content.styles.map(
		({ layer }) => layer < 0 || !hidden.has(content.layers[layer]?.id ?? ""),
	);
}

const CLEAR = [0, 0, 0, 0] as const;

/** Each element's colour by its style (RGBA bytes); clear for hidden styles. */
function colorsOf(
	content: VectorContent,
	styles: Uint32Array,
	repeat: number,
	shown: readonly boolean[],
): Uint8Array {
	const out = new Uint8Array(styles.length * repeat * 4);
	for (let i = 0; i < styles.length; i++) {
		const style = styles[i] ?? 0;
		const color = shown[style]
			? (content.styles[style]?.color ?? [0, 0, 0, 255])
			: CLEAR;
		for (let r = 0; r < repeat; r++) out.set(color, (i * repeat + r) * 4);
	}
	return out;
}

function upload(
	gl: WebGL2RenderingContext,
	content: VectorContent,
	lines: Program,
	fills: Program,
	shown: readonly boolean[],
): Buffers {
	const owned: WebGLBuffer[] = [];
	const buffer = (data: AllowSharedBufferSource) => {
		const b = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, b);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
		owned.push(b);
		return b;
	};
	const attribute = (
		location: number | undefined,
		size: number,
		type: number,
		normalized: boolean,
		stride: number,
		offset: number,
		divisor: number,
	) => {
		if (location === undefined || location < 0) return;
		gl.enableVertexAttribArray(location);
		gl.vertexAttribPointer(location, size, type, normalized, stride, offset);
		gl.vertexAttribDivisor(location, divisor);
	};

	const segments = content.segments.length / 4;
	const lineArray = gl.createVertexArray();
	gl.bindVertexArray(lineArray);
	buffer(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]));
	attribute(lines.attributes.a_corner, 2, gl.FLOAT, false, 0, 0, 0);
	buffer(content.segments);
	attribute(lines.attributes.a_from, 2, gl.FLOAT, false, 16, 0, 1);
	attribute(lines.attributes.a_to, 2, gl.FLOAT, false, 16, 8, 1);
	const lineColors = buffer(colorsOf(content, content.segmentStyles, 1, shown));
	attribute(lines.attributes.a_color, 4, gl.UNSIGNED_BYTE, true, 0, 0, 1);
	const widths = new Float32Array(segments);
	content.segmentStyles.forEach((style, i) => {
		widths[i] = content.styles[style]?.width ?? 0;
	});
	buffer(widths);
	attribute(lines.attributes.a_width, 1, gl.FLOAT, false, 0, 0, 1);

	const vertices = content.triangles.length / 2;
	const fillArray = gl.createVertexArray();
	gl.bindVertexArray(fillArray);
	buffer(content.triangles);
	attribute(fills.attributes.a_position, 2, gl.FLOAT, false, 0, 0, 0);
	const fillColors = buffer(
		colorsOf(content, content.triangleStyles, 3, shown),
	);
	attribute(fills.attributes.a_color, 4, gl.UNSIGNED_BYTE, true, 0, 0, 0);

	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	return {
		lines: lineArray,
		fills: fillArray,
		owned,
		lineColors,
		fillColors,
		segments,
		vertices,
	};
}
