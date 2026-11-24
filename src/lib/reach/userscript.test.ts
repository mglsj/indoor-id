/**
 * The pure part of `static/indoorid.user.js` ("Open in IndoorID" on openstreetmap.org,
 * OSMCha and indoor=, P6): the script is evaluated without a page, so only its links are made.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Position {
	zoom: number;
	lat: number;
	lon: number;
	level?: number;
}

const source = readFileSync(
	new URL("../../../static/indoorid.user.js", import.meta.url),
	"utf8",
);
const links = new Function(`${source}\nreturn IndoorIdLinks;`)() as {
	DEFAULT_EDITOR: string;
	positionFromHash(hash: string): Position | null;
	positionOfBbox(bbox: Record<string, number>): Position;
	editorLink(editor: string, position: Position): string;
	osmchaChangeset(pathname: string): number | null;
};

describe("Open in IndoorID", () => {
	it("reads openstreetmap.org's and indoor='s map position, with a level", () => {
		expect(links.positionFromHash("#map=19/48.13/-1.69")).toEqual({
			zoom: 19,
			lat: 48.13,
			lon: -1.69,
		});
		expect(
			links.positionFromHash("#map=18.5/48.13/-1.69&level=0"),
		).toMatchObject({ level: 0 });
		expect(links.positionFromHash("#layers=N")).toBeNull();
		expect(links.positionFromHash("#map=19/x/1")).toBeNull();
	});

	it("links to IndoorID's hash, at a zoom it downloads data at", () => {
		expect(
			links.editorLink("https://example.org/indoorid", {
				zoom: 12,
				lat: 48.13,
				lon: -1.69,
			}),
		).toBe("https://example.org/indoorid/#17/48.130000/-1.690000");
		expect(
			links.editorLink("http://localhost:5173/#old", {
				zoom: 19.4,
				lat: 1,
				lon: 2,
				level: -1,
			}),
		).toBe("http://localhost:5173/#19/1.000000/2.000000/-1");
	});

	it("opens an OSMCha changeset at the middle of its bounding box", () => {
		expect(links.osmchaChangeset("/changesets/123456")).toBe(123456);
		expect(links.osmchaChangeset("/filters")).toBeNull();
		expect(
			links.positionOfBbox({
				min_lat: 48,
				min_lon: -2,
				max_lat: 49,
				max_lon: -1,
			}),
		).toEqual({ zoom: 18, lat: 48.5, lon: -1.5 });
	});
});
