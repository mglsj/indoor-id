# IndoorID

IndoorID is a web tool for editing indoor data in OpenStreetMap: rooms, corridors, doors, stairs and everything else inside buildings, level by level.

## Purpose

IndoorID aims to make [indoor data editing](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging) easy on OpenStreetMap, ideally being as good as the [iD editor](https://github.com/openstreetmap/iD), but focused on building indoors. Its main goals are a fast map, easy alignment of floor plans, and tagging that follows the current OSM wiki.

If you are looking for an indoor data viewer (a map for browsing existing data), have a look at [OpenLevelUp](https://openlevelup.net/).

> **Work in progress.** IndoorID is a rewrite of [OsmInEdit](https://framagit.org/PanierAvide/osminedit) with Svelte, MapLibre GL JS and an OpenStreetMap-native data model. It is not usable for editing yet: see the [plan](plan.md) for progress. The last release of OsmInEdit is kept under the git tag `legacy-v1.0.16`.

## Contributing

This project is an open source tool, meaning it is made by volunteers. If you **want to help us**, there are several ways (technical or non-technical ones). Issues and pull requests are welcome on [GitHub](https://github.com/mglsj/indoor-id).

## Develop/run your own instance

To run your own instance of IndoorID, or work on its development, read the [develop documentation](DEVELOP.md).

## Contributors

IndoorID builds on OsmInEdit, which exists thanks to the **amazing people** following:

- Adrien Pavie, main developer of OsmInEdit
- Daimler AG team, for sponsoring and leading the project
- Florian Lainez, for improving the user experience
- Thomas Gratier, for his work on [osm-request](https://github.com/osmlab/osm-request) library
- And all users, for using the tool and sharing their ideas !

Presets and fields come from iD's [tagging schema](https://github.com/openstreetmap/id-tagging-schema)
(ISC), and icons from [Maki](https://github.com/mapbox/maki) and
[Temaki](https://github.com/rapideditor/temaki) (CC0).

## License

Copyright (c) Adrien Pavie 2019

Copyright (c) Daimler AG 2019

Copyright (c) IndoorID contributors 2026

Released under ISC license, see [LICENSE](LICENSE.md) for complete license text.
