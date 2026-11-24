/**
 * Reads an OSM XML document (`.osm`), as JOSM writes a layer: new features with negative ids
 * and no version, deleted ones kept with `action="delete"` (or `visible="false"`), which are
 * left out. Pure, without `DOMParser`: the format is flat, a regular expression per tag is
 * enough. See https://wiki.openstreetmap.org/wiki/OSM_XML and JOSM's format,
 * https://wiki.openstreetmap.org/wiki/JOSM_file_format
 */
import { type Entity, type EntityType, type Member, makeId } from "./entity.ts";

/** An opening, self-closing or closing tag with its attributes. */
const TAG =
	/<(\/?)([A-Za-z]+)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const REFERENCE = /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

function decodeReferences(value: string): string {
	return value.replace(
		REFERENCE,
		(_, dec?: string, hex?: string, name?: string) =>
			dec !== undefined
				? String.fromCodePoint(Number(dec))
				: hex !== undefined
					? String.fromCodePoint(Number.parseInt(hex, 16))
					: (NAMED[name ?? ""] ?? ""),
	);
}

function attributes(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [, key = "", double, single] of text.matchAll(ATTRIBUTE)) {
		result[key] = decodeReferences(double ?? single ?? "");
	}
	return result;
}

const TYPES = new Set<string>(["node", "way", "relation"]);

interface Element {
	readonly type: EntityType;
	readonly attrs: Record<string, string>;
	readonly tags: Record<string, string>;
	readonly nodes: string[];
	readonly members: Member[];
}

function toEntity({
	type,
	attrs,
	tags,
	nodes,
	members,
}: Element): Entity | null {
	if (attrs.action === "delete" || attrs.visible === "false") return null;
	const osmId = Number(attrs.id);
	const common = {
		...(attrs.version === undefined ? {} : { version: Number(attrs.version) }),
		...(attrs.user === undefined ? {} : { user: attrs.user }),
		...(attrs.timestamp === undefined ? {} : { timestamp: attrs.timestamp }),
		tags,
	};
	switch (type) {
		case "node":
			return {
				type,
				id: makeId(type, osmId),
				...common,
				loc: [Number(attrs.lon), Number(attrs.lat)],
			};
		case "way":
			return {
				type,
				id: makeId(type, osmId),
				...common,
				nodes: nodes.map((ref) => makeId("node", Number(ref))),
			};
		case "relation":
			return { type, id: makeId(type, osmId), ...common, members };
	}
}

/** The features of an OSM XML document, those deleted left out. */
export function parseOsmXml(xml: string): Entity[] {
	const entities: Entity[] = [];
	let open: Element | null = null;
	for (const [, closing, name = "", attrText = "", selfClosing] of xml.matchAll(
		TAG,
	)) {
		if (TYPES.has(name)) {
			if (closing) {
				const entity = open && toEntity(open);
				if (entity) entities.push(entity);
				open = null;
				continue;
			}
			open = {
				type: name as EntityType,
				attrs: attributes(attrText),
				tags: {},
				nodes: [],
				members: [],
			};
			if (selfClosing) {
				const entity = toEntity(open);
				if (entity) entities.push(entity);
				open = null;
			}
			continue;
		}
		if (!open || closing) continue;
		const attrs = attributes(attrText);
		if (name === "tag" && attrs.k !== undefined) {
			open.tags[attrs.k] = attrs.v ?? "";
		} else if (name === "nd" && attrs.ref !== undefined) {
			open.nodes.push(attrs.ref);
		} else if (
			name === "member" &&
			attrs.type !== undefined &&
			TYPES.has(attrs.type)
		) {
			open.members.push({
				ref: makeId(attrs.type as EntityType, Number(attrs.ref)),
				role: attrs.role ?? "",
			});
		}
	}
	return entities;
}
