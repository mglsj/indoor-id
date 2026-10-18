import { describe, expect, it } from "vitest";
import { MessageError, msg, t } from "./messages.ts";

describe("messages: text shown to users, as keys with params", () => {
	it("renders a message in English, its params in place", () => {
		expect(t(msg("undo_change_tags"))).toBe("Change tags");
		expect(t(msg("fix_set_level", { level: "0;1" }))).toBe("Set level=0;1");
		expect(t(msg("issue_unreadable_level", { key: "level", value: "G" }))).toBe(
			"level=G can't be read. Use numbers like 0, -1, 0.5, lists like 0;1 or ranges like 0-2.",
		);
	});

	it("keeps the key and params, for translations later", () => {
		expect(msg("undo_change_preset", { preset: "Room" })).toEqual({
			key: "undo_change_preset",
			params: { preset: "Room" },
		});
	});

	it("checks keys and params when compiled", () => {
		// @ts-expect-error: no such message.
		msg("no_such_message");
		// @ts-expect-error: the level is missing.
		msg("fix_set_level");
		// @ts-expect-error: a param of another message.
		msg("fix_set_level", { preset: "Room" });
		// @ts-expect-error: this message takes no params.
		msg("undo_change_tags", { level: "1" });
		expect(true).toBe(true);
	});

	it("throws errors carrying their message, read in English as any error", () => {
		const error = new MessageError(msg("plan_import_pdf_unreadable"));
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toBe("This PDF could not be read.");
		expect(error.msg.key).toBe("plan_import_pdf_unreadable");
	});
});
