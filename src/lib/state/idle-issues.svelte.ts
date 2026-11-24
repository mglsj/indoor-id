/**
 * Validation in idle time (P6): the issues of the edits, checked when the browser has nothing
 * else to do rather than at each edit, so that drawing never waits for the validator. The
 * last issues found stay shown until the next check is done.
 */
import type { Issue } from "#lib/validation/validate.ts";

/** Runs a task when the browser is idle (`requestIdleCallback`), or cancels it. */
export interface IdleScheduler {
	request(task: () => void): number;
	cancel(id: number): void;
}

/** Waits at most this long for idle time (ms): a busy page still gets its issues. */
const IDLE_TIMEOUT = 1000;

/** The browser's idle callbacks, or a short timeout where there are none (Safari). */
export const browserIdle: IdleScheduler = {
	request: (task) =>
		typeof globalThis.requestIdleCallback === "function"
			? globalThis.requestIdleCallback(task, { timeout: IDLE_TIMEOUT })
			: (globalThis.setTimeout(task, 200) as unknown as number),
	cancel: (id) =>
		typeof globalThis.cancelIdleCallback === "function"
			? globalThis.cancelIdleCallback(id)
			: globalThis.clearTimeout(id),
};

export class IdleIssues {
	/** The issues of the last check, or null before the first. */
	issues = $state.raw<readonly Issue[] | null>(null);
	readonly #scheduler: IdleScheduler;
	#waiting: number | null = null;

	constructor(scheduler: IdleScheduler = browserIdle) {
		this.#scheduler = scheduler;
	}

	/** Checks with `check` at the next idle time, in place of a check still waiting. */
	schedule(check: () => readonly Issue[]): void {
		this.stop();
		this.#waiting = this.#scheduler.request(() => {
			this.#waiting = null;
			this.issues = check();
		});
	}

	/** Drops the check waiting, if any. */
	stop(): void {
		if (this.#waiting === null) return;
		this.#scheduler.cancel(this.#waiting);
		this.#waiting = null;
	}
}
