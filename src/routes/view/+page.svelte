<script lang="ts">
	import AppPage from "#lib/ui/AppPage.svelte";
	import ViewerView from "#lib/ui/ViewerView.svelte";
</script>

<AppPage page="view">
	{#snippet children(config)}
		<ViewerView {config} />
	{/snippet}
</AppPage>
