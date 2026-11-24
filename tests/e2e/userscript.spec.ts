import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures.ts";

const SCRIPT = readFileSync(
	new URL("../../static/indoorid.user.js", import.meta.url),
	"utf8",
);

test("the userscript adds Open in IndoorID to openstreetmap.org's Edit menu", async ({
	page,
}) => {
	// openstreetmap.org's Edit menu, as its pages have it.
	await page.route("https://www.openstreetmap.org/**", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<!doctype html><nav><div id="edit_tab"><ul class="dropdown-menu"><li><a class="dropdown-item" data-editor="id">Edit with iD</a></li></ul></div></nav>`,
		}),
	);
	await page.goto("https://www.openstreetmap.org/#map=19/48.13/-1.69");
	await page.evaluate(() =>
		localStorage.setItem("indoorid.editor", "http://localhost:4173/"),
	);
	await page.addScriptTag({ content: SCRIPT });
	const popup = page.waitForEvent("popup");
	await page
		.locator("#edit_tab")
		.getByRole("link", { name: "Open in IndoorID" })
		.click();
	await expect(await popup).toHaveURL(
		"http://localhost:4173/#19/48.130000/-1.690000",
	);
});

test("the help page links to the userscript and says this copy's address", async ({
	page,
}) => {
	await page.goto("/help#elsewhere");
	const link = page.getByTestId("userscript-link");
	const href = await link.getAttribute("href");
	const script = await page.request.get(new URL(href!, page.url()).href);
	expect(await script.text()).toContain("@name         Open in IndoorID");
	await expect(page.locator("#elsewhere code")).toHaveText(
		"http://localhost:4173/",
	);
});
