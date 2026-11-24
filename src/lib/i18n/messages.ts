/**
 * Text shown to users, kept as a key and params (`{key: "fix_set_level", params: {level}}`)
 * until the UI renders it with `t()`, through Paraglide's message functions (P6), compiled from
 * `messages/{locale}.json` by `bun run messages` into `paraglide/`. The language is Paraglide's:
 * chosen in the header, else the browser's, else English; a message a translation lacks is
 * shown in English. Pure: modules that make messages don't touch the DOM.
 */
import { m } from "./paraglide/messages.js";
import { getLocale } from "./paraglide/runtime.js";

type Messages = typeof m;
export type MessageKey = keyof Messages;

type Inputs<K extends MessageKey> = NonNullable<Parameters<Messages[K]>[0]>;
type ParamNames<K extends MessageKey> = Extract<keyof Inputs<K>, string>;

export type Params<K extends MessageKey> = Record<
	ParamNames<K>,
	string | number
>;

export type Message = {
	[K in MessageKey]: [ParamNames<K>] extends [never]
		? { readonly key: K; readonly params?: undefined }
		: { readonly key: K; readonly params: Params<K> };
}[MessageKey];

/** A message, with the params its text names (none for most). */
export function msg<K extends MessageKey>(
	key: K,
	...params: [ParamNames<K>] extends [never] ? [] : [Params<K>]
): Message {
	return (params[0] ? { key, params: params[0] } : { key }) as Message;
}

/**
 * Looked up by key: every message is shown somewhere, so none is left out of the bundle that
 * direct calls would let the bundler drop.
 */
const FUNCTIONS = m as unknown as Readonly<
	Record<string, (inputs: Record<string, unknown>) => string>
>;

/**
 * A message's text, its params in place. With a numeric `count`, the plural form of the
 * language (`Intl.PluralRules`, written as variants in the message files).
 */
export function t(message: Message): string {
	const render = FUNCTIONS[message.key];
	return render ? render(message.params ?? {}) : message.key;
}

/** The language messages are shown in (`en`, `fr`…). */
export function currentLanguage(): string {
	return getLocale();
}

/** An error whose text is a message: `message` reads it in English, `msg` keeps it. */
export class MessageError extends Error {
	override name = "MessageError";
	readonly msg: Message;

	constructor(message: Message, options?: ErrorOptions) {
		super(t(message), options);
		this.msg = message;
	}
}
