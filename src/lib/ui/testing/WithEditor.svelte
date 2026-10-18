<!-- Component tests: renders a component under an editor given as context (`getEditor()`). -->
<script lang="ts" generics="P extends Record<string, unknown>">
	import type { Component } from "svelte";
	import { type Editor, setEditor } from "#lib/state/editor.svelte.ts";

	interface Props {
		editor: Editor;
		component: Component<P>;
		props: P;
	}

	let { editor, component: Inner, props }: Props = $props();
	// svelte-ignore state_referenced_locally
	setEditor(editor);
</script>

<Inner {...props} />
