/** Tags describing a changeset. See https://wiki.openstreetmap.org/wiki/Changeset#Tags_on_changesets */
import type { Tags } from "#lib/osm/tags.ts";

/** OSM rejects longer tag values. */
const MAX_LENGTH = 255;

/** OSM refuses a changeset with more changes (`changesets.maximum_elements`). */
export const MAX_CHANGESET_CHANGES = 10_000;

export interface ChangesetDescription {
	readonly comment: string;
	readonly source?: string;
	/** Names of the imagery shown while editing. */
	readonly imagery: readonly string[];
	readonly reviewRequested: boolean;
}

export function changesetTags(description: ChangesetDescription): Tags {
	const tags: Record<string, string> = {};
	const set = (key: string, value: string | undefined) => {
		const v = value?.trim();
		if (v) tags[key] = v.slice(0, MAX_LENGTH);
	};
	set("comment", description.comment);
	set("source", description.source);
	set("imagery_used", description.imagery.join(";"));
	set(
		"hashtags",
		(description.comment.match(/#[\p{L}\p{N}_-]+/gu) ?? []).join(";"),
	);
	if (description.reviewRequested) tags.review_requested = "yes";
	return tags;
}
