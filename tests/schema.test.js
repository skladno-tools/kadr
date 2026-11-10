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
import { schemaOf, validate } from '../src/format/schema.js';
import { problems } from '../src/format/problems.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(root, 'tests', 'schema');
const schema = schemaOf('0.1');

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** @param {string} dir @param {string} suffix */
const filesIn = (dir, suffix) =>
  readdirSync(dir).filter((name) => name.endsWith(suffix)).sort();

/** @typedef {{ at: string, kind: string }} Expected */

/** @param {Expected} a @param {Expected} b */
const byPlace = (a, b) => (a.at === b.at ? a.kind.localeCompare(b.kind) : a.at < b.at ? -1 : 1);

test('the schema compiles in strict mode, without warnings', () => {
  /** @type {unknown[]} */
  const logged = [];
  const logger = { log: (/** @type {unknown} */ m) => logged.push(m), warn: (/** @type {unknown} */ m) => logged.push(m), error: (/** @type {unknown} */ m) => logged.push(m) };
  assert.doesNotThrow(() => new Ajv2020({ strict: true, logger }).compile(structuredClone(schema)));
  assert.deepEqual(logged, []);
});

/**
 * The problems the schema finds in a deck, as place and kind.
 * @param {unknown} deck
 * @returns {Expected[]}
 */
const problemsOf = (deck) => problems(validate('0.1', deck), schema).map(({ at, kind }) => ({ at, kind }));

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
    /** @type {Expected[]} */
    const expected = errors;
    assert.deepEqual(problemsOf(deck), [...expected].sort(byPlace));
  });
}
