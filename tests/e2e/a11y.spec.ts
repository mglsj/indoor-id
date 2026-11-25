import type { Locator, Page } from "@playwright/test";
import {
	camera,
	expect,
	INDOOR,
	LAT,
	LON,
	mapDrawn,
	room,
	serveOsm,
	test,
} from "./fixtures.ts";

/**
 * Phase A's checks (the 2026-11-24 audit): what the theme draws, measured as the browser
 * resolves it. WCAG 2.2 AA's 3:1 for graphics and states is the yardstick.
 */

/** The sRGB colour a CSS colour resolves to, drawn on a canvas (oklch and alpha included). */
async function rgb(
	page: Page,
	css: string,
	over = "#ffffff",
): Promise<[number, number, number]> {
	return page.evaluate(
		([colour, under]) => {
			const canvas = new OffscreenCanvas(1, 1);
			const context = canvas.getContext("2d");
			if (!context) throw new Error("No 2D context");
			context.fillStyle = under ?? "#fff";
			context.fillRect(0, 0, 1, 1);
			context.fillStyle = colour ?? "";
			context.fillRect(0, 0, 1, 1);
			const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
			return [r, g, b] as [number, number, number];
		},
		[css, over] as const,
	);
}

/** WCAG's contrast ratio of two sRGB colours. */
function contrast(a: [number, number, number], b: [number, number, number]) {
	const luminance = ([r, g, b]: [number, number, number]) => {
		const [lr, lg, lb] = [r, g, b].map((c) => {
			const v = c / 255;
			return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * (lr ?? 0) + 0.7152 * (lg ?? 0) + 0.0722 * (lb ?? 0);
	};
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const background = (locator: Locator) =>
	locator.evaluate((element) => getComputedStyle(element).backgroundColor);

async function openBuilding(page: Page) {
	await serveOsm(page, room(100, LON, LAT, "0"));
	await page.goto(`/#19/${LAT}/${LON}/0${INDOOR}`);
	await camera(page);
	await mapDrawn(page);
}

for (const theme of ["light", "dark"] as const) {
	test.describe(`${theme} theme (A.1)`, () => {
		test.use({ colorScheme: theme });

		test("a pressed tool stands out from its neighbours by 3:1", async ({
			page,
		}) => {
			await openBuilding(page);
			const surface = await page.evaluate(
				() => getComputedStyle(document.body).backgroundColor,
			);
			await page.getByRole("button", { name: "Draw line" }).click();
			const pressed = page.getByRole("button", { name: "Draw line" });
			await expect(pressed).toHaveAttribute("aria-pressed", "true");
			const neighbour = page.getByRole("button", { name: "Draw area" });
			// Once the buttons' colour transition is over.
			await expect
				.poll(async () =>
					contrast(
						await rgb(page, await background(pressed), surface),
						await rgb(page, await background(neighbour), surface),
					),
				)
				.toBeGreaterThanOrEqual(3);
		});

		test("the selected level stands out from the others by 3:1", async ({
			page,
		}) => {
			await serveOsm(page, [
				...room(100, LON, LAT, "0"),
				...room(200, LON, LAT, "1"),
			]);
			await page.goto(`/#19/${LAT}/${LON}/0${INDOOR}`);
			await camera(page);
			await mapDrawn(page);
			const surface = await page.evaluate(
				() => getComputedStyle(document.body).backgroundColor,
			);
			const list = page.getByRole("group", { name: "Levels" });
			const selected = list.getByRole("radio", { name: "Level 0" });
			const other = list.getByRole("radio", { name: "Level 1" });
			await expect(selected).toHaveAttribute("data-state", "on");
			await expect
				.poll(async () =>
					contrast(
						await rgb(page, await background(selected), surface),
						await rgb(page, await background(other), surface),
					),
				)
				.toBeGreaterThanOrEqual(3);
		});

		test("the focus ring is drawn at 3:1 or more", async ({ page }) => {
			await openBuilding(page);
			const button = page.getByRole("button", { name: "Draw area" });
			await button.focus();
			await page.keyboard.press("Shift+Tab");
			await page.keyboard.press("Tab");
			await expect(button).toBeFocused();
			const surface = await page.evaluate(
				() => getComputedStyle(document.body).backgroundColor,
			);
			const under = await rgb(page, surface);
			// Every colour of the shadow list: the ring is the one that shows, once its
			// transition is over.
			await expect
				.poll(async () => {
					const colours = await button.evaluate((element) =>
						[
							...getComputedStyle(element).boxShadow.matchAll(
								/(oklch|oklab|rgba?|color)\([^)]*\)/g,
							),
						].map((match) => match[0]),
					);
					let best = 1;
					for (const colour of colours) {
						best = Math.max(
							best,
							contrast(await rgb(page, colour, surface), under),
						);
					}
					return best;
				})
				.toBeGreaterThanOrEqual(3);
		});
	});
}
