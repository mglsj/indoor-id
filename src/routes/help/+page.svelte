<script lang="ts">
	import AppPage from "#lib/ui/AppPage.svelte";
	import HelpPage from "#lib/ui/HelpPage.svelte";
</script>

<AppPage page="help">
	{#snippet children()}
		<div class="h-full overflow-y-auto"><HelpPage /></div>
	{/snippet}
</AppPage>
