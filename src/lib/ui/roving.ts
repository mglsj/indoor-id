/**
 * Roving focus for a toolbar (A.6, WAI-ARIA's toolbar pattern): the toolbar is one Tab stop,
 * its buttons are reached with the arrow keys, Home and End. The button last focused keeps
 * the stop. Buttons marked `aria-disabled` stay reachable (they explain why they can't be
 * used); `disabled` ones are skipped.
 */
import type { Attachment } from "svelte/attachments";

const ITEMS = "button, [role='button'], a[href]";

type Orientation = "horizontal" | "vertical";

const KEYS: Record<Orientation, { next: string; previous: string }> = {
	horizontal: { next: "ArrowRight", previous: "ArrowLeft" },
	vertical: { next: "ArrowDown", previous: "ArrowUp" },
};

export function roving(
	orientation: Orientation = "horizontal",
): Attachment<HTMLElement> {
	return (root) => {
		let current: HTMLElement | null = null;

		const items = () =>
			[...root.querySelectorAll<HTMLElement>(ITEMS)].filter(
				(item) => !(item as HTMLButtonElement).disabled,
			);

		/** One stop: the current item, or the first when it went away. */
		function sync() {
			const list = items();
			if (!current || !list.includes(current)) current = list[0] ?? null;
			for (const item of list) {
				const index = item === current ? 0 : -1;
				if (item.tabIndex !== index) item.tabIndex = index;
			}
		}

		function onfocusin(event: FocusEvent) {
			const target = event.target as HTMLElement;
			if (!items().includes(target)) return;
			current = target;
			sync();
		}

		function onkeydown(event: KeyboardEvent) {
			if (event.defaultPrevented) return;
			const list = items();
			const at = list.indexOf(event.target as HTMLElement);
			if (at < 0) return;
			const { next, previous } = KEYS[orientation];
			let to: number;
			if (event.key === next) to = (at + 1) % list.length;
			else if (event.key === previous)
				to = (at - 1 + list.length) % list.length;
			else if (event.key === "Home") to = 0;
			else if (event.key === "End") to = list.length - 1;
			else return;
			event.preventDefault();
			list[to]?.focus();
		}

		sync();
		root.addEventListener("focusin", onfocusin);
		root.addEventListener("keydown", onkeydown);
		// Buttons come and go (the selection's operations) or turn disabled.
		const observer = new MutationObserver(sync);
		observer.observe(root, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["disabled"],
		});
		return () => {
			observer.disconnect();
			root.removeEventListener("focusin", onfocusin);
			root.removeEventListener("keydown", onkeydown);
		};
	};
}
