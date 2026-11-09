// @ts-check
// Schema tests.
//
//   tests/schema/valid/*.kadr.json   decks the schema must accept with no errors
//   tests/schema/invalid/*.json      { description, deck, errors }: a deck and
//                                    the exact problems the schema must find,
//                                    each a place and a kind: { at, kind }
//
// An invalid case passes only if the schema finds exactly the listed problems:
// no fewer and no more, each of the right kind. This is what keeps the schema
// from reporting false errors, such as an "unknown field" next to the real
// mistake, and a case from passing for the wrong reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = join(root, 'schema', '0.1', 'kadr.schema.json');
const casesDir = join(root, 'tests', 'schema');

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** @param {string} dir @param {string} suffix */
const filesIn = (dir, suffix) =>
  readdirSync(dir).filter((name) => name.endsWith(suffix)).sort();

/** @param {boolean} strict */
const compile = (strict) =>
  new Ajv2020({ allErrors: true, strict }).compile(readJson(schemaPath));

// What kind of mistake each validator keyword reports. The kinds are close to
// the diagnostic codes in docs/cli.md, so a case says not only where the
// schema must object but what it must object to: a missing "alt" and an
// unknown "alt" are different mistakes at the same place.
/** @type {Record<string, string>} */
const kinds = {
  required: 'missing',
  additionalProperties: 'unknown',
  unevaluatedProperties: 'unknown',
  dependentRequired: 'dependent',
  type: 'type',
  enum: 'value',
  const: 'value',
  pattern: 'pattern',
  minimum: 'range',
  maximum: 'range',
  exclusiveMinimum: 'range',
  exclusiveMaximum: 'range',
  minItems: 'size',
  maxItems: 'size',
  minLength: 'size',
  maxLength: 'size',
};

// Wrapper keywords only say that something inside them failed.
const wrappers = new Set(['if', 'anyOf', 'oneOf', 'allOf', 'not']);

/**
 * @typedef {object} Problem
 * @property {string} at    JSON Pointer of the wrong place
 * @property {string} kind  one of the kinds above, or "choice"
 */

/**
 * Turns the validator's errors into a sorted list of problems.
 *
 * - An unknown or missing field points at the field itself; a field that
 *   needs another one (slots without a layout) points at the field that is
 *   there.
 * - When every branch of an anyOf fails at the anyOf's own place (a color that
 *   is neither a theme name nor hex), that is one problem of kind "choice".
 * - Any other wrapper error is dropped when a more specific error sits at or
 *   below its place. One that does not is kept under its own keyword, so the
 *   test shows it.
 * @param {import('ajv').ErrorObject[]} errors
 * @returns {Problem[]}
 */
const problems = (errors) => {
  /** @param {import('ajv').ErrorObject} e */
  const place = (e) => {
    const p = /** @type {Record<string, unknown>} */ (e.params);
    const field = e.keyword === 'dependentRequired'
      ? p.property
      : p.unevaluatedProperty ?? p.additionalProperty ?? p.missingProperty;
    return field === undefined ? e.instancePath : `${e.instancePath}/${field}`;
  };
  /** @param {import('ajv').ErrorObject} e */
  const kind = (e) => {
    const k = kinds[e.keyword];
    if (k === undefined) throw new Error(`no kind for the keyword "${e.keyword}"; add one to the table`);
    return k;
  };
  const specific = errors.filter((e) => !wrappers.has(e.keyword));
  const below = (/** @type {string} */ at) =>
    specific.some((e) => place(e).startsWith(`${at}/`));
  /** @type {Map<string, Problem>} */
  const found = new Map();
  const add = (/** @type {string} */ at, /** @type {string} */ k) => found.set(`${at} ${k}`, { at, kind: k });
  /** @type {Set<import('ajv').ErrorObject>} */
  const absorbed = new Set();
  for (const e of errors.filter((w) => w.keyword === 'anyOf')) {
    const at = e.instancePath;
    const branches = specific.filter((s) => place(s) === at);
    if (branches.length > 0 && !below(at)) {
      branches.forEach((b) => absorbed.add(b));
      add(at, 'choice');
    }
  }
  for (const e of specific) if (!absorbed.has(e)) add(place(e), kind(e));
  for (const e of errors.filter((w) => wrappers.has(w.keyword) && w.keyword !== 'anyOf')) {
    const at = place(e);
    if (!specific.some((s) => place(s) === at) && !below(at)) add(at, e.keyword);
  }
  return [...found.values()].sort((a, b) => (a.at === b.at ? a.kind.localeCompare(b.kind) : a.at < b.at ? -1 : 1));
};

test('the schema compiles in strict mode', () => {
  assert.doesNotThrow(() => compile(true));
});

const validate = compile(false);

/** @param {unknown} deck */
const problemsOf = (deck) => (validate(deck) ? [] : problems(validate.errors ?? []));

const valid = [
  ...filesIn(join(casesDir, 'valid'), '.kadr.json').map((name) => join(casesDir, 'valid', name)),
  ...filesIn(join(root, 'examples'), '.kadr.json').map((name) => join(root, 'examples', name)),
];

for (const path of valid) {
  test(`valid: ${path.slice(root.length + 1)}`, () => {
    assert.deepEqual(problemsOf(readJson(path)), []);
  });
}

for (const name of filesIn(join(casesDir, 'invalid'), '.json')) {
  const { description, deck, errors } = readJson(join(casesDir, 'invalid', name));
  test(`invalid: ${name.replace(/\.json$/, '')}: ${description}`, () => {
    /** @type {Problem[]} */
    const expected = errors;
    assert.deepEqual(problemsOf(deck), [...expected].sort((a, b) => (a.at === b.at ? a.kind.localeCompare(b.kind) : a.at < b.at ? -1 : 1)));
  });
}
