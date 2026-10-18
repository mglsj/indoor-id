import type { Page } from "@playwright/test";
import {
	camera,
	type Element,
	expect,
	inspector,
	LAT,
	LON,
	room,
	selectRoom,
	test,
} from "./fixtures.ts";

/** A storage room 0.01° east, only sent with its relation (not in the area downloaded). */
const STORAGE = room(200, LON + 0.01, LAT, "0").map((e) =>
	e.type === "way"
		? { ...e, tags: { ...(e.tags as object), name: "Storage" } }
		: e,
);

/**
 * The room (w100) is in a site, Campus (r1), with the storage room (not downloaded) as its
 * entrance; another site, Annex (r2), holds one of the room's corners.
 */
function relations(): Element[] {
	return [
		...room(100, LON, LAT, "0"),
		{
			type: "relation",
			id: 1,
			version: 1,
			members: [
				{ type: "way", ref: 100, role: "" },
				{ type: "way", ref: 200, role: "entrance" },
			],
			tags: { type: "site", name: "Campus" },
		},
		{
			type: "relation",
			id: 2,
			version: 1,
			members: [{ type: "node", ref: 101, role: "" }],
			tags: { type: "site", name: "Annex" },
		},
	];
}

/** Serves Campus with all its members, as the API's `/relation/1/full`. */
async function serveFull(page: Page) {
	await page.route("**/api/0.6/relation/1/full.json", (route) =>
		route.fulfill({
			json: { version: "0.6", elements: [...STORAGE, relations()[5]] },
		}),
	);
}

/** Serves taginfo's roles for relations of each type. */
async function serveRoles(page: Page, roles: Record<string, string[]>) {
	await page.route(
		"https://taginfo.openstreetmap.org/api/4/relation/roles?*",
		(route) => {
			const url = new URL(route.request().url());
			const data = (roles[url.searchParams.get("rtype") ?? ""] ?? []).map(
				(role) => ({
					role,
					count_node_members_fraction: 0.5,
					count_way_members_fraction: 0.5,
					count_relation_members_fraction: 0.5,
				}),
			);
			return route.fulfill({ json: { data } });
		},
	);
}

const section = (page: Page, name: RegExp) => inspector(page).section(name);

test("Relations lists the feature's relations: a role is changed, a membership removed", async ({
	page,
}) => {
	await serveRoles(page, { site: ["entrance", "perimeter"] });
	const editor = await selectRoom(page, {}, relations());
	await expect(section(page, /^Relations \(1\)$/)).toBeVisible();
	const memberships = editor.getByRole("list", { name: "Relations" });
	await expect(memberships.getByRole("listitem")).toHaveCount(1);

	const role = memberships.getByRole("combobox", {
		name: "Role in Relation Campus",
	});
	await expect(role).toHaveValue("");
	await role.click();
	await role.press("ArrowDown");
	await page.getByRole("option", { name: "perimeter" }).click();
	await expect(role).toHaveValue("perimeter");
	await expect(page.getByTestId("edit-count")).toHaveText("1");

	await memberships
		.getByRole("button", { name: "Remove from Relation Campus" })
		.click();
	await expect(section(page, /^Relations \(0\)$/)).toBeVisible();
	await expect(memberships.getByRole("listitem")).toHaveCount(0);
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(section(page, /^Relations \(1\)$/)).toBeVisible();
});

test("a feature is added to a relation in view, or to a new one", async ({
	page,
}) => {
	const editor = await selectRoom(page, {}, relations());
	const memberships = editor.getByRole("list", { name: "Relations" });

	await editor.getByRole("button", { name: "Add to a relation" }).click();
	const choose = editor.getByRole("combobox", {
		name: "Choose a parent relation",
	});
	await expect(choose).toBeFocused();
	await choose.press("ArrowDown");
	// A new one first, then those in view, the newest first.
	await expect(page.getByRole("option")).toHaveText([
		"New relation…",
		"Relation Annex",
		"Relation Campus",
	]);
	await choose.press("Escape");
	await editor
		.getByRole("combobox", { name: "Role in the new relation" })
		.fill("level");
	await choose.fill("ann");
	await expect(page.getByRole("option")).toHaveText([
		"New relation…",
		"Relation Annex",
	]);
	await page.getByRole("option", { name: "Relation Annex" }).click();
	await expect(section(page, /^Relations \(2\)$/)).toBeVisible();
	// Added last, with its role.
	await expect(
		memberships.getByRole("combobox", { name: "Role in Relation Annex" }),
	).toHaveValue("level");
	await expect(memberships.getByRole("listitem").last()).toContainText("Annex");

	await editor.getByRole("button", { name: "Add to a relation" }).click();
	await choose.press("ArrowDown");
	await page.getByRole("option", { name: "New relation…" }).click();
	// The new relation is selected, its type to choose.
	await expect(
		editor.getByRole("heading", { name: "Select feature type" }),
	).toBeVisible();
	await editor.getByRole("button", { name: "Back to the feature" }).click();
	await expect(editor.getByText(/^r-\d+$/)).toBeVisible();
	await expect(section(page, /^Members \(1\)$/)).toBeVisible();
	await expect(page.getByTestId("edit-count")).toHaveText("2");
});

test("Members lists a relation's members: download, select, zoom, role, reorder, remove", async ({
	page,
}) => {
	await serveFull(page);
	const editor = await selectRoom(page, {}, relations());
	await editor
		.getByRole("list", { name: "Relations" })
		.getByRole("button", { name: "Relation Campus", exact: true })
		.click();
	await expect(editor.getByText("r1", { exact: true })).toBeVisible();
	const members = editor.getByRole("list", { name: "Members" });
	await expect(section(page, /^Members \(2\)$/)).toBeVisible();
	await expect(members.getByRole("listitem")).toHaveText([
		/^\s*Room(?! Storage)/,
		/Way w200.*incomplete/,
	]);

	await members.getByRole("button", { name: "Download the members" }).click();
	await expect(members.getByRole("listitem")).toHaveText([
		/^\s*Room(?! Storage)/,
		/^\s*Room Storage/,
	]);
	await expect(
		members.getByRole("combobox", { name: "Role of Room Storage" }),
	).toHaveValue("entrance");

	// Reordered with the keyboard, then back by dragging.
	const first = members.getByRole("combobox", {
		name: "Role of Room",
		exact: true,
	});
	await first.focus();
	await page.keyboard.press("Alt+ArrowDown");
	await expect(members.getByRole("listitem")).toHaveText([
		/^\s*Room Storage/,
		/^\s*Room(?! Storage)/,
	]);
	await expect(first).toBeFocused();
	await members
		.getByRole("button", { name: "Move Room", exact: true })
		.dragTo(members.getByRole("listitem").first());
	await expect(members.getByRole("listitem")).toHaveText([
		/^\s*Room(?! Storage)/,
		/^\s*Room Storage/,
	]);

	await first.fill("main");
	await first.press("Enter");
	await expect(first).toHaveValue("main");
	await expect(page.getByTestId("edit-count")).toHaveText("1");

	// Zoom to the storage room, 0.01° east.
	await members.getByRole("button", { name: "Zoom to Room Storage" }).click();
	await expect
		.poll(async () => {
			const { lon } = await camera(page);
			return Math.round((lon - LON) * 1000);
		})
		.toBeGreaterThan(5);

	await members.getByRole("button", { name: "Remove Room Storage" }).click();
	await expect(section(page, /^Members \(1\)$/)).toBeVisible();
	await members.getByRole("button", { name: "Room", exact: true }).click();
	await expect(editor.getByText("w100", { exact: true })).toBeVisible();
});

test("removing a relation's last member deletes it", async ({ page }) => {
	const editor = await selectRoom(page, {}, relations());
	await editor
		.getByRole("list", { name: "Relations" })
		.getByRole("button", { name: "Relation Campus", exact: true })
		.click();
	const members = editor.getByRole("list", { name: "Members" });
	await members
		.getByRole("button", { name: "Remove Room", exact: true })
		.click();
	await members.getByRole("button", { name: /^Remove Way w200/ }).click();
	await expect(editor).toBeHidden();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
});
