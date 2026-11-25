import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
// Tailwind's base, whose `img { height: auto }` stretched tall icons.
import "../../app.css";
import PresetIcon from "./PresetIcon.svelte";

describe("PresetIcon", () => {
	it("keeps a tall icon in its square, so it doesn't stretch its row", async () => {
		await render(PresetIcon, { icon: "temaki-latrine", size: 20 });
		const img = document.querySelector("img");
		expect(img).not.toBeNull();
		await expect.poll(() => img?.complete).toBe(true);
		const box = img?.getBoundingClientRect();
		expect(box?.width).toBe(20);
		expect(box?.height).toBe(20);
	});
});
