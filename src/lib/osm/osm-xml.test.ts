import { describe, expect, it } from "vitest";
import { parseOsmXml } from "./osm-xml.ts";

// As JOSM writes a layer (OsmWriter): single quotes, new features with negative ids and no
// version, edits marked with `action`.
const JOSM_LAYER = `<?xml version='1.0' encoding='UTF-8'?>
<osm version='0.6' generator='JOSM'>
  <bounds minlat='51.5' minlon='-0.1' maxlat='51.6' maxlon='0.0' origin='CGImap 0.9.3' />
  <node id='-101' action='modify' visible='true' lat='51.5001' lon='-0.0999' />
  <node id='42' timestamp='2024-05-01T10:00:00Z' uid='7' user='Ann' visible='true' version='3' changeset='9' lat='51.5002' lon='-0.0998'>
    <tag k='name' v='Caf&#233; &amp; &quot;Bar&quot; &lt;1&gt;' />
    <tag k='door' v='hinged' />
  </node>
  <node id='43' action='delete' visible='true' version='1' lat='51.5' lon='-0.1' />
  <way id='-102' action='modify' visible='true'>
    <nd ref='-101' />
    <nd ref='42' />
    <tag k='indoor' v='wall' />
  </way>
  <relation id='77' visible='true' version='2'>
    <member type='way' ref='-102' role='outer' />
    <member type='node' ref='42' role='' />
    <tag k='type' v='multipolygon' />
  </relation>
</osm>`;

describe("parseOsmXml", () => {
	it("reads nodes, ways and relations, with their tags and who last changed them", () => {
		const entities = parseOsmXml(JOSM_LAYER);
		expect(entities.map((e) => e.id)).toEqual(["n-101", "n42", "w-102", "r77"]);
		expect(entities[1]).toEqual({
			type: "node",
			id: "n42",
			version: 3,
			user: "Ann",
			timestamp: "2024-05-01T10:00:00Z",
			tags: { name: 'Café & "Bar" <1>', door: "hinged" },
			loc: [-0.0998, 51.5002],
		});
		expect(entities[2]).toEqual({
			type: "way",
			id: "w-102",
			tags: { indoor: "wall" },
			nodes: ["n-101", "n42"],
		});
		expect(entities[3]).toMatchObject({
			members: [
				{ ref: "w-102", role: "outer" },
				{ ref: "n42", role: "" },
			],
			tags: { type: "multipolygon" },
		});
	});

	it("leaves out what was deleted (an action or not visible)", () => {
		const entities = parseOsmXml(
			`<osm><node id="1" lat="0" lon="0" visible="false" version="2"/><node id="2" lat="1" lon="2" action="delete"/><node id="3" lat="1" lon="2"/></osm>`,
		);
		expect(entities.map((e) => e.id)).toEqual(["n3"]);
	});

	it("reads double-quoted attributes and hexadecimal references", () => {
		const [node] = parseOsmXml(
			`<osm><node id="5" lat="1.5" lon="2.5"><tag k="note" v="a&#x0A;b"/></node></osm>`,
		);
		expect(node).toMatchObject({ loc: [2.5, 1.5], tags: { note: "a\nb" } });
	});

	it("reads an empty document as no data", () => {
		expect(parseOsmXml("")).toEqual([]);
	});
});
