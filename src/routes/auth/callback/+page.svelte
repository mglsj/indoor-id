<script lang="ts">
	import { msg, t } from "#lib/i18n/messages.ts";

	// Landing page of the OSM login popup: hands the result back to the editor (osm-auth listens
	// on this channel), then closes itself.
	new BroadcastChannel("osm-api-auth-complete").postMessage(location.href);
	window.close();
</script>

<svelte:head>
	<title>{t(msg("auth_logging_in_indoorid"))}</title>
</svelte:head>

<p class="p-6 text-sm">{t(msg("auth_you_are_logged_in"))}</p>
