import { asset } from "$app/paths";
import { type EditorConfig, parseConfig } from "./config-schema.ts";

export type { EditorConfig };

/** Reads and checks the instance's `config.json` (see `config-schema.ts`). */
export async function loadConfig(
	fetchFn: typeof fetch = fetch,
): Promise<EditorConfig> {
	const response = await fetchFn(asset("config.json"));
	if (!response.ok) {
		throw new Error(`Could not load config.json (HTTP ${response.status})`);
	}
	return parseConfig(await response.json());
}
