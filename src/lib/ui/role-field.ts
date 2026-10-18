import type { SuggestedValue } from "#lib/presets/combo.ts";
import type { Field } from "#lib/presets/presets.ts";
import type { FieldContext } from "#lib/ui/field-context.ts";

/** A member's role input, as a combo of the roles taginfo knows (iD's `member-role`). */
export function roleField(id: string, placeholder = "Role"): Field {
	return {
		id,
		type: "combo",
		label: "Role",
		placeholder,
		options: [],
		terms: [],
		universal: false,
		snakeCase: false,
		caseSensitive: true,
		customValues: true,
		autoSuggestions: true,
		allowDuplicates: false,
	};
}

export function roleContext(
	suggest: ((query: string) => Promise<readonly SuggestedValue[]>) | undefined,
): FieldContext {
	return {
		deprecated: () => [],
		suggest: suggest && ((_: Field, query: string) => suggest(query)),
	};
}
