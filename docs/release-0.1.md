# Release checklist: IndoorID 0.1 alpha

What 0.1 alpha ships with, each feature with the end-to-end test that shows it working. Before
tagging the release, run `bun run test:e2e` on the release commit: every test below must pass.
`src/lib/release-checklist.test.ts` checks that each test named here still exists, so the list
can't drift from the suite. The manual checks at the end cover what tests can't reach (the real
OSM API, a real JOSM, a userscript manager).

## Automated (e2e)

### Viewing

- [ ] Indoor data on its level — `indoor.spec.ts` › draws a room on its level only
- [ ] Levels from the data, named from level outlines — `indoor.spec.ts` › names levels from their indoor=level outlines
- [ ] OsmInEdit links open — `map.spec.ts` › centres the map on an OsmInEdit-style URL hash
- [ ] Viewer without an account — `viewer.spec.ts` › shows indoor data from Overpass without an account, and a feature's details on click
- [ ] Viewer finds places — `viewer.spec.ts` › the side panel lists the places on the level and finds them by name or ref
- [ ] Discovery bubbles — `viewer.spec.ts` › zoomed out, bubbles show where indoor data is, and a click zooms in
- [ ] Place search — `search.spec.ts` › finds a place and moves the map to it
- [ ] Imagery backgrounds — `background.spec.ts` › shows Esri imagery chosen in the background pane

### Building mode

- [ ] Double-click enters a building — `building-mode.spec.ts` › a double-click on a building enters it, fitting it in view beside its panel
- [ ] Indoor data no building holds — `building-mode.spec.ts` › outside any building, Edit indoor here opens the indoor data no building holds
- [ ] Every floor offered — `building-mode.spec.ts` › inside, the level switcher offers every floor building:levels counts, mapped or not
- [ ] Preview in indoor= — `building-mode.spec.ts` › Preview in indoor= sends the building, edits included, to indoor= once it is ready (P6)

### Drawing and geometry

- [ ] Areas drawn corner by corner — `geometry.spec.ts` › an area is drawn corner by corner, then its type is picked
- [ ] Doors on walls — `geometry.spec.ts` › a point on a room's side becomes a door
- [ ] Corners and rooms dragged — `geometry.spec.ts` › a corner of the selected room drags, in one undo step
- [ ] Snapping with lengths and angles — `precision.spec.ts` › a side drawn near an axis snaps to it, with its length and angle by the pointer
- [ ] Typed lengths — `precision.spec.ts` › a typed length places the next corner, to the centimetre
- [ ] Rectangles — `precision.spec.ts` › the rectangle tool takes a typed width;depth
- [ ] Grid — `precision.spec.ts` › G shows the grid, and the snapping menu takes its spacing
- [ ] Guides — `precision.spec.ts` › a guide at a typed distance from a side is snapped to, and kept
- [ ] Unmapped floor mapped in one click — `unmapped-floor.spec.ts` › a click on empty floor selects it, and a type maps it through its neighbours' nodes

### Operations

- [ ] Delete — `operations.spec.ts` › Delete removes the selected room and its corners, in one undo step
- [ ] Right-click menu — `operations.spec.ts` › a right-click opens the operations on what it is on (P6)
- [ ] Copy and paste — `operations.spec.ts` › a copied room pastes where the pointer is, selected
- [ ] Merge — `operations.spec.ts` › two rooms selected with Shift+click merge into one
- [ ] Split — `operations.spec.ts` › the split tool cuts a room in two along the line drawn
- [ ] Repeat on levels — `operations.spec.ts` › Repeat on levels puts a copy of the room on the level checked
- [ ] Rooms with holes — `operations.spec.ts` › a room and an area drawn inside it make a room with a hole
- [ ] Several features at once — `multi-select.spec.ts` › two features edited together, shared tags set on both

### Tagging

- [ ] Feature types and fields — `inspector.spec.ts` › selecting a room shows its type and fields
- [ ] Changing type keeps tags — `inspector.spec.ts` › changing the type keeps the other tags
- [ ] Raw tag editor — `inspector.spec.ts` › the raw tag editor edits every tag
- [ ] Outdated tags fixed — `inspector.spec.ts` › fixes outdated tags in one click, and the fix can be undone
- [ ] Taginfo suggestions — `fields.spec.ts` › a combo suggests the values used elsewhere, and stores what is typed as a tag value
- [ ] Wiki documentation — `references.spec.ts` › ⓘ shows the OSM wiki's documentation of a field's key
- [ ] Relations — `relations.spec.ts` › a feature is added to a relation in view, or to a new one

### Floor plans

- [ ] Images over the rooms mapped — `floorplans.spec.ts` › draws a plan over the rooms already mapped
- [ ] PDF pages as vectors — `floorplans.spec.ts` › imports a PDF page from its paths, measured in points
- [ ] SVG — `floorplans.spec.ts` › imports an SVG plan as paths, without running its scripts, kept after a reload
- [ ] Control points — `floorplans.spec.ts` › aligns a plan with control points snapped to OSM nodes
- [ ] Plans kept and exported — `floorplans.spec.ts` › exports plans in an archive with their PDF once, read back drawn again

### Saving

- [ ] Upload in one changeset — `upload.spec.ts` › uploads the edits in one changeset
- [ ] Conflicts merged or listed — `upload.spec.ts` › lists edits that clash with someone else's, and uploads the version kept
- [ ] Refused upload keeps the edits — `upload.spec.ts` › keeps the edits when the upload is refused
- [ ] Autosave and restore — `autosave.spec.ts` › edits come back after a reload, to undo as before
- [ ] Issues counted before upload — `operations.spec.ts` › counts the issues in the edits beside Save, checked in idle time (P6)

### Help, reach and languages

- [ ] Shortcuts — `help.spec.ts` › ? lists the shortcuts, operations included, and links to the help (P6)
- [ ] Help page — `help.spec.ts` › the help page explains the editor, section by section
- [ ] Open in IndoorID userscript — `userscript.spec.ts` › the userscript adds Open in IndoorID to openstreetmap.org's Edit menu
- [ ] JOSM's layer, read-only — `josm.spec.ts` › ?source=josm shows JOSM's active layer, goes to it, and never uploads
- [ ] Language menu — `language.spec.ts` › the header's language menu shows IndoorID in another language, kept on reload

## Manual

- [ ] Log in to openstreetmap.org (or the dev server, `api06.dev.openstreetmap.org`) with the
      release's `config.json`, upload a small edit, and open its changeset on the website.
- [ ] In JOSM (July 2025 or later) with Remote Control and "Export data from JOSM" on, open
      `/?source=josm`: the active layer shows, unsaved edits included.
- [ ] Install `/indoorid.user.js` in Violentmonkey or Tampermonkey, set IndoorID's address, and
      use "Open in IndoorID" on openstreetmap.org, an OSMCha changeset and indoorequal.org.
- [ ] "Preview in indoor=" on a building opens indoorequal.org showing it.
- [ ] Firefox and Safari: open a building, draw a room, import a PDF plan.
- [ ] `licenses.md` from the header lists the bundled packages.
