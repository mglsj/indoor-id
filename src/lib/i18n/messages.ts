/**
 * Text shown to users, kept as a key and params (`{key: "fix_set_level", params: {level}}`)
 * until the UI renders it with `t()`: in English for now, from `messages/en.json`; Paraglide
 * will translate the same keys (P6). Pure: modules that make messages don't touch the DOM.
 */
import { EN } from "./generated/en.ts";

type English = typeof EN;
export type MessageKey = keyof English;

/** The `{param}` names in a message's text. */
type ParamNames<Text extends string> =
	Text extends `${string}{${infer Name}}${infer Rest}`
		? Name | ParamNames<Rest>
		: never;

export type Params<K extends MessageKey> = Record<
	ParamNames<English[K]>,
	string | number
>;

export type Message = {
	[K in MessageKey]: [ParamNames<English[K]>] extends [never]
		? { readonly key: K; readonly params?: undefined }
		: { readonly key: K; readonly params: Params<K> };
}[MessageKey];

/** A message, with the params its text names (none for most). */
export function msg<K extends MessageKey>(
	key: K,
	...params: [ParamNames<English[K]>] extends [never] ? [] : [Params<K>]
): Message {
	return (params[0] ? { key, params: params[0] } : { key }) as Message;
}

/** A message's text, its params in place. */
export function t(message: Message): string {
	const text: string = EN[message.key];
	const params: Record<string, string | number> | undefined = message.params;
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in params ? String(params[name]) : whole,
	);
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
