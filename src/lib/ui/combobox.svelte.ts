/**
 * What every combobox shares, without markup: whether its list is open, which option is
 * highlighted, and its search (at once for nothing typed, after a pause while typing, older
 * answers dropped). `ComboField` and `SearchCombo` put an input and `ComboList` around it.
 */

export interface ComboboxOptions<R> {
	/** The answer for a query: suggestions, search results. */
	readonly search: (query: string) => Promise<R> | R;
	/** The pause while typing before searching, in milliseconds (300, as iD). */
	readonly delay?: number;
	/** Called with each answer kept (not one to an older query). */
	readonly onresult?: (result: R, query: string) => void;
	/** The answer when a search fails; without it, the last answer stays. */
	readonly failed?: R;
}

/** What a list needs of its combobox. */
export interface ComboState {
	open: boolean;
	readonly highlighted: number;
}

export class Combobox<R> implements ComboState {
	open = $state(false);
	/** The highlighted option, or -1. */
	highlighted = $state(-1);
	/** The last answer kept, or null before any. */
	result = $state.raw<R | null>(null);

	readonly #options: ComboboxOptions<R>;
	#pending: ReturnType<typeof setTimeout> | undefined;
	/** The query asked last: answers to others are dropped. */
	#asked: string | null = null;

	constructor(options: ComboboxOptions<R>) {
		this.#options = options;
	}

	/** Searches for `query`, after a pause unless nothing is typed (or `wait` says not to). */
	find(query: string, { wait = query !== "" } = {}): void {
		clearTimeout(this.#pending);
		this.#asked = query;
		if (wait) {
			this.#pending = setTimeout(
				() => void this.#run(query),
				this.#options.delay ?? 300,
			);
		} else {
			void this.#run(query);
		}
	}

	/**
	 * Moves the highlight `step` options from `from` (the highlighted one by default) within
	 * `count` options, opening the list. Returns the option highlighted, or -1 for none.
	 */
	move(step: number, count: number, from = this.highlighted): number {
		this.open = true;
		if (count === 0) return -1;
		this.highlighted = Math.max(0, Math.min(from + step, count - 1));
		return this.highlighted;
	}

	/** Escape: closes an open list. True when it did, so the key goes no further. */
	escape(): boolean {
		if (!this.open) return false;
		this.open = false;
		return true;
	}

	/** Stops a search still waiting (the input is gone). */
	dispose(): void {
		clearTimeout(this.#pending);
		this.#asked = null;
	}

	async #run(query: string): Promise<void> {
		const { search, onresult, failed } = this.#options;
		try {
			const result = await search(query);
			if (this.#asked !== query) return;
			this.result = result;
			onresult?.(result, query);
		} catch {
			if (this.#asked === query && failed !== undefined) this.result = failed;
		}
	}
}
