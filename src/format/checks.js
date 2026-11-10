// @ts-check
// The checks beyond the schema (docs/format.md section 15): mistakes that the
// shape of the JSON cannot show, such as two elements with one id.
//
// They run on a deck that already passed the schema, so the shapes of its
// values can be relied on. The checks that need the themes or the geometry of
// layouts (fonts, sizes given as roles, slots outside the canvas) are not
// here yet.
//
// Uses no Node and no DOM APIs.

import { parseMarkup } from './markup.js';
import { describe } from './where.js';
import { show } from './show.js';

/**
 * @typedef {import('./diagnose.js').Finding} Finding
 */

/**
 * @typedef {object} Options
 * @property {(path: string) => boolean} [exists]  whether an image file exists, by
 *   its path relative to the deck; without it, missing files are not reported
 */

/**
 * One thing drawn on a slide: a free element, or the element of a slot.
 * @typedef {object} Thing
 * @property {string} path     JSON Pointer
 * @property {'text' | 'image' | 'shape' | 'code'} type
 * @property {string} [id]     its own, or the slot's name
 * @property {boolean} slot
 * @property {Record<string, any>} fields  its fields; for a slot given as a string, only "content"
 * @property {string} contentPath  JSON Pointer of its text, for text
 */

const imageFormats = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg'];
const formatNames = 'PNG, JPEG, WebP, AVIF, GIF or SVG';
const a = { text: 'a text', image: 'an image', shape: 'a shape', code: 'a code block' };

/**
 * The extension of the last part of a path, in lowercase; '' when it has none.
 * @param {string} path
 */
const extension = (path) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/**
 * Everything drawn on a slide, slots first.
 * @param {Record<string, any>} slide @param {string} path
 * @returns {Thing[]}
 */
function thingsOf(slide, path) {
  /** @type {Thing[]} */
  const things = [];
  for (const [name, value] of Object.entries(slide.slots ?? {})) {
    const fields = typeof value === 'string' ? { content: value } : value;
    const at = `${path}/slots/${name}`;
    things.push({ path: at, type: name === 'image' ? 'image' : 'text', id: fields.id ?? name, slot: true, fields, contentPath: typeof value === 'string' ? at : `${at}/content` });
  }
  (slide.elements ?? []).forEach((/** @type {Record<string, any>} */ element, /** @type {number} */ i) => {
    things.push({ path: `${path}/elements/${i}`, type: element.type, id: element.id, slot: false, fields: element, contentPath: `${path}/elements/${i}/content` });
  });
  return things;
}

/**
 * Runs the checks beyond the schema on a deck that is valid by the schema.
 * @param {Record<string, any>} deck
 * @param {Options} [options]
 * @returns {Finding[]}
 */
export function beyondSchema(deck, options = {}) {
  /** @type {Finding[]} */
  const findings = [];
  /**
   * @param {'error' | 'warning'} severity @param {string} path @param {'key' | 'value'} at
   * @param {string} code @param {string} message @param {string} [hint]
   */
  const add = (severity, path, at, code, message, hint) => {
    findings.push({ severity, code, message, ...(hint ? { hint } : {}), path, where: describe(deck, path).where, at });
  };

  const width = deck.canvas?.width ?? 1920;
  const height = deck.canvas?.height ?? 1080;
  /** @type {Record<string, any>[]} */
  const slides = deck.slides;
  const all = slides.map((slide, i) => thingsOf(slide, `/slides/${i}`));

  // Images: elements, slots and backgrounds.
  /** @param {unknown} src @param {string} path */
  const image = (src, path) => {
    if (typeof src !== 'string' || src.startsWith('data:')) return;
    const remote = src.startsWith('https://');
    const ext = extension(remote ? src.slice(8).replace(/[?#].*$/, '').replace(/^[^/]*\/?/, '') : src);
    if (remote) add('warning', path, 'value', 'remote-image', `${show(src)} is loaded from the network`, 'A built deck will need the network to show it. Keep the image next to the deck to present offline.');
    if (ext === '' && remote) {
      add('warning', path, 'value', 'image-format-unknown', `the format of ${show(src)} cannot be told from its address`, `Kadr shows ${formatNames}; make sure the address gives one of them.`);
    } else if (!imageFormats.includes(ext)) {
      add('error', path, 'value', 'image-format', ext === '' ? `${show(src)} has no extension, so its format is unknown` : `${show(src)} is not in a format Kadr shows`, `Use ${formatNames}.`);
    } else if (!remote && options.exists && !options.exists(src)) {
      add('error', path, 'value', 'image-missing', `the image ${show(src)} does not exist`, 'The path is relative to the deck file. Check the name and the folder.');
    }
  };
  /** @param {unknown} background @param {string} path */
  const backgroundImage = (background, path) => {
    if (background !== null && typeof background === 'object' && /** @type {any} */ (background).type === 'image') image(/** @type {any} */ (background).src, `${path}/src`);
  };
  backgroundImage(deck.background, '/background');

  // Slides with the same id.
  /** @type {Map<string, number>} */
  const slideIds = new Map();
  slides.forEach((slide, i) => {
    if (typeof slide.id !== 'string') return;
    const first = slideIds.get(slide.id);
    if (first === undefined) slideIds.set(slide.id, i);
    else add('error', `/slides/${i}/id`, 'value', 'duplicate-slide-id', `the id ${show(slide.id)} is used by two slides`, `Slide ${first + 1} has it too. Give one of them another id.`);
  });

  // The slides as they are presented: hidden ones do not exist then.
  const shown = slides.map((slide, i) => ({ slide, i })).filter(({ slide }) => slide.hidden !== true);
  /** For each slide, the ids that also exist on the slide shown before or after it. @type {Set<string>[]} */
  const paired = slides.map(() => new Set());

  shown.forEach(({ slide, i }, n) => {
    if (n === 0) return;
    const before = shown[n - 1];
    const transition = slide.transition ?? deck.defaults?.transition ?? 'morph';
    if (transition !== 'morph') return;
    const earlier = new Map(all[before.i].filter((t) => t.id !== undefined).map((t) => [t.id, t]));
    for (const thing of all[i]) {
      const other = thing.id === undefined ? undefined : earlier.get(thing.id);
      if (other === undefined) continue;
      paired[i].add(/** @type {string} */ (thing.id));
      paired[before.i].add(/** @type {string} */ (thing.id));
      if (other.type !== thing.type) {
        add('error', thing.path, 'value', 'morph-type-mismatch', `${show(thing.id)} is ${a[thing.type]} here and ${a[other.type]} on slide ${before.i + 1}`,
          'Elements with one id on slides shown one after the other flow into each other, so they must be of one type. Give one of them another id.');
      }
    }
  });

  slides.forEach((slide, i) => {
    const path = `/slides/${i}`;
    backgroundImage(slide.background, `${path}/background`);

    // Two things with one id; a slot's element has the id of the slot's name.
    /** @type {Map<string, Thing>} */
    const ids = new Map();
    for (const thing of all[i]) {
      if (thing.id === undefined) continue;
      const first = ids.get(thing.id);
      if (first === undefined) { ids.set(thing.id, thing); continue; }
      const hint = first.slot && first.fields.id === undefined
        ? `The slot ${show(thing.id)} gives its element that id. Give this one another id.`
        : 'An id is unique on its slide. Give one of the two another id.';
      add('error', thing.fields.id === undefined ? thing.path : `${thing.path}/id`, 'value', 'duplicate-id', `the id ${show(thing.id)} is used twice on this slide`, hint);
    }

    for (const thing of all[i]) {
      const f = thing.fields;

      if (thing.type === 'image') image(f.src, `${thing.path}/src`);

      const effect = typeof f.enter === 'string' ? f.enter : f.enter?.effect;
      if (effect === 'type' && thing.type !== 'text') {
        add('error', `${thing.path}/enter`, 'value', 'type-effect-not-text', `the "type" entrance works only on text, and this is ${a[thing.type]}`, 'Use another effect, such as "fade".');
      }

      if (thing.type === 'shape' && f.shape === 'line' && f.w === 0 && f.h === 0) {
        add('warning', thing.path, 'value', 'line-zero-length', 'the line has no length: "w" and "h" are both 0', 'A line runs from ("x", "y") to ("x" + "w", "y" + "h"). Give it a "w" or an "h".');
      }

      // Entirely outside the canvas. An element that flows in from outside,
      // or out, by morphing with a neighbouring slide is there on purpose.
      if (!thing.slot && !f.rotate && !(thing.id !== undefined && paired[i].has(thing.id))) {
        const left = Math.min(f.x, f.x + f.w);
        const right = Math.max(f.x, f.x + f.w);
        const top = f.h === undefined ? f.y : Math.min(f.y, f.y + f.h);
        const bottom = f.h === undefined ? Infinity : Math.max(f.y, f.y + f.h);
        const line = f.shape === 'line';
        // A line along an edge of the canvas is still on it.
        const outside = line
          ? right < 0 || left > width || bottom < 0 || top > height
          : right <= 0 || left >= width || bottom <= 0 || top >= height;
        if (outside) add('warning', thing.path, 'value', 'off-canvas', `the element lies entirely outside the ${width}x${height} canvas`, 'Nothing of it will be seen. Check "x" and "y".');
      }

      const minimum = Math.round((24 * height) / 1080);
      if ((thing.type === 'text' || thing.type === 'code') && typeof f.size === 'number' && f.size < minimum) {
        add('warning', `${thing.path}/size`, 'value', 'text-too-small', `${thing.type === 'code' ? 'code' : 'text'} is ${f.size} px, hard to read from a distance`,
          `Use at least ${minimum} px on a ${height} px tall canvas${thing.type === 'text' ? ', or the role "caption"' : ''}.`);
      }

      if (thing.type !== 'text') continue;

      if (!thing.slot && f.valign !== undefined && f.h === undefined) {
        add('warning', `${thing.path}/valign`, 'key', 'valign-without-height', '"valign" has no effect without "h"', 'A box that fits its text has nothing to align in. Give the text an "h", or remove "valign".');
      }

      if (typeof f.content !== 'string') continue;
      const blocks = parseMarkup(f.content);

      if (f.reveal === 'items' && !blocks.some((b) => b.type === 'list')) {
        add('warning', `${thing.path}/reveal`, 'key', 'reveal-without-list', '"reveal": "items" on text without a list', 'The whole text will appear at once. Write the items as lines that start with "- ", or remove "reveal".');
      }

      for (const block of blocks) {
        if (block.type === 'list' && block.ordered && block.items.length === 1 && block.items[0].lists.length === 0) {
          add('warning', thing.contentPath, 'value', 'list-one-number', `the line that starts with "${block.start}. " is a numbered list of one item`,
            `If it is a sentence that starts with a number, escape the dot: "${block.start}\\." (written "${block.start}\\\\." in JSON).`);
        }
      }
    }
  });

  return findings;
}
