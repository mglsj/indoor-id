import {
	expect,
	LAT,
	LON,
	room,
	selectRoom,
	serveTaginfo,
	tagsBox,
	test,
} from "./fixtures.ts";

test("a combo suggests the values used elsewhere, and stores what is typed as a tag value", async ({
	page,
}) => {
	const requests = await serveTaginfo(page, {
		room: ["office", "class", "kitchen", "toilets"],
	});
	const editor = await selectRoom(page);
	const type = editor.getByRole("combobox", { name: "Type" });
	await type.click();
	await type.press("ArrowDown");
	await expect(page.getByRole("option", { name: "kitchen" })).toBeVisible();
	// Asked for values on ways (rooms are areas).
	expect(requests.at(-1)?.searchParams.get("filter")).toBe("ways");

	await type.fill("Class Room");
	await type.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nroom=class_room",
	);
});

test("↓ opens a combo's list even before taginfo answers", async ({ page }) => {
	await serveTaginfo(page, { room: ["office", "kitchen"] }, [], 1000);
	const editor = await selectRoom(page);
	const type = editor.getByRole("combobox", { name: "Type" });
	await type.focus();
	await type.press("ArrowDown");
	await expect(page.getByRole("option", { name: "kitchen" })).toBeVisible();
});

test("a combo completes what is typed, as in iD", async ({ page }) => {
	await serveTaginfo(page, { room: ["office", "kitchen"] });
	const editor = await selectRoom(page);
	const type = editor.getByRole("combobox", { name: "Type" });
	await type.click();
	await type.pressSequentially("kit");
	await expect(type).toHaveValue("kitchen");
	await type.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nroom=kitchen",
	);
});

test("a fixed list shows labels and stores their values", async ({ page }) => {
	const editor = await selectRoom(page, { amenity: "cafe" });
	const internet = editor.getByRole("combobox", {
		name: "Internet Connection",
	});
	await expect(internet).toHaveAttribute("readonly");
	await internet.click();
	await page.getByRole("option", { name: "Wifi" }).click();
	await expect(internet).toHaveValue("Wifi");
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\ninternet_access=wlan\nlevel=0",
	);

	// Its value can't be typed over, only taken off.
	await internet.press("Backspace");
	await expect(internet).toHaveValue("");
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\nlevel=0",
	);
});

test("a list field shows its values as chips: added, moved and removed", async ({
	page,
}) => {
	const editor = await selectRoom(page, { amenity: "cafe" });
	const cuisine = editor.getByRole("combobox", { name: "Cuisines" });
	await cuisine.fill("pizza");
	await cuisine.press("Enter");
	await cuisine.fill("Thai Food, italian");
	await cuisine.press("Enter");
	const chips = editor.getByRole("list", { name: "Cuisines" });
	await expect(chips.getByRole("listitem")).toHaveText([
		"Pizza",
		"thai_food",
		"Italian",
	]);
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\ncuisine=pizza;thai_food;italian\nindoor=room\nlevel=0",
	);

	// Alt+← moves the focused chip, as in the floor plan list.
	await editor
		.getByRole("button", { name: "Remove Italian" })
		.press("Alt+ArrowLeft");
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\ncuisine=pizza;italian;thai_food\nindoor=room\nlevel=0",
	);
	await expect(
		editor.getByRole("button", { name: "Remove Italian" }),
	).toBeFocused();

	// Dragging one onto another puts it there.
	await chips
		.getByRole("listitem")
		.filter({ hasText: "thai_food" })
		.dragTo(chips.getByRole("listitem").filter({ hasText: "Pizza" }));
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\ncuisine=thai_food;pizza;italian\nindoor=room\nlevel=0",
	);

	await editor.getByRole("button", { name: "Remove Pizza" }).click();
	await expect(chips.getByRole("listitem")).toHaveText([
		"thai_food",
		"Italian",
	]);
});

test("a multi-key field switches each key between yes and no", async ({
	page,
}) => {
	const editor = await selectRoom(page, {
		amenity: "cafe",
		"payment:cash": "yes",
	});
	const cash = editor.getByRole("checkbox", { name: "Cash" });
	await expect(cash).toBeChecked();
	await cash.click();
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\nlevel=0\npayment:cash=no",
	);

	const payment = editor.getByRole("combobox", { name: "Payment Types" });
	await payment.fill("Coins");
	await payment.press("Enter");
	await expect(editor.getByRole("checkbox", { name: "Coins" })).toBeChecked();
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\nlevel=0\npayment:cash=no\npayment:coins=yes",
	);
});

test("a check cycles through unknown, yes and no", async ({ page }) => {
	const editor = await selectRoom(page, { amenity: "cafe" });
	const seating = editor.getByRole("checkbox", { name: "Outdoor Seating" });
	await expect(seating).toHaveAttribute("aria-checked", "mixed");
	await expect(editor).toContainText("Unknown");

	await seating.click();
	await expect(seating).toHaveAttribute("aria-checked", "true");
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\nlevel=0\noutdoor_seating=yes",
	);
	await seating.click();
	await expect(seating).toHaveAttribute("aria-checked", "false");
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\nlevel=0\noutdoor_seating=no",
	);
	await seating.click();
	await expect(seating).toHaveAttribute("aria-checked", "mixed");
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\nlevel=0",
	);
});

test("a radio sets its key to the choice", async ({ page }) => {
	const editor = await selectRoom(page, { amenity: "cafe", wheelchair: "yes" });
	const access = editor.getByRole("radiogroup", { name: "Wheelchair Access" });
	await expect(access.getByRole("radio", { name: "Yes" })).toBeChecked();
	await access.getByRole("radio", { name: "Limited" }).click();
	await expect(access.getByRole("radio", { name: "Limited" })).toBeChecked();
	await expect(await tagsBox(page)).toHaveValue(
		"amenity=cafe\nindoor=room\nlevel=0\nwheelchair=limited",
	);
});

test("a number field keeps to its bounds, and steps with − and +", async ({
	page,
}) => {
	const editor = await selectRoom(page);
	const height = editor.getByRole("textbox", { name: "Height (Meters)" });
	await editor
		.getByRole("button", { name: "Increase Height (Meters)" })
		.click();
	await expect(height).toHaveValue("1");
	await expect(await tagsBox(page)).toHaveValue(
		"height=1\nindoor=room\nlevel=0",
	);

	await height.fill("-3");
	await height.press("Enter");
	await expect(height).toHaveValue("0");
	await height.fill("2.50");
	await height.press("Enter");
	await editor
		.getByRole("button", { name: "Increase Height (Meters)" })
		.click();
	await expect(await tagsBox(page)).toHaveValue(
		"height=3.50\nindoor=room\nlevel=0",
	);
});

test("a website gets a link, and a survey date a button for today", async ({
	page,
}) => {
	const editor = await selectRoom(page, {
		amenity: "cafe",
		website: "https://example.org/menu",
		check_date: "2020-01-01",
	});
	await expect(
		editor.getByRole("link", { name: "Visit website" }),
	).toHaveAttribute("href", "https://example.org/menu");

	await editor.getByRole("button", { name: "Set to today" }).click();
	const today = await page.evaluate(() => {
		const now = new Date();
		return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
			.toISOString()
			.slice(0, 10);
	});
	await expect(
		editor.getByRole("textbox", { name: "Last Checked Date" }),
	).toHaveValue(today);
	await expect(
		editor.getByRole("button", { name: "Set to today" }),
	).toBeHidden();
});

test("a long value shows how much of OSM's 255 characters it uses", async ({
	page,
}) => {
	const editor = await selectRoom(page, { description: "x" });
	const description = editor.getByRole("textbox", { name: "Description" });
	await description.fill("a".repeat(230));
	await expect(editor).toContainText("230/255");
	await description.fill("a".repeat(300));
	await description.blur();
	// OSM keeps 255 characters.
	await expect(description).toHaveValue("a".repeat(255));
});

test("names in other languages are added, moved to another language and removed", async ({
	page,
}) => {
	const editor = await selectRoom(page, { name: "Library" });
	await editor.getByRole("button", { name: "Add a translation" }).click();
	const language = editor.getByRole("combobox", { name: "Language" });
	await language.fill("French");
	await language.press("Enter");
	// Once its language is chosen, the row is named after it.
	const french = editor.getByRole("textbox", { name: "Name in French" });
	await french.fill("Bibliothèque");
	await french.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nname=Library\nname:fr=Bibliothèque",
	);

	// Typed in the language's own name.
	await language.fill("Deutsch");
	await language.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nname=Library\nname:de=Bibliothèque",
	);
	await editor.getByRole("button", { name: "Remove the German name" }).click();
	await expect(await tagsBox(page)).toHaveValue(
		"indoor=room\nlevel=0\nname=Library",
	);
});

test("an address suggests the streets around", async ({ page }) => {
	const street = [
		{ type: "node", id: 1, lon: LON - 0.001, lat: LAT + 0.0005, version: 1 },
		{ type: "node", id: 2, lon: LON + 0.001, lat: LAT + 0.0005, version: 1 },
		{
			type: "way",
			id: 3,
			version: 1,
			nodes: [1, 2],
			tags: { highway: "residential", name: "Rue de la Gare" },
		},
	];
	const editor = await selectRoom(page, { amenity: "cafe" }, [
		...street,
		...room(100, LON, LAT, "0"),
	]);
	const streetInput = editor.getByRole("combobox", { name: "Street" });
	await streetInput.click();
	await streetInput.press("ArrowDown");
	await page.getByRole("option", { name: "Rue de la Gare" }).click();
	await editor.getByRole("combobox", { name: "Address" }).fill("12");
	await editor.getByRole("combobox", { name: "Address" }).press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"addr:housenumber=12\naddr:street=Rue de la Gare\namenity=cafe\nindoor=room\nlevel=0",
	);
});

test("access has a row per kind of traffic, with the access implied", async ({
	page,
}) => {
	const editor = await selectRoom(page, {
		indoor: undefined as unknown as string,
		highway: "pedestrian",
		area: "yes",
	});
	const all = editor.getByRole("combobox", { name: /All$/ });
	await expect(all).toHaveAttribute("placeholder", "yes");
	const foot = editor.getByRole("combobox", { name: "Foot" });
	await foot.fill("private");
	await foot.press("Enter");
	await expect(await tagsBox(page)).toHaveValue(
		"area=yes\nfoot=private\nhighway=pedestrian\nlevel=0",
	);
});
