import { execSync } from "node:child_process";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

function gitHash(): string {
	try {
		return execSync("git rev-parse --short HEAD").toString().trim();
	} catch {
		return "dev";
	}
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			// Every route is prerendered as an empty client-side shell (see src/routes/+layout.ts),
			// so the build output can be served by any static file host, including from a subfolder.
			adapter: adapter(),
		}),
	],
	define: {
		__GIT_HASH__: JSON.stringify(gitHash()),
	},
	// The plan worker loads its JPEG XL encoder on demand, a split ES module workers allow.
	worker: { format: "es" },
	optimizeDeps: {
		// Served as is: prebundling would move the codec away from its WASM files.
		exclude: ["@jsquash/jxl"],
	},
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					exclude: ["src/**/*.component.test.ts", "src/**/*.browser.test.ts"],
					environment: "node",
				},
			},
			{
				// Components rendered in Chromium (Playwright's, as the e2e tests use), and code
				// needing browser APIs (workers, canvases).
				extends: true,
				test: {
					name: "component",
					include: ["src/**/*.component.test.ts", "src/**/*.browser.test.ts"],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});
