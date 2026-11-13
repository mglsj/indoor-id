/**
 * Raster imagery drawn by a MapLibre custom layer, so that it can be moved by an offset as iD
 * moves its imagery: each frame draws the loaded tiles shifted by the offset, so a drag in the
 * background pane only changes a uniform and the map follows the pointer at once. MapLibre's
 * raster layers can't be translated: moving one meant asking for every tile again.
 *
 * Tiles are fetched as MapLibre would (256 px, the zoom above the map's), at most a few at a
 * time and those in view first. A tile not loaded yet, or missing (404, past the imagery's
 * last zoom), is drawn from its nearest loaded ancestor, scaled up. Brightness, contrast and
 * saturation are applied as MapLibre's raster shader applies them.
 *
 * WebGL may only read tiles a server allows with `Access-Control-Allow-Origin`. When a tile
 * can't be fetched but loads as a plain `<img>` (a server without CORS, as many local and WMS
 * servers are), the layer draws its tiles as images behind the map's canvas instead, as iD
 * does (`imagery-dom.ts`), and `behind` turns true: the basemap must then be hidden for them to
 * show.
 */
import {
	displayPaint,
	type Imagery,
	type ImageryDisplay,
	inAncestor,
	NO_OFFSET,
	type Offset,
	offsetPixels,
	PLAIN_DISPLAY,
	tilesIn,
	tileUrl,
	type ViewTile,
} from "./backgrounds.ts";
import {
	displayFilter,
	imageContainer,
	loadImage,
	placement,
	prepareImage,
} from "./imagery-dom.ts";
import type {
	CustomLayerInterface,
	CustomRenderMethodInput,
	Map as MapLibreMap,
} from "./maplibre.ts";

/** Fetches running at once. */
const MAX_FETCHES = 8;
/** Textures kept on the GPU (256 px, 256 KiB each with mipmaps about 340). */
const MAX_TEXTURES = 384;
/** Ancestors looked through for a tile not loaded. */
const MAX_ANCESTORS = 10;
/** A tile that failed (not a 404) is asked again after this many ms. */
const RETRY_AFTER = 10_000;
/** Tiles drawn at most: past this, a lower zoom is drawn (a pitched view's horizon). */
const MAX_TILES = 300;

const VERTEX = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec4 u_uv;
in vec2 a_corner;
out vec2 v_uv;
void main() {
	gl_Position = u_matrix * vec4(a_corner, 0.0, 1.0);
	v_uv = u_uv.xy + a_corner * u_uv.zw;
}`;

/** MapLibre's raster fragment shader (`raster.fragment.glsl`) for one tile, no fade or spin. */
const FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D u_image;
uniform float u_brightness_low;
uniform float u_brightness_high;
uniform float u_saturation_factor;
uniform float u_contrast_factor;
in vec2 v_uv;
out vec4 fragColor;
void main() {
	vec4 color = texture(u_image, v_uv);
	if (color.a > 0.0) color.rgb = color.rgb / color.a;
	vec3 rgb = color.rgb;
	float average = (color.r + color.g + color.b) / 3.0;
	rgb += (average - rgb) * u_saturation_factor;
	rgb = (rgb - 0.5) * u_contrast_factor + 0.5;
	vec3 high = vec3(u_brightness_low);
	vec3 low = vec3(u_brightness_high);
	fragColor = vec4(mix(high, low, rgb) * color.a, color.a);
}`;

type TileState =
	| { readonly kind: "loading" }
	| { readonly kind: "missing" }
	| { readonly kind: "failed"; readonly at: number }
	| { readonly kind: "loaded"; readonly texture: WebGLTexture }
	| { readonly kind: "image"; readonly image: HTMLImageElement };

/** A loaded tile: a texture, or an image when the imagery is drawn behind the canvas. */
type Drawable = WebGLTexture | HTMLImageElement;

export class ImageryLayer implements CustomLayerInterface {
	readonly id: string;
	readonly type = "custom" as const;
	readonly renderingMode = "2d" as const;

	readonly #imagery: Imagery;
	#offset: Offset = NO_OFFSET;
	#display: ImageryDisplay = PLAIN_DISPLAY;
	#map: MapLibreMap | undefined;
	#gl: WebGL2RenderingContext | undefined;
	#program: WebGLProgram | undefined;
	#uniforms: Record<string, WebGLUniformLocation | null> = {};
	#quad: WebGLVertexArrayObject | undefined;
	#buffer: WebGLBuffer | undefined;
	/** Tiles by `z/x/y`, most recently drawn last. */
	readonly #tiles = new Map<string, TileState>();
	/** Tiles waiting to be fetched, by key: replaced each frame by the ones still wanted. */
	#queue: { key: string; z: number; x: number; y: number }[] = [];
	#fetching = 0;
	#textures = 0;
	/** Set once a tile loads only without CORS: tiles are images behind the canvas from then. */
	#container: HTMLDivElement | undefined;
	/** Images placed in the container, by where they are placed. */
	readonly #placed = new Map<string, HTMLImageElement>();
	readonly #onbehind: (() => void) | undefined;

	/** `onbehind` is called when the imagery starts being drawn behind the canvas. */
	constructor(id: string, imagery: Imagery, onbehind?: () => void) {
		this.id = id;
		this.#imagery = imagery;
		this.#onbehind = onbehind;
	}

	/** Whether the tiles are images behind the map's canvas (a server without CORS). */
	get behind(): boolean {
		return this.#container !== undefined;
	}

	get imagery(): Imagery {
		return this.#imagery;
	}

	/** Moves the imagery: drawn moved on the next frame, nothing is fetched again. */
	setOffset(offset: Offset): void {
		if (
			offset.east === this.#offset.east &&
			offset.north === this.#offset.north
		) {
			return;
		}
		this.#offset = offset;
		this.#map?.triggerRepaint();
	}

	setDisplay(display: ImageryDisplay): void {
		this.#display = display;
		if (this.#container) this.#container.style.filter = displayFilter(display);
		this.#map?.triggerRepaint();
	}

	/** Whether every tile in view is drawn at its own zoom (or known to be missing). */
	get complete(): boolean {
		return this.#complete;
	}
	#complete = false;

	onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): void {
		this.#map = map;
		this.#gl = gl;
		const program = compile(gl);
		this.#program = program;
		for (const name of [
			"u_matrix",
			"u_uv",
			"u_image",
			"u_brightness_low",
			"u_brightness_high",
			"u_saturation_factor",
			"u_contrast_factor",
		]) {
			this.#uniforms[name] = gl.getUniformLocation(program, name);
		}
		const quad = gl.createVertexArray();
		const buffer = gl.createBuffer();
		gl.bindVertexArray(quad);
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
			gl.STATIC_DRAW,
		);
		const corner = gl.getAttribLocation(program, "a_corner");
		gl.enableVertexAttribArray(corner);
		gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
		gl.bindVertexArray(null);
		this.#quad = quad;
		this.#buffer = buffer;
	}

	onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext): void {
		for (const state of this.#tiles.values()) {
			if (state.kind === "loaded") gl.deleteTexture(state.texture);
		}
		this.#tiles.clear();
		this.#container?.remove();
		this.#placed.clear();
		this.#queue = [];
		if (this.#quad) gl.deleteVertexArray(this.#quad);
		if (this.#buffer) gl.deleteBuffer(this.#buffer);
		if (this.#program) gl.deleteProgram(this.#program);
		this.#map = undefined;
		this.#gl = undefined;
	}

	render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
		const map = this.#map;
		const program = this.#program;
		if (!map || !program || !this.#quad) return;
		const source = this.#imagery.source;
		const minzoom = source.minzoom ?? 0;
		const maxzoom = source.maxzoom ?? 22;
		const zoom = map.getZoom();
		// MapLibre's zoom counts 512 px tiles: 256 px tiles come from the zoom above.
		let z = Math.max(minzoom, Math.min(maxzoom, Math.floor(zoom + 1)));
		const bounds = map.getBounds();
		const box = {
			west: bounds.getWest(),
			south: bounds.getSouth(),
			east: bounds.getEast(),
			north: bounds.getNorth(),
		};
		let view = tilesIn(box, z);
		while (view.length > MAX_TILES && z > minzoom) view = tilesIn(box, --z);

		const worldSize = 512 * 2 ** zoom;
		const [dx, dy] = offsetPixels(this.#offset, map.getCenter().lat, worldSize);
		const mvp = options.modelViewProjectionMatrix;
		const paint = displayPaint(this.#display);

		gl.useProgram(program);
		gl.bindVertexArray(this.#quad);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.activeTexture(gl.TEXTURE0);
		gl.uniform1i(this.#uniforms.u_image ?? null, 0);
		gl.uniform1f(
			this.#uniforms.u_brightness_low ?? null,
			paint["raster-brightness-min"],
		);
		gl.uniform1f(
			this.#uniforms.u_brightness_high ?? null,
			paint["raster-brightness-max"],
		);
		gl.uniform1f(
			this.#uniforms.u_saturation_factor ?? null,
			saturationFactor(paint["raster-saturation"]),
		);
		gl.uniform1f(
			this.#uniforms.u_contrast_factor ?? null,
			contrastFactor(paint["raster-contrast"]),
		);

		const wanted: { key: string; z: number; x: number; y: number }[] = [];
		let complete = true;
		const images: Placed[] = [];
		for (const tile of view) {
			const drawn = this.#find(tile, minzoom, wanted);
			if (!drawn) {
				complete = false;
				continue;
			}
			if (!drawn.exact) complete = false;
			if (!drawn.texture) continue;
			const size = worldSize / 2 ** tile.z;
			if (drawn.texture instanceof HTMLImageElement) {
				// The whole ancestor is placed once, under the tiles of higher zooms.
				const full = size / drawn.size;
				const left = tile.x * size + dx - drawn.left * full;
				const top = tile.y * size + dy - drawn.top * full;
				images.push({
					image: drawn.texture,
					key: `${drawn.z}/${Math.round((tile.x * size - drawn.left * full) / full)}/${drawn.y}`,
					z: drawn.z,
					left,
					top,
					size: full,
				});
				continue;
			}
			gl.uniformMatrix4fv(
				this.#uniforms.u_matrix ?? null,
				false,
				tileMatrix(mvp, tile.x * size + dx, tile.y * size + dy, size),
			);
			gl.uniform4f(
				this.#uniforms.u_uv ?? null,
				drawn.left,
				drawn.top,
				drawn.size,
				drawn.size,
			);
			gl.bindTexture(gl.TEXTURE_2D, drawn.texture);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		}
		gl.bindVertexArray(null);
		if (this.#container) this.#place(images, mvp);
		this.#complete = complete;
		this.#queue = wanted;
		this.#pump();
	}

	/**
	 * The texture to draw `tile` with: its own or its nearest loaded ancestor's, with the part of
	 * it to draw. Tiles to fetch for it are added to `wanted`.
	 */
	#find(
		tile: ViewTile,
		minzoom: number,
		wanted: { key: string; z: number; x: number; y: number }[],
	): {
		texture: Drawable | null;
		exact: boolean;
		z: number;
		y: number;
		left: number;
		top: number;
		size: number;
	} | null {
		// Whether every zoom tried so far is missing: only then is the next one up fetched.
		let belowMissing = true;
		const lowest = Math.max(minzoom, tile.z - MAX_ANCESTORS);
		for (let az = tile.z; az >= lowest; az--) {
			const at = inAncestor(tile.z, tile.column, tile.y, az);
			const key = `${az}/${at.x}/${at.y}`;
			const state = this.#tiles.get(key);
			if (state?.kind === "loaded" || state?.kind === "image") {
				// Most recently drawn last, for eviction.
				this.#tiles.delete(key);
				this.#tiles.set(key, state);
				return {
					texture: state.kind === "loaded" ? state.texture : state.image,
					exact: belowMissing,
					z: az,
					y: at.y,
					left: at.left,
					top: at.top,
					size: at.size,
				};
			}
			if (state?.kind === "missing") continue;
			const retry =
				state?.kind === "failed" && Date.now() - state.at > RETRY_AFTER;
			if ((!state || retry) && belowMissing) {
				wanted.push({ key, z: az, x: at.x, y: at.y });
			}
			// Loading, failed or wanted: keep looking for a loaded ancestor to draw meanwhile.
			belowMissing = false;
		}
		// Missing at every zoom: nothing to draw, and nothing more to fetch.
		return belowMissing
			? {
					texture: null,
					exact: true,
					z: tile.z,
					y: tile.y,
					left: 0,
					top: 0,
					size: 1,
				}
			: null;
	}

	/** Starts fetches from the queue, up to `MAX_FETCHES` at once. */
	#pump(): void {
		while (this.#fetching < MAX_FETCHES && this.#queue.length > 0) {
			const next = this.#queue.shift();
			if (!next) return;
			const state = this.#tiles.get(next.key);
			if (state && state.kind !== "failed") continue;
			this.#load(next);
		}
	}

	#load({ key, z, x, y }: { key: string; z: number; x: number; y: number }) {
		this.#tiles.set(key, { kind: "loading" });
		this.#fetching++;
		const url = tileUrl(this.#imagery.source, z, x, y);
		void this.#loadTile(url).then((result) => {
			this.#fetching--;
			const gl = this.#gl;
			if (!gl || !this.#map) {
				if (result instanceof ImageBitmap) result.close();
				return;
			}
			if (result === "missing") {
				this.#tiles.set(key, { kind: "missing" });
			} else if (result === "failed") {
				this.#tiles.set(key, { kind: "failed", at: Date.now() });
			} else if (result instanceof HTMLImageElement) {
				this.#behind();
				this.#tiles.set(key, { kind: "image", image: prepareImage(result) });
				this.#textures++;
				this.#evict(gl);
			} else if (this.#container) {
				// Drawn behind the canvas now: a texture would not be drawn.
				result.close();
				this.#tiles.delete(key);
			} else {
				this.#tiles.set(key, { kind: "loaded", texture: upload(gl, result) });
				result.close();
				this.#textures++;
				this.#evict(gl);
			}
			this.#map.triggerRepaint();
		});
	}

	/**
	 * A tile as a bitmap for WebGL, or, behind the canvas or when the server refuses CORS, as an
	 * image loaded without it. Behind the canvas, an image that doesn't load is missing: an
	 * `<img>` can't tell a 404 from other errors, and a tile server's errors are mostly zooms
	 * it has no tiles at (iD shows nothing there either).
	 */
	async #loadTile(
		url: string,
	): Promise<ImageBitmap | HTMLImageElement | "missing" | "failed"> {
		if (!this.#container) {
			const result = await fetchTile(url);
			if (result !== "blocked") return result;
		}
		try {
			return await loadImage(url);
		} catch {
			return this.#container ? "missing" : "failed";
		}
	}

	/** Draws the tiles as images behind the canvas from now on. */
	#behind(): void {
		const map = this.#map;
		const gl = this.#gl;
		if (this.#container || !map || !gl) return;
		this.#container = imageContainer(map.getCanvas());
		this.#container.style.filter = displayFilter(this.#display);
		// Textures loaded before are not drawn any more: those tiles are loaded again.
		for (const [key, state] of this.#tiles) {
			if (state.kind !== "loaded") continue;
			gl.deleteTexture(state.texture);
			this.#tiles.delete(key);
			this.#textures--;
		}
		this.#onbehind?.();
	}

	/** Places this frame's images in the container, lower zooms under higher ones. */
	#place(images: Placed[], mvp: ArrayLike<number>): void {
		const container = this.#container;
		const canvas = this.#map?.getCanvas();
		if (!container || !canvas) return;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		const shown = new Map<string, HTMLImageElement>();
		for (const placed of images) {
			if (shown.has(placed.key)) continue;
			let element = this.#placed.get(placed.key);
			if (
				!element ||
				element.src !== placed.image.src ||
				[...shown.values()].includes(element)
			) {
				// The tile's own image, or a copy when it is already placed elsewhere (a copy of
				// the world east or west).
				element = [...shown.values(), ...this.#placed.values()].includes(
					placed.image,
				)
					? prepareImage(placed.image.cloneNode() as HTMLImageElement)
					: placed.image;
			}
			element.style.transform = placement(
				mvp,
				placed.left,
				placed.top,
				placed.size,
				width,
				height,
			);
			element.style.zIndex = String(placed.z);
			shown.set(placed.key, element);
			if (element.parentElement !== container) container.append(element);
		}
		for (const [key, element] of this.#placed) {
			if (shown.get(key) !== element) element.remove();
		}
		this.#placed.clear();
		for (const [key, element] of shown) this.#placed.set(key, element);
	}

	/** Deletes the least recently drawn textures (or images) past `MAX_TEXTURES`. */
	#evict(gl: WebGL2RenderingContext): void {
		for (const [key, state] of this.#tiles) {
			if (this.#textures <= MAX_TEXTURES) return;
			if (state.kind === "image") {
				state.image.remove();
			} else if (state.kind === "loaded") {
				gl.deleteTexture(state.texture);
			} else {
				continue;
			}
			this.#tiles.delete(key);
			this.#textures--;
		}
	}
}

/** An image placed behind the canvas this frame: a whole tile, at `left`, `top`, `size`. */
interface Placed {
	readonly image: HTMLImageElement;
	/** The tile and copy of the world it is placed on. */
	readonly key: string;
	readonly z: number;
	readonly left: number;
	readonly top: number;
	readonly size: number;
}

/**
 * A tile's image, or why there is none: a 404 is missing, a request that never got an answer
 * it may read (the server refused CORS, or is down) is blocked, anything else failed.
 */
async function fetchTile(
	url: string,
): Promise<ImageBitmap | "missing" | "failed" | "blocked"> {
	let response: Response;
	try {
		response = await fetch(url);
	} catch {
		return "blocked";
	}
	try {
		if (response.status === 404) return "missing";
		if (!response.ok) return "failed";
		return await createImageBitmap(await response.blob(), {
			premultiplyAlpha: "none",
		});
	} catch {
		return "failed";
	}
}

function upload(gl: WebGL2RenderingContext, image: ImageBitmap): WebGLTexture {
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
	const square =
		image.width === image.height && (image.width & (image.width - 1)) === 0;
	if (square) gl.generateMipmap(gl.TEXTURE_2D);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_MIN_FILTER,
		square ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
	);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return texture;
}

/**
 * A tile's corners (`[0..1]²`) to clip space: MapLibre's world-pixel matrix (column-major)
 * after placing the tile at `left`, `top`, `size` world pixels. Composed in float64, so that
 * the float32 result stays precise at any zoom.
 */
function tileMatrix(
	mvp: ArrayLike<number>,
	left: number,
	top: number,
	size: number,
): Float32Array {
	const m = (i: number) => mvp[i] ?? 0;
	const out = new Float32Array(16);
	for (let row = 0; row < 4; row++) {
		out[row] = m(row) * size;
		out[4 + row] = m(4 + row) * size;
		out[8 + row] = m(8 + row);
		out[12 + row] = m(row) * left + m(4 + row) * top + m(12 + row);
	}
	return out;
}

/** As MapLibre's `raster_program.ts`. */
function contrastFactor(contrast: number): number {
	return contrast > 0 ? 1 / (1 - contrast) : 1 + contrast;
}

function saturationFactor(saturation: number): number {
	return saturation > 0 ? 1 - 1 / (1.001 - saturation) : -saturation;
}

function compile(gl: WebGL2RenderingContext): WebGLProgram {
	const shader = (type: number, source: string) => {
		const s = gl.createShader(type);
		if (!s) throw new Error("No WebGL shader");
		gl.shaderSource(s, source);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
			throw new Error(gl.getShaderInfoLog(s) ?? "Shader failed to compile");
		}
		return s;
	};
	const program = gl.createProgram();
	gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
	gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		throw new Error(gl.getProgramInfoLog(program) ?? "Program failed to link");
	}
	return program;
}
