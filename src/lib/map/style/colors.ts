/**
 * Colours of indoor features, after the 1.x stylesheet: neutral greys for spaces, dark walls,
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
