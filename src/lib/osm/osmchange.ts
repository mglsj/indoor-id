/**
 * Upload format of the OSM API 0.6: the osmChange document sent to
 * `/api/0.6/changeset/{id}/upload`, and the diffResult the server answers with.
 * See https://wiki.openstreetmap.org/wiki/API_v0.6#Diff_upload:_POST_/api/0.6/changeset/#id/upload
 */
import {
	type Entity,
	type EntityId,
	type EntityType,
	entityType,
	makeId,
	osmId,
	type Relation,
} from "./entity.ts";
import { Graph } from "./graph.ts";
import { escapeXml } from "./xml.ts";

const GENERATOR = "IndoorID";
const TYPE_ORDER: Record<EntityType, number> = { node: 0, way: 1, relation: 2 };

/**
 * Builds the osmChange for the local edits of `graph`. New entities keep their negative ids as
 * placeholders. Deletions use `if-unused`, so an entity that someone else started using in the
 * meantime is kept instead of failing the whole upload.
 */
export function buildOsmChange(graph: Graph, changesetId: number): string {
	const { created, modified, deleted } = graph.changes();
	const blocks: string[] = [];

	if (created.length > 0) {
		const ordered = withRelationsAfterMembers(
			sortByType(created, "newest-last"),
		);
		blocks.push(
			`<create>${ordered.map((e) => element(e, changesetId)).join("")}</create>`,
		);
	}
	if (modified.length > 0) {
		const ordered = sortByType(modified, "ascending");
		blocks.push(
			`<modify>${ordered.map((e) => element(e, changesetId)).join("")}</modify>`,
		);
	}
	if (deleted.length > 0) {
		const ordered = withRelationsBeforeMembers(
			sortByType(deleted, "ascending"),
		);
		blocks.push(
			`<delete if-unused="true">${ordered
				.map((e) => deletion(e, changesetId))
				.join("")}</delete>`,
		);
	}

	return `<osmChange version="0.6" generator="${GENERATOR}">${blocks.join("")}</osmChange>`;
}

export interface UploadResult {
	/** The graph as it now is on the server: real ids and versions, no local change left. */
	readonly graph: Graph;
	/** New id of each entity created by the upload. */
	readonly idMap: ReadonlyMap<EntityId, EntityId>;
	/** Entities the server kept because they are still used (deletion with `if-unused`). */
	readonly notDeleted: readonly EntityId[];
}

/** Who uploaded, and when: what the uploaded entities show as their last edit. */
export interface Uploader {
	readonly user?: string;
	/** ISO 8601. */
	readonly timestamp: string;
}

/** Applies the server's diffResult to the uploaded graph. */
export function applyDiffResult(
	graph: Graph,
	diffResult: string,
	uploader?: Uploader,
): UploadResult {
	const results = parseDiffResult(diffResult);
	const { created, modified, deleted } = graph.changes();

	for (const entity of [...created, ...modified, ...deleted]) {
		if (!results.has(entity.id)) {
			throw new Error(
				`The server did not report the upload result of ${entity.id}`,
			);
		}
	}

	const idMap = new Map<EntityId, EntityId>();
	for (const entity of created) {
		const newId = results.get(entity.id)?.newId;
		if (newId === undefined)
			throw new Error(`The server gave no id to ${entity.id}`);
		idMap.set(entity.id, makeId(entity.type, newId));
	}
	const remap = <T extends EntityId>(id: T): T =>
		(idMap.get(id) as T | undefined) ?? id;

	const entities: Entity[] = [];
	const withVersion = (entity: Entity): Entity => {
		const result = results.get(entity.id);
		const version = result?.newVersion ?? entity.version;
		// Written by the upload: last edited by the uploader, now.
		const edit =
			uploader && result?.newVersion !== undefined
				? {
						timestamp: uploader.timestamp,
						...(uploader.user ? { user: uploader.user } : {}),
					}
				: {};
		switch (entity.type) {
			case "node":
				return { ...entity, ...edit, id: remap(entity.id), version };
			case "way":
				return {
					...entity,
					...edit,
					id: remap(entity.id),
					version,
					nodes: entity.nodes.map(remap),
				};
			case "relation":
				return {
					...entity,
					...edit,
					id: remap(entity.id),
					version,
					members: entity.members.map((m) => ({ ...m, ref: remap(m.ref) })),
				};
		}
	};
	for (const entity of graph.entities()) entities.push(withVersion(entity));

	const notDeleted: EntityId[] = [];
	for (const entity of deleted) {
		if (results.get(entity.id)?.newId !== undefined) {
			notDeleted.push(entity.id);
			entities.push(withVersion(entity));
		}
	}

	return { graph: Graph.fromEntities(entities), idMap, notDeleted };
}

interface DiffEntry {
	readonly newId?: number;
	readonly newVersion?: number;
}

function parseDiffResult(xml: string): Map<EntityId, DiffEntry> {
	if (!xml.includes("<diffResult")) throw new Error("Not an OSM diffResult");
	const entries = new Map<EntityId, DiffEntry>();
	for (const [, type, attributes = ""] of xml.matchAll(
		/<(node|way|relation)\b([^>]*)>/g,
	)) {
		const attrs = Object.fromEntries(
			[...attributes.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, v]),
		);
		const oldId = Number(attrs.old_id);
		if (!Number.isInteger(oldId))
			throw new Error(`Invalid diffResult entry: ${attributes}`);
		entries.set(makeId(type as EntityType, oldId), {
			newId: attrs.new_id === undefined ? undefined : Number(attrs.new_id),
			newVersion:
				attrs.new_version === undefined ? undefined : Number(attrs.new_version),
		});
	}
	return entries;
}

function element(entity: Entity, changesetId: number): string {
	const attributes = [
		`id="${osmId(entity.id)}"`,
		`changeset="${changesetId}"`,
		...(entity.version === undefined ? [] : [`version="${entity.version}"`]),
		...(entity.type === "node"
			? [
					`lat="${coordinate(entity.loc[1])}"`,
					`lon="${coordinate(entity.loc[0])}"`,
				]
			: []),
	];
	const children = [...members(entity), ...tags(entity)];
	return `<${entity.type} ${attributes.join(" ")}>${children.join("")}</${entity.type}>`;
}

function deletion(entity: Entity, changesetId: number): string {
	return `<${entity.type} id="${osmId(entity.id)}" changeset="${changesetId}" version="${entity.version}"/>`;
}

function members(entity: Entity): string[] {
	switch (entity.type) {
		case "node":
			return [];
		case "way":
			return entity.nodes.map((ref) => `<nd ref="${osmId(ref)}"/>`);
		case "relation":
			return entity.members.map(
				(m) =>
					`<member type="${entityType(m.ref)}" ref="${osmId(m.ref)}" role="${escapeXml(m.role)}"/>`,
			);
	}
}

function tags(entity: Entity): string[] {
	return Object.entries(entity.tags).map(
		([k, v]) => `<tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`,
	);
}

/** Degrees with OSM's 7-decimal precision, never in exponent notation. */
function coordinate(value: number): string {
	return value.toFixed(7).replace(/\.?0+$/, "");
}

/** Nodes, then ways, then relations; newly created ones in creation order (-1, -2, ...). */
function sortByType(
	entities: readonly Entity[],
	order: "ascending" | "newest-last",
): Entity[] {
	const sign = order === "ascending" ? 1 : -1;
	return [...entities].sort(
		(a, b) =>
			TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
			sign * (osmId(a.id) - osmId(b.id)),
	);
}

/** Moves relations after the other relations of the list they contain. */
function withRelationsAfterMembers(entities: Entity[]): Entity[] {
	const relations = entities.filter(
		(e): e is Relation => e.type === "relation",
	);
	const byId = new Map(relations.map((r) => [r.id as EntityId, r]));
	const ordered: Relation[] = [];
	const visited = new Set<EntityId>();
	const visit = (relation: Relation) => {
		if (visited.has(relation.id)) return;
		visited.add(relation.id);
		for (const member of relation.members) {
			const child = byId.get(member.ref);
			if (child) visit(child);
		}
		ordered.push(relation);
	};
	relations.forEach(visit);
	return [...entities.filter((e) => e.type !== "relation"), ...ordered];
}

/** Deletion order: relations first (containers before contents), then ways, then nodes. */
function withRelationsBeforeMembers(entities: Entity[]): Entity[] {
	const relations = withRelationsAfterMembers(
		entities.filter((e) => e.type === "relation"),
	).reverse();
	const ways = entities.filter((e) => e.type === "way");
	const nodes = entities.filter((e) => e.type === "node");
	return [...relations, ...ways, ...nodes];
}
