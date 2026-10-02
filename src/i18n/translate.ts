/** Turns a messages object's string leaves into dotted keys: "settings.general.title". */
export type MessageKey<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : MessageKey<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Same shape as `T`, with every leaf widened to `string`: what a translation must provide. */
export type MessageShape<T> = { [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]> };

export type TranslateValues = Record<string, string | number>;

export function lookup(messages: unknown, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Fills `{name}` placeholders. A missing key shows the key itself, so it's easy to spot. */
export function translate(
  messages: unknown,
  fallback: unknown,
  key: string,
  values?: TranslateValues
): string {
  const template = lookup(messages, key) ?? lookup(fallback, key) ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match
  );
}

/** The dictionary key for an audit action: "project.member.add" → "project_member_add". */
export function auditKey(action: string): string {
  return `audit.${action.replace(/[.-]/g, '_')}`;
}
