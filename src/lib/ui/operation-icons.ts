/** The icon of each operation on the selection (A.3), in the bar and the menus. */
import ArrowRightFromLine from "@lucide/svelte/icons/arrow-right-from-line";
import BetweenVerticalStart from "@lucide/svelte/icons/between-vertical-start";
import ClipboardPaste from "@lucide/svelte/icons/clipboard-paste";
import Combine from "@lucide/svelte/icons/combine";
import Copy from "@lucide/svelte/icons/copy";
import Grid2x2Check from "@lucide/svelte/icons/grid-2x2-check";
import Layers2 from "@lucide/svelte/icons/layers-2";
import Move from "@lucide/svelte/icons/move";
import Octagon from "@lucide/svelte/icons/octagon";
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import Scaling from "@lucide/svelte/icons/scaling";
import Scissors from "@lucide/svelte/icons/scissors";
import ScissorsSquare from "@lucide/svelte/icons/scissors-square";
import Square from "@lucide/svelte/icons/square";
import SquareSquare from "@lucide/svelte/icons/square-square";
import SquaresSubtract from "@lucide/svelte/icons/squares-subtract";
import Trash from "@lucide/svelte/icons/trash";
import Unlink from "@lucide/svelte/icons/unlink";
import type { Component } from "svelte";
import type { Operation } from "#lib/edit/operations.ts";
import type { Message } from "#lib/i18n/messages.ts";

export const OPERATION_ICONS: Record<Operation["id"], Component> = {
	copy: Copy,
	repeat: Layers2,
	paste: ClipboardPaste,
	disconnect: Unlink,
	square: Square,
	merge: Combine,
	multipolygon: SquaresSubtract,
	"cut-out": ScissorsSquare,
	delete: Trash,
	move: Move,
	rotate: RotateCcw,
	scale: Scaling,
	side: ArrowRightFromLine,
	offset: SquareSquare,
	"square-frame": Grid2x2Check,
	straighten: Octagon,
	symmetric: BetweenVerticalStart,
	split: Scissors,
};

/** An operation offered for the selection, and why it can't run now (null when it can). */
export interface OfferedOperation {
	readonly operation: Operation;
	readonly disabled: Message | null;
}
