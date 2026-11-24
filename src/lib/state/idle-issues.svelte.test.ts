import { describe, expect, it } from "vitest";
import type { Issue } from "#lib/validation/validate.ts";
import { IdleIssues, type IdleScheduler } from "./idle-issues.svelte.ts";

/** A scheduler run by hand: `idle()` runs what waits for idle time. */
function fakeScheduler() {
	const waiting = new Map<number, () => void>();
	let next = 1;
	const scheduler: IdleScheduler = {
		request: (task) => {
			const id = next++;
			waiting.set(id, task);
			return id;
		},
		cancel: (id) => waiting.delete(id),
	};
	return {
		scheduler,
		pending: () => waiting.size,
		idle: () => {
			const tasks = [...waiting.values()];
			waiting.clear();
			for (const task of tasks) task();
		},
	};
}

const issue = (id: string) => ({ id }) as Issue;

describe("IdleIssues (P6: validation in idle time)", () => {
	it("checks once the browser is idle, not at each edit", () => {
		const fake = fakeScheduler();
		const idle = new IdleIssues(fake.scheduler);
		let runs = 0;
		const check = () => {
			runs++;
			return [issue("a")];
		};
		idle.schedule(check);
		idle.schedule(check);
		idle.schedule(check);
		expect(fake.pending()).toBe(1);
		expect(idle.issues).toBeNull();
		fake.idle();
		expect(runs).toBe(1);
		expect(idle.issues).toEqual([issue("a")]);
	});

	it("keeps the last issues shown until the next check is done", () => {
		const fake = fakeScheduler();
		const idle = new IdleIssues(fake.scheduler);
		idle.schedule(() => [issue("a")]);
		fake.idle();
		idle.schedule(() => []);
		expect(idle.issues).toEqual([issue("a")]);
		fake.idle();
		expect(idle.issues).toEqual([]);
	});

	it("drops a check waiting when stopped", () => {
		const fake = fakeScheduler();
		const idle = new IdleIssues(fake.scheduler);
		idle.schedule(() => [issue("a")]);
		idle.stop();
		expect(fake.pending()).toBe(0);
	});
});
