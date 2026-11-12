/**
 * Colours of indoor features, after the OsmInEdit stylesheet: neutral greys for spaces, dark walls,
 * blue for stairs and elevators, green for doors. Fills stay translucent so floor plans and
 * imagery underneath remain visible.
 */
export const INDOOR_COLORS = {
	building: "#ffffff",
	area: "#e6e6e6",
	space: "#eeeeee",
	room: "#d6d1c7",
	restricted: "#a9a49b",
	vertical: "#aebdda",
	column: "#999999",
	wall: "#444444",
	softOutline: "#aaaaaa",
	verticalOutline: "#7495da",
	path: "#8ebeff",
	door: "#00ab0d",
	doorStroke: "#003f05",
	passage: "#eeeeee",
	passageStroke: "#aaaaaa",
	line: "#9e9e9e",
	point: "#757575",
	pointStroke: "#ffffff",
	text: "#333333",
	selection: "#f59e0b",
	/** Snap guides and markers (C.1). */
	guide: "#d946ef",
	textHalo: "rgba(255, 255, 255, 0.8)",
} as const;

export type IndoorColors = {
	readonly [K in keyof typeof INDOOR_COLORS]: string;
};

/**
 * The same roles for a dark basemap (V.1): dark fills that keep rooms lighter than corridors
 * and areas, light walls and text, the same hues for stairs, paths and doors.
 */
export const DARK_INDOOR_COLORS: IndoorColors = {
	building: "#1c2128",
	area: "#2b3038",
	space: "#30363f",
	room: "#4a463f",
	restricted: "#6a645a",
	vertical: "#34476b",
	column: "#7a7a7a",
	wall: "#d4d4d4",
	softOutline: "#5f6672",
	verticalOutline: "#7c9fe6",
	path: "#5d8fd6",
	door: "#22b232",
	doorStroke: "#b7f5bd",
	passage: "#30363f",
	passageStroke: "#5f6672",
	line: "#8b8b8b",
	point: "#c4c4c4",
	pointStroke: "#111111",
	text: "#eeeeee",
	selection: "#f59e0b",
	/** Snap guides and markers (C.1). */
	guide: "#d946ef",
	textHalo: "rgba(0, 0, 0, 0.75)",
};

export type Theme = "light" | "dark";

/** The indoor colours for a light or dark map. */
export function indoorColors(theme: Theme): IndoorColors {
	return theme === "dark" ? DARK_INDOOR_COLORS : INDOOR_COLORS;
}

/**
 * Fills of rooms by use in the viewer (V.3, `view/room-use.ts`): soft hues that keep labels
 * readable, each with a darker set for dark maps.
 */
export const USE_COLORS = {
	light: {
		food: "#f3c98b",
		shop: "#eeb0a6",
		toilets: "#a9c9ef",
		health: "#f2a0a8",
		education: "#c9b6e8",
		office: "#bcd6b4",
		worship: "#e6d29a",
		service: "#d9cdb8",
		platform: "#c9d2d8",
	},
	dark: {
		food: "#7a5a2c",
		shop: "#74443d",
		toilets: "#34557a",
		health: "#733a42",
		education: "#53457a",
		office: "#3f5a39",
		worship: "#6b5d2c",
		service: "#5a5246",
		platform: "#46525a",
	},
} as const;

/**
 * How areas are filled while editing, as iD's Map Data pane: only their outlines, a band inside
 * the outline (the default: imagery stays visible inside large areas), or the whole area.
 */
export type AreaFill = "wireframe" | "partial" | "full";

export const AREA_FILLS: readonly AreaFill[] = ["wireframe", "partial", "full"];

/** An area's outline colour and the colour of its fill or inner band, with its alpha. */
export interface AreaPaint {
	readonly stroke: string;
	readonly fill: string;
}

/** The editor's colours, after iD's stylesheet (`css/25_areas.css`, `30_highways.css`…). */
export interface EditColors {
	readonly building: AreaPaint;
	readonly room: AreaPaint;
	readonly restricted: AreaPaint;
	readonly space: AreaPaint;
	readonly vertical: AreaPaint;
	readonly column: AreaPaint;
	readonly wall: AreaPaint;
	/** Other areas, and indoor=level outlines: iD's default grey and white. */
	readonly area: AreaPaint;
	/** Walls drawn as lines (iD's barriers). */
	readonly wallLine: string;
	/** `highway=footway`, `path` and other walkable lines. */
	readonly footway: string;
	readonly corridor: string;
	readonly steps: string;
	/** Other lines: iD draws them white. */
	readonly line: string;
}

/**
 * On imagery and dark maps, iD's own colours: grey outlines with a white band for areas without
 * a colour of their own (iD gives indoor features none), its building red, the pedestrian tan of
 * platforms for open spaces, the green of steps for stairs and elevators.
 */
export const DARK_EDIT_COLORS: EditColors = {
	building: { stroke: "rgb(224, 110, 95)", fill: "rgba(224, 110, 95, 0.3)" },
	room: { stroke: "rgb(170, 170, 170)", fill: "rgba(255, 255, 255, 0.3)" },
	restricted: {
		stroke: "rgb(170, 170, 170)",
		fill: "rgba(140, 140, 140, 0.5)",
	},
	space: { stroke: "rgb(221, 204, 170)", fill: "rgba(221, 204, 170, 0.3)" },
	vertical: { stroke: "rgb(129, 210, 92)", fill: "rgba(129, 210, 92, 0.3)" },
	column: { stroke: "rgb(170, 170, 170)", fill: "rgba(140, 140, 140, 0.5)" },
	wall: { stroke: "rgb(221, 221, 221)", fill: "rgba(221, 221, 221, 0.5)" },
	area: { stroke: "rgb(170, 170, 170)", fill: "rgba(255, 255, 255, 0.3)" },
	wallLine: "rgb(221, 221, 221)",
	footway: "rgb(153, 136, 136)",
	corridor: "rgb(140, 208, 95)",
	steps: "rgb(129, 210, 92)",
	line: "rgb(255, 255, 255)",
};

/**
 * The same hues on the light map, where iD's white bands and light outlines would vanish: greys
 * and outlines darkened, bands a little stronger.
 */
export const LIGHT_EDIT_COLORS: EditColors = {
	building: { stroke: "rgb(205, 85, 70)", fill: "rgba(224, 110, 95, 0.3)" },
	room: { stroke: "rgb(125, 125, 125)", fill: "rgba(120, 120, 120, 0.22)" },
	restricted: {
		stroke: "rgb(110, 110, 110)",
		fill: "rgba(90, 90, 90, 0.4)",
	},
	space: { stroke: "rgb(176, 150, 100)", fill: "rgba(200, 175, 125, 0.35)" },
	vertical: { stroke: "rgb(80, 165, 45)", fill: "rgba(129, 210, 92, 0.4)" },
	column: { stroke: "rgb(110, 110, 110)", fill: "rgba(90, 90, 90, 0.45)" },
	wall: { stroke: "rgb(80, 80, 80)", fill: "rgba(80, 80, 80, 0.5)" },
	area: { stroke: "rgb(140, 140, 140)", fill: "rgba(120, 120, 120, 0.18)" },
	wallLine: "rgb(80, 80, 80)",
	footway: "rgb(136, 110, 110)",
	corridor: "rgb(95, 170, 50)",
	steps: "rgb(80, 165, 45)",
	line: "rgb(110, 110, 110)",
};

/** The editor's colours for a light or dark map. */
export function editColors(theme: Theme): EditColors {
	return theme === "dark" ? DARK_EDIT_COLORS : LIGHT_EDIT_COLORS;
}
