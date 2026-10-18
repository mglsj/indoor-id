import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
	testDir: "tests/e2e",
	// Tests share nothing: each file's tests run in parallel too.
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "retain-on-failure",
		// Tests find controls by their English names; dates and numbers are formatted in it.
		locale: "en-US",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				// Headless Chromium has no GPU: render WebGL in software.
				launchOptions: {
					args: [
						"--use-angle=swiftshader",
						"--enable-unsafe-swiftshader",
						"--ignore-gpu-blocklist",
					],
				},
			},
		},
	],
	webServer: {
		command: `bun run build && bun run preview -- --port ${PORT} --strictPort`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
