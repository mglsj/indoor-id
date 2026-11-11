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
	textHalo: "rgba(0, 0, 0, 0.75)",
};

export type Theme = "light" | "dark";

/** The indoor colours for a light or dark map. */
export function indoorColors(theme: Theme): IndoorColors {
	return theme === "dark" ? DARK_INDOOR_COLORS : INDOOR_COLORS;
}
