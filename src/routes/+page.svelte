<script lang="ts">
	import AppPage from "#lib/ui/AppPage.svelte";
	import EditorView from "#lib/ui/EditorView.svelte";
</script>

<AppPage page="edit">
	{#snippet children(config)}
		<EditorView {config} />
	{/snippet}
</AppPage>
