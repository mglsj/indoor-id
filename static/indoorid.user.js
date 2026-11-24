// ==UserScript==
// @name         Open in IndoorID
// @namespace    https://github.com/mglsj/indoor-id
// @version      0.1.0
// @description  Adds "Open in IndoorID" to openstreetmap.org, OSMCha and indoor=: the indoor editor opens at the same place.
// @match        https://www.openstreetmap.org/*
// @match        https://osmcha.org/*
// @match        https://indoorequal.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

/*
 * The address of IndoorID is asked once, from the script manager's menu ("Set IndoorID's
 * address"); it is http://localhost:5173/ until then. The help page of a running IndoorID
 * says its own address. Links carry IndoorID's URL hash: #zoom/lat/lon/level.
 */

/** What doesn't touch the page: tested on its own (`userscript.test.ts`). */
const IndoorIdLinks = (() => {
	const DEFAULT_EDITOR = "http://localhost:5173/";

	/** `map=zoom/lat/lon` and `level=` from a hash (openstreetmap.org, indoor=). */
	function positionFromHash(hash) {
		const params = new URLSearchParams(hash.replace(/^#/, ""));
		const map = (params.get("map") ?? "").split("/").map(Number);
		if (map.length < 3 || map.some((n) => !Number.isFinite(n))) return null;
		const [zoom, lat, lon] = map;
		const level = Number(params.get("level"));
		return {
			zoom,
			lat,
			lon,
			...(params.get("level") !== null && Number.isFinite(level)
				? { level }
				: {}),
		};
	}

	/** The middle of a bounding box, at a zoom showing a building. */
	function positionOfBbox({ min_lat, min_lon, max_lat, max_lon }) {
		return {
			zoom: 18,
			lat: (min_lat + max_lat) / 2,
			lon: (min_lon + max_lon) / 2,
		};
	}

	/** IndoorID's link to a position, from its address (a trailing slash or not). */
	function editorLink(editor, { zoom, lat, lon, level }) {
		const base = editor.replace(/#.*$/, "").replace(/\/?$/, "/");
		// IndoorID downloads data from zoom 17 on.
		const z = Math.max(17, Math.min(22, Math.round(zoom)));
		const hash = [z, lat.toFixed(6), lon.toFixed(6)];
		if (level !== undefined) hash.push(String(level));
		return `${base}#${hash.join("/")}`;
	}

	/** The changeset an OSMCha page shows: /changesets/123. */
	function osmchaChangeset(pathname) {
		const match = /^\/changesets\/(\d+)/.exec(pathname);
		return match ? Number(match[1]) : null;
	}

	return {
		DEFAULT_EDITOR,
		positionFromHash,
		positionOfBbox,
		editorLink,
		osmchaChangeset,
	};
})();

if (typeof document !== "undefined") {
	(() => {
		const KEY = "indoorid.editor";
		const L = IndoorIdLinks;
		const hasGm = typeof GM_getValue === "function";
		const getEditor = () =>
			(hasGm ? GM_getValue(KEY) : localStorage.getItem(KEY)) ||
			L.DEFAULT_EDITOR;
		if (typeof GM_registerMenuCommand === "function") {
			GM_registerMenuCommand("Set IndoorID's address", () => {
				const value = prompt("IndoorID's address", getEditor());
				if (value) hasGm ? GM_setValue(KEY, value) : localStorage.setItem(KEY, value);
			});
		}

		/** Opens IndoorID at a position worked out when clicked: the map may have moved. */
		function open(position) {
			if (position) window.open(L.editorLink(getEditor(), position), "_blank");
		}

		/** A button over the page, bottom left, for sites with no menu to join. */
		function floatingButton(onclick) {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = "Open in IndoorID";
			button.dataset.indoorid = "";
			Object.assign(button.style, {
				position: "fixed",
				left: "12px",
				bottom: "36px",
				zIndex: "10000",
				padding: "6px 12px",
				border: "1px solid #888",
				borderRadius: "6px",
				background: "#fff",
				color: "#222",
				font: "14px system-ui, sans-serif",
				cursor: "pointer",
			});
			button.addEventListener("click", onclick);
			document.body.append(button);
			return button;
		}

		const host = location.hostname;
		if (host === "www.openstreetmap.org") {
			// Join the Edit menu's editors; a button when the site's layout changed.
			const menu = document.querySelector("#edit_tab .dropdown-menu");
			const onclick = (event) => {
				event.preventDefault();
				open(L.positionFromHash(location.hash));
			};
			if (menu) {
				const item = document.createElement("li");
				const link = document.createElement("a");
				link.className = "dropdown-item";
				link.href = "#";
				link.textContent = "Open in IndoorID";
				link.dataset.indoorid = "";
				link.addEventListener("click", onclick);
				item.append(link);
				menu.append(item);
			} else {
				floatingButton(onclick);
			}
		} else if (host === "indoorequal.org") {
			floatingButton(() => open(L.positionFromHash(location.hash)));
		} else if (host === "osmcha.org") {
			// OSMCha's pages change without loading: the button follows the changeset shown.
			let button = null;
			const update = () => {
				const id = L.osmchaChangeset(location.pathname);
				if (id === null) {
					button?.remove();
					button = null;
				} else if (button?.dataset.changeset !== String(id)) {
					// Where the changeset is, asked before the click: a window opened after
					// waiting for an answer is taken for a pop-up.
					let position = null;
					button?.remove();
					button = floatingButton(() => open(position));
					button.dataset.changeset = String(id);
					fetch(`https://api.openstreetmap.org/api/0.6/changeset/${id}.json`)
						.then((answer) => answer.json())
						.then(({ changeset }) => {
							if (changeset?.min_lat !== undefined) {
								position = L.positionOfBbox(changeset);
							}
						});
				}
			};
			update();
			setInterval(update, 1000);
		}
	})();
}
