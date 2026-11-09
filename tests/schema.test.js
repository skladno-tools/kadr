// @ts-check
// Schema tests.
//
//   tests/schema/valid/*.kadr.json   decks the schema must accept with no errors
//   tests/schema/invalid/*.json      { description, deck, errors }: a deck and
//                                    the exact places the schema must reject
//
// An invalid case passes only if the schema finds errors in exactly the listed
// places: no fewer and no more. This is what keeps the schema from reporting
// false errors, such as an "unknown field" next to the real mistake.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

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

// Wrapper keywords only say that something inside them failed.
const wrappers = new Set(['if', 'anyOf', 'oneOf', 'allOf', 'not']);

/**
 * Turns the validator's errors into the set of places that are wrong, as JSON
 * Pointers. An unknown or missing field points at the field itself; a field
 * that needs another one (slots without a layout) points at the field that is
 * there. A wrapper error is dropped when a more specific error sits at or
 * below its place.
 * @param {import('ajv').ErrorObject[]} errors
 */
const places = (errors) => {
  /** @param {import('ajv').ErrorObject} e */
  const place = (e) => {
    const p = /** @type {Record<string, unknown>} */ (e.params);
    const field = e.keyword === 'dependentRequired'
      ? p.property
      : p.unevaluatedProperty ?? p.additionalProperty ?? p.missingProperty;
    return field === undefined ? e.instancePath : `${e.instancePath}/${field}`;
  };
  const specific = errors.filter((e) => !wrappers.has(e.keyword)).map(place);
  const covered = (/** @type {string} */ at) =>
    specific.some((s) => s === at || s.startsWith(`${at}/`));
  const kept = errors
    .filter((e) => !wrappers.has(e.keyword) || !covered(place(e)))
    .map(place);
  return [...new Set(kept)].sort();
};

test('the schema compiles in strict mode', () => {
  assert.doesNotThrow(() => compile(true));
});

const validate = compile(false);

/** @param {unknown} deck */
const placesOf = (deck) => (validate(deck) ? [] : places(validate.errors ?? []));

const valid = [
  ...filesIn(join(casesDir, 'valid'), '.kadr.json').map((name) => join(casesDir, 'valid', name)),
  ...filesIn(join(root, 'examples'), '.kadr.json').map((name) => join(root, 'examples', name)),
];

for (const path of valid) {
  test(`valid: ${path.slice(root.length + 1)}`, () => {
    assert.deepEqual(placesOf(readJson(path)), []);
  });
}

for (const name of filesIn(join(casesDir, 'invalid'), '.json')) {
  const { description, deck, errors } = readJson(join(casesDir, 'invalid', name));
  test(`invalid: ${name.replace(/\.json$/, '')}: ${description}`, () => {
    assert.deepEqual(placesOf(deck), [...errors].sort());
  });
}
