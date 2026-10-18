import { describe, expect, it } from "vitest";
import { formatTagText, parseTagText } from "./tag-text.ts";

describe("formatTagText, as iD's text view", () => {
	it("writes one key=value per line, sorted by key", () => {
		expect(formatTagText({ name: "Library", indoor: "room", level: "0" })).toBe(
			"indoor=room\nlevel=0\nname=Library",
		);
	});

	it("follows the order given, then sorts the rest", () => {
		expect(
			formatTagText({ name: "Library", indoor: "room", level: "0" }, [
				"name",
				"indoor",
			]),
		).toBe("name=Library\nindoor=room\nlevel=0");
	});

	it("quotes a value with = or characters JSON escapes", () => {
		expect(formatTagText({ note: "a=b", fixme: 'say "hi"' })).toBe(
			'fixme="say \\"hi\\""\nnote="a=b"',
		);
	});
});

describe("parseTagText, as iD's text view", () => {
	it("reads key=value lines", () => {
		expect(parseTagText("indoor=room\nlevel=0;1")).toEqual({
			indoor: "room",
			level: "0;1",
		});
	});

	it("splits on the first = only and trims", () => {
		expect(parseTagText("  note = a=b \n")).toEqual({ note: "a=b" });
	});

	it("reads quoted keys and values", () => {
		expect(parseTagText('fixme="say \\"hi\\""\nnote="a=b"')).toEqual({
			fixme: 'say "hi"',
			note: "a=b",
		});
	});

	it("keeps a key without value, empty, and ignores lines without a key", () => {
		expect(parseTagText("\nname=\n=orphan\nnot a tag\nref=B12\n")).toEqual({
			name: "",
			ref: "B12",
		});
	});

	it("keeps the last value of a repeated key", () => {
		expect(parseTagText("level=0\nlevel=1")).toEqual({ level: "1" });
	});
});
