# IndoorID

IndoorID is a web tool for editing indoor data in OpenStreetMap: rooms, corridors, doors, stairs and everything else inside buildings, level by level.

## Purpose

IndoorID aims to make [indoor data editing](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging) easy on OpenStreetMap, ideally being as good as the [iD editor](https://github.com/openstreetmap/iD), but focused on building indoors. Its main goals are a fast map, easy alignment of floor plans, and tagging that follows the current OSM wiki.

If you are looking for an indoor data viewer (a map for browsing existing data), have a look at [OpenLevelUp](https://openlevelup.net/).

> **Alpha (0.1).** IndoorID is a new editor, built with Svelte, MapLibre GL JS and an OpenStreetMap-native data model. It is early: expect missing features and rough edges, and see the [plan](plan.md) for progress.

## Contributing

This project is an open source tool, meaning it is made by volunteers. If you **want to help us**, there are several ways (technical or non-technical ones). Issues and pull requests are welcome on [GitHub](https://github.com/mglsj/indoor-id).

## Develop/run your own instance

To run your own instance of IndoorID, or work on its development, read the [develop documentation](DEVELOP.md).

## Credits

IndoorID started from [OsmInEdit](https://framagit.org/PanierAvide/osminedit) by Adrien Pavie,
sponsored by Daimler AG. Its map icons and help images come from OsmInEdit, and IndoorID still
opens OsmInEdit links and floor plan files.

Ideas for floor plan editing and level heights come from
[osm-simple3d-editor](https://github.com/FelisPimeja/osm-simple3d-editor) (ISC). Presets and
fields come from iD's [tagging schema](https://github.com/openstreetmap/id-tagging-schema)
(ISC), and icons from [Maki](https://github.com/mapbox/maki) and
[Temaki](https://github.com/rapideditor/temaki) (CC0).

## License

Copyright (c) 2026 IndoorID contributors

Released under the ISC license, see [LICENSE](LICENSE.md) for the full text and the notices of
third-party code and assets.
