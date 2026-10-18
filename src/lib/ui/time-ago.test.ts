import { describe, expect, it } from "vitest";
import { timeAgo } from "./time-ago.ts";

describe("timeAgo", () => {
	const now = new Date("2024-05-10T12:00:00Z");

	it("says how long ago, in the largest whole unit", () => {
		expect(timeAgo("2024-05-10T11:59:30Z", now)).toBe("just now");
		expect(timeAgo("2024-05-10T11:45:00Z", now)).toBe("15 minutes ago");
		expect(timeAgo("2024-05-10T10:00:00Z", now)).toBe("2 hours ago");
		expect(timeAgo("2024-05-09T12:00:00Z", now)).toBe("yesterday");
		expect(timeAgo("2024-05-01T12:00:00Z", now)).toBe("9 days ago");
		expect(timeAgo("2024-02-01T12:00:00Z", now)).toBe("3 months ago");
		expect(timeAgo("2021-05-01T12:00:00Z", now)).toBe("3 years ago");
	});

	it("gives nothing for a date it can't read", () => {
		expect(timeAgo("not a date", now)).toBeNull();
	});
});
