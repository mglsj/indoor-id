import type { Page, Route } from "@playwright/test";
import { expect, selectRoom, tagsBox, test } from "./fixtures.ts";

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
		"Someone else changed the same data",
	);
	expect(requests.at(-1)?.path).toBe("/api/0.6/changeset/42/close");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByTestId("edit-count")).toHaveText("1");
});

test("explains that login is not set up on this instance", async ({ page }) => {
	await editRoomNumber(page);
	await page.getByRole("button", { name: /Save/ }).click();
	const dialog = page.getByRole("dialog", { name: "Upload your edits" });
	await expect(dialog).toContainText("Login is not configured");
	await expect(dialog.getByRole("button", { name: "Upload" })).toBeDisabled();
});
