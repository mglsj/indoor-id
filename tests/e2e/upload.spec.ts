import type { Page, Route } from "@playwright/test";
import {
	camera,
	clickMap,
	expect,
	INDOOR,
	inspector,
	LAT,
	LON,
	mapDrawn,
	room,
	selectRoom,
	serveOsm,
	tagsBox,
	test,
	WORLD,
} from "./fixtures.ts";

const API = "https://api.openstreetmap.org";
const WEBSITE = "https://www.openstreetmap.org";

/** Turns login on, as if the user had logged in before. */
async function loggedIn(page: Page) {
	await page.route("**/config.json", async (route) => {
		const response = await route.fetch();
		const config = await response.json();
		await route.fulfill({
			response,
			json: { ...config, oauth_client_id: "test-client" },
		});
	});
	await page.addInitScript(
		(key) => localStorage.setItem(key, "secret-token"),
		`${WEBSITE}oauth2_access_token`,
	);
	await page.route(`${API}/api/0.6/user/details.json`, (route) =>
		route.fulfill({ json: { user: { display_name: "Tester" } } }),
	);
}

/** A mocked changeset API recording what is sent. */
async function changesetApi(
	page: Page,
	upload: (route: Route) => Promise<void>,
) {
	const requests: {
		method: string;
		path: string;
		body: string | null;
		auth: string | null;
	}[] = [];
	await page.route(`${API}/api/0.6/changeset/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		requests.push({
			method: request.method(),
			path,
			body: request.postData(),
			auth: await request.headerValue("Authorization"),
		});
		if (path.endsWith("/create")) return route.fulfill({ body: "42" });
		if (path.endsWith("/upload")) return upload(route);
		return route.fulfill({ body: "" });
	});
	return requests;
}

async function editRoomNumber(page: Page) {
	const editor = await selectRoom(page);
	const roomNumber = editor.getByRole("textbox", { name: "Room Number" });
	await roomNumber.fill("B12");
	await roomNumber.press("Enter");
	await expect(page.getByTestId("edit-count")).toHaveText("1");
}

test("uploads the edits in one changeset", async ({ page }) => {
	await loggedIn(page);
	const requests = await changesetApi(page, (route) =>
		route.fulfill({
			body: '<diffResult version="0.6"><way old_id="100" new_id="100" new_version="2"/></diffResult>',
		}),
	);
	await editRoomNumber(page);

	await page.getByRole("button", { name: /Save/ }).click();
	const dialog = page.getByRole("dialog", { name: "Upload your edits" });
	await expect(dialog).toContainText("Logged in as Tester");
	await dialog
		.getByRole("textbox", { name: "Comment" })
		.fill("Add room number #indoor");
	await dialog.getByRole("button", { name: "Upload" }).click();

	await expect(dialog.getByRole("status")).toContainText("changeset 42");
	expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
		"PUT /api/0.6/changeset/create",
		"POST /api/0.6/changeset/42/upload",
		"PUT /api/0.6/changeset/42/close",
	]);
	expect(requests.every((r) => r.auth === "Bearer secret-token")).toBe(true);
	expect(requests[0]?.body).toContain(
		'<tag k="comment" v="Add room number #indoor"/>',
	);
	expect(requests[0]?.body).toContain('<tag k="hashtags" v="#indoor"/>');
	expect(requests[1]?.body).toBe(
		'<osmChange version="0.6" generator="IndoorID"><modify>' +
			'<way id="100" changeset="42" version="1">' +
			'<nd ref="101"/><nd ref="102"/><nd ref="103"/><nd ref="104"/><nd ref="101"/>' +
			'<tag k="indoor" v="room"/><tag k="level" v="0"/><tag k="ref" v="B12"/>' +
			"</way></modify></osmChange>",
	);

	await dialog.getByRole("button", { name: "Close" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("0");
	await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nref=B12",
	);
});

test("keeps the edits when the upload is refused", async ({ page }) => {
	await loggedIn(page);
	const requests = await changesetApi(page, (route) =>
		route.fulfill({
			status: 409,
			body: "Version mismatch: Provided 1, server had: 2 of Way 100",
		}),
	);
	await editRoomNumber(page);

	await page.getByRole("button", { name: /Save/ }).click();
	const dialog = page.getByRole("dialog", { name: "Upload your edits" });
	await dialog
		.getByRole("textbox", { name: "Comment" })
		.fill("Add room number");
	await dialog.getByRole("button", { name: "Upload" }).click();

	await expect(dialog.getByRole("alert")).toContainText(
		"Someone else changed w100 while you were uploading",
	);
	expect(requests.at(-1)?.path).toBe("/api/0.6/changeset/42/close");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
});

test("lists edits that clash with someone else's, and uploads the version kept", async ({
	page,
}) => {
	await loggedIn(page);
	const requests = await changesetApi(page, (route) =>
		route.fulfill({
			body: '<diffResult version="0.6"><way old_id="100" new_id="100" new_version="3"/></diffResult>',
		}),
	);
	await editRoomNumber(page);
	// Meanwhile Ana numbered the room too, and named it.
	await page.route("**/api/0.6/ways.json?*", (route) =>
		route.fulfill({
			json: {
				version: "0.6",
				elements: [
					{
						type: "way",
						id: 100,
						version: 2,
						user: "Ana",
						nodes: [101, 102, 103, 104, 101],
						tags: { indoor: "room", level: "0", ref: "B11", name: "Lab" },
					},
				],
			},
		}),
	);

	await page.getByRole("button", { name: /Save/ }).click();
	const dialog = page.getByRole("dialog", { name: "Upload your edits" });
	await dialog.getByRole("textbox", { name: "Comment" }).fill("Room number");
	await dialog.getByRole("button", { name: "Upload" }).click();

	const conflicts = dialog.getByRole("note", {
		name: "Someone else changed the same features",
	});
	await expect(conflicts).toContainText("(w100)");
	await expect(conflicts).toContainText("You and Ana both changed ref.");
	await expect(dialog.getByRole("button", { name: "Upload" })).toBeDisabled();
	expect(requests).toEqual([]);

	await conflicts.getByRole("button", { name: "Keep mine" }).click();
	await expect(conflicts).toBeHidden();
	await dialog.getByRole("button", { name: "Upload" }).click();
	await expect(dialog.getByRole("status")).toContainText("changeset 42");
	// Their name is kept with my number, sent over their version.
	expect(requests[1]?.body).toContain(
		'<way id="100" changeset="42" version="2">',
	);
	expect(requests[1]?.body).toContain('<tag k="name" v="Lab"/>');
	expect(requests[1]?.body).toContain('<tag k="ref" v="B12"/>');
});

test("explains that login is not set up on this instance", async ({ page }) => {
	// The shipped config.json has a client id: serve one without it.
	await page.route("**/config.json", async (route) => {
		const response = await route.fetch();
		const { oauth_client_id: _, ...config } = await response.json();
		await route.fulfill({ response, json: config });
	});
	await editRoomNumber(page);
	await page.getByRole("button", { name: /Save/ }).click();
	const dialog = page.getByRole("dialog", { name: "Upload your edits" });
	await expect(dialog).toContainText("Login is not configured");
	await expect(dialog.getByRole("button", { name: "Upload" })).toBeDisabled();
});

test("gets out of a login whose window was closed", async ({ page }) => {
	await page.route("**/config.json", async (route) => {
		const response = await route.fetch();
		const config = await response.json();
		await route.fulfill({
			response,
			json: { ...config, oauth_client_id: "test-client" },
		});
	});
	await editRoomNumber(page);
	await page.getByRole("button", { name: /Save/ }).click();
	const dialog = page.getByRole("dialog", { name: "Upload your edits" });
	await dialog
		.getByRole("textbox", { name: "Comment" })
		.fill("Add room number");
	const popup = page.waitForEvent("popup");
	await dialog.getByRole("button", { name: "Upload" }).click();
	await expect(dialog.getByRole("button", { name: "Cancel" })).toBeEnabled();
	await (await popup).close();

	await expect(dialog.getByRole("alert")).toContainText(
		"The login window was closed",
	);
	await expect(dialog.getByRole("button", { name: "Upload" })).toBeEnabled();
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
});

test("asks before leaving the page with edits not uploaded", async ({
	page,
}) => {
	await editRoomNumber(page);
	const asked = new Promise<string>((resolve) =>
		page.once("dialog", async (dialog) => {
			resolve(dialog.type());
			await dialog.dismiss();
		}),
	);
	void page.reload().catch(() => undefined);
	expect(await asked).toBe("beforeunload");
	await expect(page.getByTestId("edit-count")).toHaveText("1");
});

test("lists the changes, showing one on the map from the dialog", async ({
	page,
}) => {
	await editRoomNumber(page);
	await page.getByRole("button", { name: "Done" }).click();
	const before = await camera(page);

	await page.getByRole("button", { name: /Save/ }).click();
	const dialog = page.getByRole("dialog", { name: "Upload your edits" });
	const change = dialog
		.getByTestId("changes")
		.getByRole("button", { name: /Room B12/ });
	await expect(change).toContainText("Modified");
	await change.hover();
	await change.click();
	// The dialog stays open; the map fits the room in the part it leaves visible.
	await expect(dialog).toBeVisible();
	await expect
		.poll(async () => (await camera(page)).zoom)
		.not.toBe(before.zoom);
});

test("points out the corner an issue is at, and selects its feature", async ({
	page,
}) => {
	// Two rooms meeting at a side on different levels; moving one to level 0 leaves their
	// corners on the same spots without being joined.
	const r = 0.0001;
	await serveOsm(page, [
		...room(100, LON, LAT, "0", r),
		...room(200, LON + 2 * r, LAT, "1", r),
	]);
	await page.goto(`/#19/${LAT}/${LON}/1${INDOOR}`);
	await camera(page);
	await mapDrawn(page);
	const pixels = (2 * r * WORLD) / 360;
	await clickMap(page, pixels, 0);
	const tags = await tagsBox(page);
	await tags.fill("indoor=room\nlevel=0");
	await tags.blur();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
	await page.getByRole("button", { name: "Done" }).click();

	await page.getByRole("button", { name: /Save/ }).click();
	const dialog = page.getByRole("dialog", { name: "Upload your edits" });
	const issue = dialog
		.getByRole("list", { name: "Issues in your edits" })
		.getByRole("button")
		.first();
	await expect(issue).toContainText("Room");
	await issue.hover();
	await issue.click();
	await expect(dialog).toBeHidden();
	await expect(inspector(page).root).toContainText("w200");
});
