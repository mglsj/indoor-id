import type { Page } from "@playwright/test";
import {
	camera,
	expect,
	inspector,
	LAT,
	LON,
	mapCenter,
	mapDrawn,
	tagsBox,
	test,
} from "./fixtures.ts";

/** A room JOSM drew and didn't upload: negative ids, no versions. */
const LAYER = `<?xml version='1.0' encoding='UTF-8'?>
<osm version='0.6' generator='JOSM'>
  <node id='-1' action='modify' visible='true' lat='${LAT - 0.0002}' lon='${LON - 0.0002}' />
  <node id='-2' action='modify' visible='true' lat='${LAT - 0.0002}' lon='${LON + 0.0002}' />
  <node id='-3' action='modify' visible='true' lat='${LAT + 0.0002}' lon='${LON + 0.0002}' />
  <node id='-4' action='modify' visible='true' lat='${LAT + 0.0002}' lon='${LON - 0.0002}' />
  <way id='-5' action='modify' visible='true'>
    <nd ref='-1' /><nd ref='-2' /><nd ref='-3' /><nd ref='-4' /><nd ref='-1' />
    <tag k='indoor' v='room' />
    <tag k='level' v='0' />
    <tag k='name' v='Drawn in JOSM' />
  </way>
</osm>`;

async function serveJosm(
	page: Page,
	answer: { status?: number; body: string },
) {
	await page.route("http://127.0.0.1:8111/export", (route) =>
		route.fulfill({
			status: answer.status ?? 200,
			contentType: "application/xml; charset=utf-8",
			headers: { "Access-Control-Allow-Origin": "*" },
			body: answer.body,
		}),
	);
}

test("?source=josm shows JOSM's active layer, goes to it, and never uploads", async ({
	page,
}) => {
	await serveJosm(page, { body: LAYER });
	await page.goto("/?source=josm");
	await expect(page.getByTestId("josm-banner")).toContainText(
		"Showing JOSM's active layer, read-only",
	);
	// No place in the link: the camera goes to the data.
	await expect
		.poll(async () => {
			const { lat, lon } = await camera(page);
			return Math.abs(lat - LAT) + Math.abs(lon - LON);
		})
		.toBeLessThan(0.0005);
	await mapDrawn(page);
	const { x, y } = await mapCenter(page);
	await page.mouse.click(x, y);
	await expect(inspector(page).root).toBeVisible();
	await expect(await tagsBox(page)).toHaveValue(/name=Drawn in JOSM/);

	// An edit can be tried, but not uploaded.
	await page.keyboard.press("Delete");
	await expect(page.getByTestId("edit-count")).not.toHaveText("0");
	await expect(page.getByRole("button", { name: /Save/ })).toBeDisabled();
});

test("?source=josm says how to allow JOSM to share its data", async ({
	page,
}) => {
	await serveJosm(page, { status: 403, body: "" });
	await page.goto("/?source=josm");
	await expect(page.getByTestId("josm-banner")).toContainText(
		'allow "Export data from JOSM"',
	);
});
