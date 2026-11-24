<script lang="ts">
	/**
	 * The help pages (P6): how to view, edit and upload indoor data with IndoorID, one section
	 * per task, linked from the shortcuts help and the header. English only for now; the
	 * shortcuts themselves are listed by `ShortcutsDialog`, from the keymap.
	 */
	import { asset, resolve } from "$app/paths";

	/** This copy's address, for the userscript to link to. */
	const editorAddress = new URL(resolve("/"), location.href).href;

	const SECTIONS = [
		{ id: "start", title: "Getting started" },
		{ id: "view", title: "Viewing indoor data" },
		{ id: "building", title: "Editing a building" },
		{ id: "draw", title: "Drawing rooms, walls and doors" },
		{ id: "precision", title: "Drawing precisely" },
		{ id: "plans", title: "Floor plans" },
		{ id: "tags", title: "Choosing what a feature is" },
		{ id: "upload", title: "Checking and uploading" },
		{ id: "elsewhere", title: "From other tools" },
		{ id: "keys", title: "Keyboard shortcuts" },
	] as const;
</script>

<article
	class="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6 text-sm leading-relaxed"
>
	<header class="flex flex-col gap-2">
		<h2 class="text-2xl font-semibold">How to use IndoorID</h2>
		<p class="text-muted-foreground">
			IndoorID edits the inside of buildings in OpenStreetMap, level by level,
			with
			<a
				class="underline underline-offset-2"
				href="https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging"
				target="_blank"
				rel="noopener"
				>Simple Indoor Tagging</a
			>. It is an alpha (0.1): save your work often, and report what goes wrong
			on
			<a
				class="underline underline-offset-2"
				href="https://github.com/mglsj/indoor-id/issues"
				target="_blank"
				rel="noopener"
				>GitHub</a
			>.
		</p>
		<nav aria-label="Help sections">
			<ul class="flex flex-wrap gap-x-4 gap-y-1">
				{#each SECTIONS as section (section.id)}
					<li>
						<a class="underline underline-offset-2" href={`#${section.id}`}
							>{section.title}</a
						>
					</li>
				{/each}
			</ul>
		</nav>
	</header>

	<section id="start" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">Getting started</h3>
		<p>
			Open the
			<a class="underline underline-offset-2" href={resolve("/")}>editor</a>
			and move the map to a building. Zoomed out, the map shows buildings and
			entrances; zoom in and the indoor data loads from OpenStreetMap. Pick a
			level in the level switcher on the right. You can look and draw without an
			account; uploading asks you to log in to OpenStreetMap.
		</p>
		<p>
			Your edits are saved in this browser as you go. If the tab closes or
			crashes, IndoorID offers to restore them the next time you open it.
		</p>
	</section>

	<section id="view" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">Viewing indoor data</h3>
		<p>
			The
			<a class="underline underline-offset-2" href={resolve("/view")}>viewer</a>
			shows indoor maps without editing: bubbles mark where indoor data is when
			zoomed out, a click on a room shows what it is, and the side panel lists
			and searches the places on the level. The header switches between the
			viewer and the editor at the same place.
		</p>
	</section>

	<section id="building" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">Editing a building</h3>
		<p>
			The map first shows buildings, building parts and entrances. Double-click
			a building, or select it and choose <em>Edit indoor</em>, to enter it: the
			editor downloads the whole building, fades what is outside, and offers the
			indoor tools. The level switcher then lists every floor the building has,
			mapped or not. Press <kbd>Esc</kbd> with nothing selected, or
			<em>Done</em>, to leave.
		</p>
		<p>
			Indoor data with no building around it, such as a station's underground
			levels, is entered with <em>Edit indoor here</em>. A feature belongs to
			the building that holds most of its corners.
		</p>
		<p>
			The building's outline is locked while you work inside, so a room drawn
			along it doesn't move it by accident. Tick <em>Edit outline</em> in the
			side panel to change it.
		</p>
	</section>

	<section id="draw" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">Drawing rooms, walls and doors</h3>
		<ul class="list-disc space-y-1 pl-5">
			<li>
				<strong>Point</strong>
				(<kbd>1</kbd>): on a room's side it adds a door in every room sharing
				that side; on the building's outline, an entrance; on an indoor fence, a
				gate; anywhere else, a point whose type you pick next.
			</li>
			<li>
				<strong>Line</strong>
				(<kbd>2</kbd>) and <strong>Area</strong> (<kbd>3</kbd>): click to add
				corners. A corner on an existing corner or side is shared with it, so
				rooms join their neighbours. Click the last corner or press
				<kbd>Enter</kbd>
				to finish.
			</li>
			<li>
				<strong>Rectangle</strong>
				(<kbd>4</kbd>) draws a room from two corners, or from one side and its
				depth.
			</li>
			<li>
				<strong>Split</strong>
				(<kbd>X</kbd>) cuts the rooms a line crosses in two.
			</li>
			<li>
				The empty floor of a level (what no room covers) can be selected with a
				click and turned into a room or corridor in one step.
			</li>
		</ul>
		<p>
			Select a feature to edit it in the side panel; Shift+click or Shift+drag
			selects several. The toolbar, or a right-click on the map, lists what can
			be done with the selection: copy and paste, merge rooms, square corners,
			repeat on other levels, make a room with a hole, cut a void out of the
			level outline, move, rotate, delete.
		</p>
		<p>
			<strong>Repeat on levels</strong>
			(<kbd>R</kbd>) puts a feature on other levels: a copy on each level for
			rooms, or one feature listing every level for walls and columns.
		</p>
	</section>

	<section id="precision" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">Drawing precisely</h3>
		<ul class="list-disc space-y-1 pl-5">
			<li>
				Snapping (<kbd>S</kbd>) catches corners, sides, their middles, floor
				plan corners and angles; the snapping menu turns each kind on or off.
				Hold <kbd>Alt</kbd> to place a corner exactly where the pointer is.
			</li>
			<li>
				While drawing, type a length and press <kbd>Enter</kbd> (<kbd>Tab</kbd>
				for an angle) to place the next corner at that distance. Hold
				<kbd>Shift</kbd>
				to keep the direction.
			</li>
			<li>
				The grid (<kbd>G</kbd>) and the drawing frame follow the building's
				walls. Guides (<kbd>M</kbd>) are lines to draw along, kept with the
				building.
			</li>
			<li>
				Tracing (<kbd>T</kbd>
				while drawing): a click on a corner after a corner follows the outlines
				between them, so a corridor can run along a row of rooms in two clicks.
			</li>
		</ul>
	</section>

	<section id="plans" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">Floor plans</h3>
		<p>
			Inside a building, open <em>Floor plans</em> to import a plan as an image
			(PNG, JPEG, WebP), a PDF or an SVG, and assign it to a level. Place it
			with control points (a point on the plan, then where it is on the map),
			with a known distance, or by moving, rotating and scaling it. Vector PDFs
			and SVGs stay sharp and their corners can be snapped to. Plans stay in
			this browser; export them as a file to move them elsewhere. Only trace
			plans you have the right to use for OpenStreetMap.
		</p>
	</section>

	<section id="tags" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">Choosing what a feature is</h3>
		<p>
			A new feature asks for its type first: indoor types are listed first, then
			the last ones you chose. Fields below edit its tags; the ⓘ buttons show
			the OpenStreetMap wiki's documentation, and the Tags section edits the
			tags directly, as a list or as text. IndoorID never changes a tag you
			didn't edit.
		</p>
	</section>

	<section id="upload" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">Checking and uploading</h3>
		<p>
			IndoorID checks your edits as you work: the warning button beside
			<em>Save</em>
			counts the issues, and the side panel shows a feature's issues with
			one-click fixes where there is one. Inside a building,
			<em>Preview in indoor=</em>
			opens the building, your edits included, in the indoor= viewer before you
			upload.
		</p>
		<p>
			<em>Save</em>
			uploads all your edits in one changeset, exactly as edited. If someone
			else changed the same features meanwhile, IndoorID merges what it can and
			lists the rest for you to decide.
		</p>
	</section>

	<section id="elsewhere" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">From other tools</h3>
		<p>
			The
			<a
				class="underline underline-offset-2"
				href={asset("indoorid.user.js")}
				data-testid="userscript-link"
				>Open in IndoorID userscript</a
			>
			adds <em>Open in IndoorID</em> to openstreetmap.org's Edit menu, and a
			button to OSMCha's changesets and to indoor=. Install it with a userscript
			manager such as Violentmonkey or Tampermonkey, then give it this copy's
			address from the manager's menu (<em>Set IndoorID's address</em>):
			<code class="rounded bg-muted px-1">{editorAddress}</code>.
		</p>
		<p>
			To look at what you are editing in JOSM before you upload it, turn on
			Remote Control in JOSM's preferences, allow <em>Export data from JOSM</em>
			there (JOSM from July 2025 on), and open
			<a
				class="underline underline-offset-2"
				href={`${resolve("/")}?source=josm`}
				>IndoorID with ?source=josm</a
			>. It shows JOSM's active layer, unsaved edits included, read-only: upload
			from JOSM.
		</p>
	</section>

	<section id="keys" class="flex flex-col gap-2">
		<h3 class="text-lg font-medium">Keyboard shortcuts</h3>
		<p>
			Press <kbd>?</kbd> in the editor, or the keyboard button in the toolbar,
			to list every shortcut.
		</p>
	</section>
</article>
