// @ts-check
// Where a place in a deck is, in the words a person would use:
// 'slide 4 "pricing", element "logo"' rather than /slides/3/elements/0.

import { plain } from './show.js';

/**
 * @typedef {object} Where
 * @property {string} where  the part of the deck: 'slide 2, slot "image"', 'theme', 'deck'
 * @property {string} field  the field inside that part: 'align', 'enter.duration',
 *                           'colors[0]'; empty when the place is the part itself
 * @property {string} anchor JSON Pointer of the part
 */

const validId = /^[a-z][a-z0-9-]{0,63}$/;

/** @param {string} pointer */
export const segments = (pointer) =>
  pointer === '' ? [] : pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

/** @param {string[]} parts */
export const toPointer = (parts) => parts.map((s) => `/${s.replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');

/** @param {unknown} value @param {string} key @returns {unknown} */
const child = (value, key) => {
  if (Array.isArray(value)) return /^(?:0|[1-9]\d*)$/.test(key) ? value[Number(key)] : undefined;
  if (value !== null && typeof value === 'object' && Object.hasOwn(value, key)) return /** @type {Record<string, unknown>} */ (value)[key];
  return undefined;
};

/** @param {unknown} value */
const idOf = (value) => {
  const id = child(value, 'id');
  return typeof id === 'string' && validId.test(id) ? id : undefined;
};

/**
 * Describes the place at a JSON Pointer in a deck.
 * @param {unknown} deck
 * @param {string} pointer
 * @returns {Where}
 */
export function describe(deck, pointer) {
  const path = segments(pointer);
  let where = 'deck';
  let used = 0;

  const top = path[0];
  if (top === 'slides' && path.length >= 2 && Array.isArray(child(deck, 'slides')) && /^(?:0|[1-9]\d*)$/.test(path[1])) {
    const slide = child(child(deck, 'slides'), path[1]);
    const id = idOf(slide);
    where = `slide ${Number(path[1]) + 1}${id ? ` "${id}"` : ''}`;
    used = 2;
    const part = path[2];
    if (part === 'elements' && path.length >= 4 && /^(?:0|[1-9]\d*)$/.test(path[3])) {
      const elementId = idOf(child(child(slide, 'elements'), path[3]));
      where += elementId ? `, element "${elementId}"` : `, element ${Number(path[3]) + 1}`;
      used = 4;
    } else if (part === 'slots' && path.length >= 4) {
      where += `, slot "${plain(path[3])}"`;
      used = 4;
    } else if (part === 'background') {
      where += ', background';
      used = 3;
    }
  } else if (['background', 'theme', 'canvas', 'meta', 'defaults'].includes(top)) {
    where = top;
    used = 1;
  }

  // The field: names joined by dots, positions in a list as [n].
  let field = '';
  let value = path.slice(0, used).reduce(child, deck);
  for (const key of path.slice(used)) {
    if (Array.isArray(value)) field += `[${plain(key)}]`;
    else field += `${field === '' ? '' : '.'}${plain(key)}`;
    value = child(value, key);
  }
  return { where, field, anchor: toPointer(path.slice(0, used)) };
}
