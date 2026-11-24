# Announcement draft: IndoorID 0.1 alpha

A draft only, not posted. It's meant for the OpenStreetMap community forum, under Software (tag
`indoor`), and could be shortened for the OSM Weekly and the indoor mapping channels. Before
posting, fill in the bracketed parts: the address IndoorID is hosted at, and screenshots.

---

**IndoorID 0.1 alpha: a new editor for indoor mapping**

Hello all,

IndoorID is a new web editor for mapping the inside of buildings with
[Simple Indoor Tagging](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging). Its first
alpha is out: [address].

It runs in the browser with OpenStreetMap as its only backend, and it works the way iD does
(selection, the side panel, presets, shortcuts), with tools for the inside of buildings:

- **Building mode**: double-click a building to edit it level by level. The level switcher lists
  every floor `building:levels` counts, mapped or not.
- **Precise drawing**: snapping to sides, corners and angles; typed lengths; rectangles; a grid
  in the building's own frame; construction guides. Doors snap onto walls. Empty floor between
  rooms can be mapped in one click.
- **Floor plans**: import an image, an SVG or a PDF and trace over it. A CAD PDF is drawn from
  its lines, sharp at any zoom, with its layers. Align plans with control points snapped to OSM
  nodes. Plans stay in your browser and can be exported as a file to share.
- **Tagging**: iD's presets and fields, with the indoor types first. Taginfo suggestions, the wiki's
  documentation behind ⓘ, and one-click fixes for outdated or unreadable `level` values.
- **Operations**: merge, split, repeat on levels, rooms with holes, straighten, make symmetric,
  copy and paste. All of them are in the toolbar and in a right-click menu.
- **Safe saving**: edits are saved in the browser as you go. Before an upload, someone else's
  changes are merged and any conflicts are listed for you to settle. Each upload is a single
  changeset, and no tag you didn't edit is changed.
- **A viewer** at /view that needs no account, to browse indoor maps and find a room by name or
  number.
- **From other tools**: an "Open in IndoorID" userscript for openstreetmap.org, OSMCha and indoor=,
  and `?source=josm` to look at JOSM's layer, unsaved edits included.

[Screenshots: a building in building mode; a PDF plan being traced; the viewer.]

It is an alpha: expect rough edges, and please save often. The interface can be switched to
Czech, German, Spanish, French, Hungarian or Italian. Feature types are already translated
(from iD's schema), but the rest of the interface still needs translators.

IndoorID started from Adrien Pavie's OsmInEdit, sponsored by Daimler AG, and still opens
OsmInEdit's links and floor plan files. It also takes ideas from osm-simple3d-editor, and its
presets come from iD's tagging schema.

Code, issues and ideas: https://github.com/mglsj/indoor-id. Feedback from indoor mappers is the
most useful thing right now: what is missing, what gets in the way, and which buildings you
tried it on.
