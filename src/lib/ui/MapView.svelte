<script lang="ts">
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import { untrack } from "svelte";
	import type { Attachment } from "svelte/attachments";
	import * as Alert from "#lib/components/shadcn/alert/index.ts";
	import { MAX_ZOOM, type MapView } from "#lib/map/hash.ts";
	import {
		GPUInitializationError,
		Map as MapLibreMap,
		NavigationControl,
		ScaleControl,
	} from "#lib/map/maplibre.ts";
	import { styleReady } from "#lib/map/ready.ts";

	type Camera = Omit<MapView, "level">;

	interface Props {
		styleUrl: string;
		/** Camera at creation time. Later changes go through `map.jumpTo`. */
		initialCamera: Camera;
		/** The MapLibre map, once created. */
		map?: MapLibreMap;
		/** Called once the style is loaded and after every camera movement. */
		onmove?: (camera: Camera) => void;
		/** Indoor features drawn so far, shown as `data-drawn` for the e2e tests. */
		drawn?: number;
		/** Floor plan tiles drawn, shown as `data-plan-tiles` for the e2e tests. */
		planTiles?: number;
	}

	let {
		styleUrl,
		initialCamera,
		map = $bindable(),
		onmove,
		drawn,
		planTiles,
	}: Props = $props();

	let error = $state<string>();
	let camera = $state<Camera>();

	// Created once: later prop changes must not rebuild the map.
	const createMap: Attachment<HTMLDivElement> = (container) =>
		untrack(() => {
			let instance: MapLibreMap;
			try {
				instance = new MapLibreMap({
					container,
					style: styleUrl,
					center: [initialCamera.lon, initialCamera.lat],
					zoom: initialCamera.zoom,
					maxZoom: MAX_ZOOM,
					attributionControl: { compact: true },
				});
			} catch (e) {
				error =
					e instanceof GPUInitializationError
						? "Your browser could not start WebGL, which is needed to display the map."
						: `The map could not be created: ${String(e)}`;
				return;
			}

			// Remember the first load now, for layers added later (see `styleReady`).
			void styleReady(instance);
			instance.addControl(
				new NavigationControl({ visualizePitch: true }),
				"bottom-right",
			);
			instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

			const notify = () => {
				const center = instance.getCenter();
				camera = { zoom: instance.getZoom(), lat: center.lat, lon: center.lng };
				onmove?.(camera);
			};
			instance.on("load", notify);
			instance.on("moveend", notify);
			// Tile errors are frequent and transient; only report a basemap style that can't load.
			let styleLoaded = false;
			instance.once("style.load", () => (styleLoaded = true));
			instance.on("error", (event) => {
				if (!styleLoaded) {
					error = `The basemap could not be loaded: ${event.error.message}`;
				}
			});

			map = instance;
			return () => {
				map = undefined;
				instance.remove();
			};
		});
</script>

<div
	{@attach createMap}
	class="h-full w-full"
	data-testid="map"
	data-zoom={camera?.zoom}
	data-center={camera ? `${camera.lat},${camera.lon}` : undefined}
	data-drawn={drawn}
	data-plan-tiles={planTiles}
></div>

{#if error}
	<div class="absolute inset-x-4 top-4 z-10 mx-auto max-w-lg shadow-md">
		<Alert.Root variant="destructive">
			<CircleAlert />
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	</div>
{/if}
