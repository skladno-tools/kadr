// @ts-check
// Turns the problems the schema finds into diagnostics a person or an AI
// tool can act on: a stable code, what is wrong, and what to do about it.
//
// The codes are a contract (docs/cli.md section 4). The wording is pinned by
// the cases in tests/schema/invalid, so a change to it shows in review.

import { closest } from './suggest.js';
import { describe, segments, toPointer } from './where.js';
import { show, kindOf, list } from './show.js';

/**
 * @typedef {import('./problems.js').Problem} Problem
 */

/**
 * @typedef {object} Finding  a diagnostic that does not know its line yet
 * @property {'error' | 'warning'} severity
 * @property {string} code
 * @property {string} message
 * @property {string} [hint]
 * @property {string} path   JSON Pointer of the value concerned
 * @property {string} where  where that is, in words
 * @property {'key' | 'value'} at  which position of the place at "path" to
 *                                 point to: the key of a member, or its value
 */

/** How many allowed values or fields a hint lists before it points to the docs. */
const MAX_LISTED = 12;

/** @type {Record<string, string>} */
const typeWords = {
  number: 'a number',
  integer: 'a whole number',
  string: 'a string',
  boolean: 'true or false',
  object: 'an object',
  array: 'a list',
};

/** @type {Record<string, string>} */
const elementWords = { textElement: 'text', imageElement: 'image', shapeElement: 'shape', codeElement: 'code' };

/** @param {unknown[]} values */
const listValues = (values) => list(values.map(show));

/**
 * What is wrong with an image address, for the three forms docs/format.md
 * section 2 allows.
 * @param {string} src
 * @returns {{ code: string, message: string, hint: string }}
 */
function address(src) {
  const shown = show(src);
  const code = 'image-address';
  const forms = 'Use a path relative to the deck file, such as "assets/photo.jpg", an https:// address or a data:image/ URI.';
  if (src === '') return { code, message: 'the image has no address', hint: forms };
  if (/^\s|\s$/.test(src)) return { code, message: `the image address ${shown} starts or ends with a space`, hint: 'Remove the space.' };
  if (/^http:\/\//i.test(src)) {
    return { code: 'image-insecure', message: `${shown} is an http:// address`, hint: 'Use https://: a deck served over HTTPS cannot load http:// images reliably.' };
  }
  if (/^https:/i.test(src)) {
    const hint = src.startsWith('https://') ? 'Check the address: it needs a host name and no spaces or control characters.' : 'Write it as "https://" in lowercase, followed by the host name.';
    return { code, message: `${shown} is not a complete https:// address`, hint };
  }
  if (/^data:/i.test(src)) {
    return { code, message: `${shown} is not an embedded image Kadr accepts`, hint: 'An embedded image is a data:image/ URI of PNG, JPEG, WebP, AVIF, GIF or SVG, such as "data:image/png;base64,...".' };
  }
  if (/^[A-Za-z]:[\\/]/.test(src) || /^[\\/]/.test(src)) return { code, message: `${shown} is an absolute path`, hint: forms };
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(src);
  if (scheme) return { code, message: `${shown} uses "${scheme[1]}:", which is not allowed`, hint: forms };
  if (src.includes('\\')) return { code, message: `${shown} has a backslash`, hint: 'Use "/" between folders.' };
  if (/(?:^|\/)\.\.(?:\/|$)/.test(src)) {
    return { code, message: `${shown} leaves the deck's folder`, hint: 'Keep images inside the deck\'s folder, for example in "assets/".' };
  }
  if (src.includes('%')) return { code, message: `${shown} has a "%"`, hint: 'Write the file name as it is: a space is a space, not "%20".' };
  if (/[?#]/.test(src)) return { code, message: `${shown} has a "?" or "#"`, hint: 'A file path takes neither; only an https:// address does.' };
  return { code, message: `${shown} is not an image address Kadr accepts`, hint: 'Remove the control or invisible characters from the name.' };
}

/**
 * A range in words, from the schema that sets it.
 * @param {any} s
 */
function range(s) {
  if (typeof s.minimum === 'number' && typeof s.maximum === 'number') return `from ${s.minimum} to ${s.maximum}`;
  if (typeof s.exclusiveMinimum === 'number') return `greater than ${s.exclusiveMinimum}`;
  if (typeof s.minimum === 'number') return `at least ${s.minimum}`;
  if (typeof s.maximum === 'number') return `at most ${s.maximum}`;
  return 'in range';
}

/**
 * The diagnostics for the problems the schema found in a deck.
 * @param {Problem[]} problems  from problems() in problems.js
 * @param {unknown} deck
 * @param {any} schema          the schema the problems come from
 * @returns {Finding[]}
 */
export function diagnose(problems, deck, schema) {
  const defs = schema.$defs;
  /** @type {Finding[]} */
  const findings = [];

  /**
   * @param {string} path @param {'key' | 'value'} at @param {string} code @param {string} message
   * @param {string} [hint]
   * @param {string} [wherePath]  the place to describe, when it is not the path: the
   *                              slide, for a slot that does not exist
   */
  const add = (path, at, code, message, hint, wherePath = path) => {
    findings.push({ severity: 'error', code, message, ...(hint ? { hint } : {}), path, where: describe(deck, wherePath).where, at });
  };

  /**
   * A field in a message: '"enter.duration"'. When the place is a whole part
   * of the deck, the name of that kind of part: 'a slide'.
   * @param {string} path
   */
  const name = (path) => {
    const { field, anchor } = describe(deck, path);
    if (field !== '') return `"${field}"`;
    const parts = segments(anchor);
    if (parts.length === 0) return 'a deck';
    if (parts[0] !== 'slides') return `"${parts[0]}"`;
    if (parts.length === 2) return 'a slide';
    return parts[2] === 'elements' ? 'an element' : parts[2] === 'slots' ? 'a slot' : '"background"';
  };

  // Values that may be a name or an object: what to call the choice when the
  // value is neither.
  const eitherOr = new Map([
    [defs.textOverride, 'a string or an object'],
    [defs.theme.else, 'a theme name or an object'],
    [defs.background.else, 'a color or an object'],
    [defs.enter.else, 'an effect name or an object'],
  ]);

  // Missing fields of one object are one diagnostic.
  /** @type {Map<string, Problem[]>} */
  const missing = new Map();
  for (const p of problems.filter((q) => q.kind === 'missing')) {
    const parent = p.error.instancePath;
    missing.set(parent, [...(missing.get(parent) ?? []), p]);
  }
  for (const [parent, group] of missing) {
    // In the order the format lists them: "x", "y", "w".
    /** @type {string[]} */
    const order = group[0].error.parentSchema?.required ?? [];
    const fields = group.map((p) => String(/** @type {any} */ (p.error.params).missingProperty))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const inside = describe(deck, parent).field;
    const message = `missing ${fields.length === 1 ? 'field' : 'fields'} ${list(fields.map((f) => `"${f}"`), 'and')}${inside ? ` in "${inside}"` : ''}`;
    let hint;
    if (fields.length === 1) {
      const field = fields[0];
      const allowed = group[0].error.parentSchema?.properties?.[field]?.enum;
      if (field === 'alt') hint = 'Describe what the image shows; it is never drawn on the slide.';
      else if (field === 'slides') hint = 'A deck needs "slides": a list with at least one slide.';
      else if (Array.isArray(allowed)) hint = `Add "${field}": ${listValues(allowed)}.`;
    }
    add(parent, 'value', 'missing-field', message, hint);
  }

  for (const p of problems) {
    const e = p.error;
    const data = e.data;
    const parentSchema = /** @type {any} */ (e.parentSchema);
    const params = /** @type {any} */ (e.params);
    const path = p.at;
    const parts = segments(path);
    const last = parts[parts.length - 1];

    switch (p.kind) {
      case 'missing':
        break;

      case 'unknown': {
        if (e.keyword === 'false schema') {
          // The schema refuses this field here, though it exists elsewhere.
          const shape = /** @type {any} */ (parts.slice(0, -1).reduce((v, k) => /** @type {any} */ (v)?.[k], deck))?.shape;
          const message = last === 'radius' && (shape === 'ellipse' || shape === 'line')
            ? `"radius" does not apply: ${shape === 'ellipse' ? 'an ellipse' : 'a line'} has no corners`
            : `${name(path)} is not allowed here`;
          add(path, 'key', 'unknown-field', message, `Remove "${last}".`);
          break;
        }
        const allowed = Object.keys(parentSchema.properties ?? {});
        const guess = closest(last, allowed);
        const parent = parts.slice(0, -1);
        if (parent[parent.length - 1] === 'slots' && parent.length === 3) {
          const slide = /** @type {any} */ (deck)?.slides?.[Number(parent[1])];
          const hint = guess ? `Did you mean "${guess}"?` : `Its slots are ${list(allowed.map((s) => `"${s}"`), 'and')}.`;
          add(path, 'key', 'unknown-slot', `the layout ${show(slide?.layout)} has no slot ${show(last)}`, hint, toPointer(parent.slice(0, -1)));
          break;
        }
        const inside = describe(deck, toPointer(parent)).field;
        const message = `unknown field ${show(last)}${inside ? ` in "${inside}"` : ''}`;
        const owners = Object.keys(elementWords).filter((def) => parentSchema !== defs[def] && Object.hasOwn(defs[def].properties, last));
        const extensible = parentSchema.patternProperties !== undefined;
        let hint;
        const inMeta = parent.length === 0 ? (Object.hasOwn(defs.meta.properties, last) ? last : closest(last, Object.keys(defs.meta.properties))) : undefined;
        if (guess) hint = `Did you mean "${guess}"?`;
        else if (inMeta) hint = `Did you mean "${inMeta}" in "meta"?`;
        else if (last.startsWith('x-') && !extensible) hint = 'Fields that start with "x-" are allowed at the top level, in "meta", on slides, on elements and in slots.';
        else if (last === 'type' && parent[parent.length - 2] === 'slots') hint = 'The layout decides what a slot is. Remove "type".';
        else if (Object.values(elementWords).includes(defWord(parentSchema)) && owners.length > 0) {
          hint = `"${last}" is a field of ${list(owners.map((o) => elementWords[o]), 'and')} elements, not of ${defWord(parentSchema)} elements.`;
        } else if (allowed.length <= MAX_LISTED) hint = `The fields here are ${list(allowed.map((f) => `"${f}"`), 'and')}.`;
        else hint = `Run "kadr docs" for the fields.${extensible ? ' Data of your own goes in fields that start with "x-".' : ''}`;
        add(path, 'key', 'unknown-field', message, hint);
        break;
      }

      case 'dependent':
        add(path, 'key', 'slots-without-layout', '"slots" without a "layout"', 'Add a "layout", such as "content", or put the content in "elements".');
        break;

      case 'type': {
        const expected = eitherOr.get(parentSchema) ?? list([params.type].flat().map((t) => typeWords[t] ?? t));
        let hint;
        if (typeof data === 'string' && /number/.test(expected) && data.trim() !== '' && Number.isFinite(Number(data))) hint = `Write ${Number(data)} without quotes.`;
        else if (params.type === 'integer' && typeof data === 'number') hint = `Use a whole number, such as ${Math.round(data)}.`;
        else if (params.type === 'string' && (typeof data === 'number' || typeof data === 'boolean')) hint = `Put it in double quotes: "${data}".`;
        // 1080.5 is a number, but not a whole one: show it.
        const actual = params.type === 'integer' && typeof data === 'number' ? show(data) : kindOf(data);
        add(path, 'value', 'wrong-type', `${name(path)} must be ${expected}, not ${actual}`, hint);
        break;
      }

      case 'value': {
        const allowed = /** @type {unknown[]} */ (params.allowedValues ?? [params.allowedValue]);
        const guess = typeof data === 'string' ? closest(data, allowed.filter((v) => typeof v === 'string')) : undefined;
        if (parentSchema === defs.fontFamily) {
          add(path, 'value', 'unknown-font', `the font ${show(data)} is not in the library`, guess ? `Did you mean "${guess}"?` : 'Run "kadr fonts" for the families.');
          break;
        }
        const scalar = typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean';
        const message = !scalar ? `${name(path)} cannot be ${kindOf(data)}`
          : parentSchema === defs.themeName ? `unknown theme ${show(data)}`
          : parentSchema === defs.layout ? `unknown layout ${show(data)}`
          : last === 'type' ? `unknown type ${show(data)}`
          : `${name(path)} cannot be ${show(data)}`;
        const hint = guess ? `Did you mean "${guess}"?` : allowed.length <= MAX_LISTED ? `Use ${listValues(allowed)}.` : undefined;
        add(path, 'value', 'bad-value', message, hint);
        break;
      }

      case 'pattern': {
        if (parentSchema === defs.src) {
          const found = address(String(data));
          add(path, 'value', found.code, found.message, found.hint);
        } else if (parentSchema === defs.hex) {
          add(path, 'value', 'bad-color', `${show(data)} is not a hex color`, 'Theme colors are written in hex, such as "#1b1440".');
        } else if (parentSchema === defs.id) {
          const fixed = String(data).trim().toLowerCase().replace(/[\s_]+/g, '-');
          const rule = 'An id starts with a lowercase letter and has only lowercase letters, digits and "-", 64 characters at most.';
          add(path, 'value', 'bad-value', `${show(data)} cannot be an id`, fixed !== data && new RegExp(defs.id.pattern).test(fixed) ? `Did you mean "${fixed}"? ${rule}` : rule);
        } else if (parentSchema === defs.meta.properties.lang) {
          add(path, 'value', 'bad-value', `${show(data)} is not a language tag`, 'Use a tag such as "en", "ru" or "pt-BR".');
        } else if (last === 'lang') {
          add(path, 'value', 'bad-value', `${show(data)} cannot be a code language`, 'Use a short lowercase name, such as "js" or "python".');
        } else {
          add(path, 'value', 'bad-value', `${name(path)} has the wrong form: ${show(data)}`);
        }
        break;
      }

      case 'range':
        add(path, 'value', 'bad-value', `${name(path)} must be ${range(parentSchema)}, not ${show(data)}`);
        break;

      case 'size': {
        const count = Array.isArray(data) ? data.length : 0;
        if (e.keyword === 'minLength' && last === 'alt') {
          add(path, 'value', 'alt-empty', 'alt is empty', 'Describe what the image shows; it is never drawn on the slide.');
        } else if (e.keyword === 'minLength') {
          add(path, 'value', 'bad-value', `${name(path)} cannot be empty`);
        } else if (path === '/slides') {
          add(path, 'value', 'bad-value', 'a deck needs at least one slide', 'Add a slide: {} is an empty one.');
        } else {
          const { minItems: min, maxItems: max } = parentSchema;
          const allowed = typeof min === 'number' && typeof max === 'number' ? `from ${min} to ${max}` : typeof min === 'number' ? `at least ${min}` : `at most ${max}`;
          add(path, 'value', 'bad-value', `${name(path)} must have ${allowed} ${last === 'colors' ? 'colors' : 'items'}, not ${count}`);
        }
        break;
      }

      case 'choice': {
        if (parentSchema === defs.color) {
          const hint = `Use a theme color (${defs.colorToken.enum.join(', ')}) or hex, such as "#ff3366".`;
          if (typeof data !== 'string') add(path, 'value', 'bad-color', `${name(path)} must be a color, not ${kindOf(data)}`, hint);
          else if (data.startsWith('#')) add(path, 'value', 'bad-color', `${show(data)} is not a hex color`, 'A hex color has 3, 4, 6 or 8 digits after "#", such as "#ff3366".');
          else add(path, 'value', 'bad-color', `${show(data)} is not a color`, hint);
          break;
        }
        // Any other choice: say what each branch would take.
        const options = p.branches.map((b) => /** @type {any} */ (b.parentSchema)).filter((s, i, all) => all.indexOf(s) === i).map((s) => {
          if (Array.isArray(s.enum)) return listValues(s.enum);
          if (s.type === 'number' || s.type === 'integer') return `${typeWords[s.type]} ${range(s)}`;
          return typeWords[s.type] ?? 'another value';
        });
        add(path, 'value', 'bad-value', `${name(path)} cannot be ${show(data)}`, `Use ${options.join(', or ')}.`);
        break;
      }

      default:
        add(path, 'value', 'bad-value', `${name(path)} is not valid`);
    }
  }

  /** @param {any} s the schema of an element type, or anything else */
  function defWord(s) {
    return Object.entries(elementWords).find(([def]) => defs[def] === s)?.[1] ?? '';
  }

  return findings;
}
