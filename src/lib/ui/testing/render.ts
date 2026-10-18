/** Component tests: rendering under an editor given as context. */
import type { Component } from "svelte";
import { render } from "vitest-browser-svelte";
import type { Editor } from "#lib/state/editor.svelte.ts";
import WithEditor from "./WithEditor.svelte";

/** Renders `component` with `props`, `getEditor()` giving it `editor`. */
export function renderWithEditor<P extends Record<string, unknown>>(
	editor: Editor,
	component: Component<P>,
	props: P,
) {
	const harness = WithEditor as unknown as Component<{
		editor: Editor;
		component: Component<P>;
		props: P;
	}>;
	// Under `props`: `props` is also a mount option.
	return render(harness, { props: { editor, component, props } });
}
