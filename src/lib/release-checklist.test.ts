/**
 * The 0.1 alpha release checklist (docs/release-0.1.md) names an e2e test for each feature it
 * ships with: each must still exist, so the checklist can't drift from the suite.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const checklist = readFileSync(new URL("docs/release-0.1.md", root), "utf8");
const ITEM = /^- \[ \] (.+?) — `([\w-]+\.spec\.ts)` › (.+)$/gm;
const items = [...checklist.matchAll(ITEM)].map(([, feature, file, title]) => ({
	feature: feature ?? "",
	file: file ?? "",
	title: title ?? "",
}));

describe("the release checklist", () => {
	it("lists the features with their tests", () => {
		expect(items.length).toBeGreaterThan(40);
	});

	it.each(items)("$feature: $file has the test", ({ file, title }) => {
		const spec = readFileSync(new URL(`tests/e2e/${file}`, root), "utf8");
		// Titles are quoted with double quotes in the specs; Biome may wrap them on their own line.
		expect(spec).toContain(`"${title}"`);
	});
});
