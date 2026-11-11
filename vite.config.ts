import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

function gitHash(): string {
	try {
		return execSync("git rev-parse --short HEAD").toString().trim();
	} catch {
		return "dev";
	}
}

/** The app version from package.json, shown next to the commit. */
const version: string = JSON.parse(
	readFileSync(new URL("package.json", import.meta.url), "utf8"),
).version;

/**
 * Completes the `licenses.md` Vite writes for the bundled packages (`build.license`): IndoorID's
 * own LICENSE.md (with the notices for code and icons taken from iD, OsmInEdit and
 * osm-simple3d-editor) first, then the licenses of what Vite doesn't see there: the Inter font,
 * loaded from CSS, and the JPEG XL codec, bundled into the plan worker.
 */
function thirdPartyNotices(): Plugin {
	const extra = [
		"node_modules/@fontsource-variable/inter/LICENSE",
		"node_modules/@jsquash/jxl/LICENSE",
	];
	return {
		name: "indoorid-third-party-notices",
		apply: "build",
		writeBundle(options, bundle) {
			if (!options.dir || !("licenses.md" in bundle)) return;
			const file = join(options.dir, "licenses.md");
			const bundled = readFileSync(file, "utf8");
			const own = readFileSync("LICENSE.md", "utf8");
			const more = extra.map(
				(path) =>
					`\n## ${path.split("/").slice(1, -1).join("/")}\n\n${readFileSync(path, "utf8")}`,
			);
			// Rewritten whole: own notice first, then the bundled packages, then the rest.
			writeFileSync(file, `${own}\n${bundled}${more.join("")}`);
		},
	};
}

export default defineConfig({
	plugins: [
		thirdPartyNotices(),
		tailwindcss(),
		sveltekit({
			// Every route is prerendered as an empty client-side shell (see src/routes/+layout.ts),
			// so the build output can be served by any static file host, including from a subfolder.
			adapter: adapter(),
		}),
	],
	define: {
		__APP_VERSION__: JSON.stringify(version),
		__GIT_HASH__: JSON.stringify(gitHash()),
	},
	// The notices of the packages bundled into the app (MIT, BSD and Apache licences require
	// them in copies), served next to it as /licenses.md and linked from the About dialog.
	build: { license: { fileName: "licenses.md" } },
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
