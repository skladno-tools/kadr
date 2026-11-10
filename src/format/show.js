// @ts-check
// Showing values from a deck inside messages.
//
// A deck may come from anyone, and messages go to a terminal. Everything
// quoted from the deck goes through show(): characters that cannot be seen or
// that could steer a terminal are written as escapes, and long values are cut.

/** The longest quoted text, in characters. */
export const MAX_SHOWN = 60;

// Control characters, line and paragraph separators, and the characters that
// change the direction of text or join and hide it.
const unsafe = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

/**
 * A string as it may be shown: no control or invisible characters, and at
 * most MAX_SHOWN characters, then "...".
 * @param {string} text
 */
export function plain(text) {
  // Cut before escaping, and look only at the start of a very long string.
  const head = Array.from(text.slice(0, MAX_SHOWN * 2 + 2));
  const cut = head.length > MAX_SHOWN || text.length > MAX_SHOWN * 2 + 2;
  const shown = (cut ? head.slice(0, MAX_SHOWN) : head).join('')
    .replace(unsafe, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
    // An unpaired surrogate cannot be printed.
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);
  return cut ? `${shown}...` : shown;
}

/**
 * A value from a deck, as it is written in JSON, safe to show.
 * @param {unknown} value
 */
export function show(value) {
  if (typeof value === 'string') return `"${plain(value).replace(/"/g, '\\"')}"`;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'an object';
  return 'nothing';
}

/**
 * What kind of JSON value this is, in words.
 * @param {unknown} value
 */
export function kindOf(value) {
  if (typeof value === 'string') return 'a string';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return 'an object';
}

/**
 * A list in words: "a", "a or b", "a, b or c".
 * @param {string[]} items @param {string} [last]  the word before the last item
 */
export function list(items, last = 'or') {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
}
