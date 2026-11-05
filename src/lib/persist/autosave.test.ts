import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { type Message, msg } from "#lib/i18n/messages.ts";
import { node } from "#lib/osm/fixtures.ts";
import { Graph } from "#lib/osm/graph.ts";
import { History } from "#lib/osm/history.ts";
import { saveHistory } from "#lib/osm/history-json.ts";
import { Autosave, type AutosaveOptions, type SavedEdits } from "./autosave.ts";

let name = "";
let count = 0;
afterEach(() => indexedDB.deleteDatabase(name));

/** A browser: one localStorage, a clock, and a database shared by its tabs. */
function browser() {
	name = `edits-test-${count++}`;
	const local = memoryStorage();
	const clock = { now: 1_000_000 };
	/** A tab; give the same sessionStorage to reload it. */
	const tab = (session = memoryStorage()) => {
		const options: AutosaveOptions = {
			database: name,
			local,
			session,
			now: () => clock.now,
		};
		return { autosave: new Autosave(options), session };
	};
	return { tab, clock };
}

function memoryStorage(): Storage {
	const items = new Map<string, string>();
	return {
		get length() {
			return items.size;
		},
		clear: () => items.clear(),
		getItem: (key) => items.get(key) ?? null,
		key: (i) => [...items.keys()][i] ?? null,
		removeItem: (key) => void items.delete(key),
		setItem: (key, value) => void items.set(key, String(value)),
	};
}

/** Edits: n1 tagged. */
function edits(name = "Edited"): SavedEdits["history"] {
	const history = new History<Message>(Graph.fromEntities([node("n1")]));
	history.perform(
		(g) => g.replace(node("n1", { name })),
		msg("undo_change_tags"),
	);
	return saveHistory(history);
}

describe("Autosave", () => {
	it("gives the edits back to the same tab after a reload", async () => {
		const { tab } = browser();
		const first = tab();
		await first.autosave.save(edits());

		const reloaded = tab(first.session);
		const [found, ...others] = await reloaded.autosave.restorable();

		expect(others).toEqual([]);
		expect(found?.history).toEqual(edits());
		expect(found?.saved).toBe(1_000_000);
	});

	it("keeps another open tab's edits from a new tab", async () => {
		const { tab, clock } = browser();
		const open = tab();
		await open.autosave.save(edits());
		clock.now += 15_000;
		open.autosave.heartbeat();
		clock.now += 15_000;

		expect(await tab().autosave.restorable()).toEqual([]);
	});

	it("offers the edits of a tab silent for 20 s to a new tab, once", async () => {
		const { tab, clock } = browser();
		const closed = tab();
		await closed.autosave.save(edits());
		clock.now += 20_001;

		const next = tab();
		const [found] = await next.autosave.restorable();
		expect(found?.history).toEqual(edits());
		const other = tab();
		expect(await other.autosave.restorable()).toHaveLength(1);

		// The first tab to claim them gets them; the other then finds nothing.
		expect(await next.autosave.claim(found as SavedEdits)).toBe(true);
		expect(await other.autosave.claim(found as SavedEdits)).toBe(false);
		expect(await other.autosave.restorable()).toEqual([]);
	});

	it("keeps claimed edits under the tab that claimed them", async () => {
		const { tab, clock } = browser();
		const closed = tab();
		await closed.autosave.save(edits());
		clock.now += 20_001;
		const next = tab();
		const [found] = await next.autosave.restorable();
		await next.autosave.claim(found as SavedEdits);

		const reloaded = tab(next.session);
		const [again] = await reloaded.autosave.restorable();

		expect(again?.history).toEqual(edits());
	});

	it("replaces the tab's edits on each save, and clears them", async () => {
		const { tab } = browser();
		const first = tab();
		await first.autosave.save(edits("One"));
		await first.autosave.save(edits("Two"));

		const [found, ...others] = await tab(first.session).autosave.restorable();
		expect(others).toEqual([]);
		expect(found?.history).toEqual(edits("Two"));

		await first.autosave.clear();
		expect(await tab(first.session).autosave.restorable()).toEqual([]);
	});

	it("keeps the open changeset with the edits", async () => {
		const { tab } = browser();
		const first = tab();
		await first.autosave.save(edits(), { changeset: 42 });

		const [found] = await tab(first.session).autosave.restorable();

		expect(found?.changeset).toBe(42);
	});
});
