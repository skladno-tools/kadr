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
  new Ajv2020({ allErrors: true, strict, verbose: true }).compile(schema);

// What kind of mistake each validator keyword reports. The kinds are close to
// the diagnostic codes in docs/cli.md, so a case says not only where the
// schema must object but what it must object to: a missing "alt" and an
// unknown "alt" are different mistakes at the same place.
/** @type {Record<string, string>} */
const kinds = {
  required: 'missing',
  additionalProperties: 'unknown',
  unevaluatedProperties: 'unknown',
  'false schema': 'unknown',
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

/**
 * @typedef {object} Problem
 * @property {string} at    JSON Pointer of the wrong place
 * @property {string} kind  one of the kinds above, "choice", or a wrapper keyword
 */

const schema = readJson(schemaPath);

/**
 * The schemas an anyOf chooses between, with references resolved.
 * @param {unknown[]} branches
 */
const resolve = (branches) => new Set(branches.map((b) => {
  const ref = /** @type {{ $ref?: string }} */ (b).$ref;
  if (ref === undefined) return b;
  const name = /^#\/\$defs\/([^/]+)$/.exec(ref)?.[1];
  if (name === undefined) throw new Error(`unexpected reference ${ref}`);
  return schema.$defs[name];
}));

/**
 * Turns the validator's errors into a sorted list of problems. Every error
 * counts: the same mistake reported twice is two problems, so a schema that
 * reports one thing twice fails its case.
 *
 * - An unknown or missing field points at the field itself; a field that
 *   needs another one (slots without a layout) points at the field that is
 *   there.
 * - When every branch of an anyOf fails at the anyOf's own place (a color that
 *   is neither a theme name nor hex), the branch errors are one problem of
 *   kind "choice". Branch errors are recognised by the schema that reported
 *   them, so an unrelated error at the same place is still reported.
 * - "if" and "allOf" errors are dropped: the validator reports them only
 *   together with the errors inside them. Other wrappers ("not", "oneOf")
 *   are reported under their own keyword; this schema uses neither.
 * @param {import('ajv').ErrorObject[]} errors  from a validator with verbose: true
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
  /** @type {Problem[]} */
  const found = [];
  /** @type {Set<import('ajv').ErrorObject>} */
  const absorbed = new Set();
  for (const e of errors.filter((w) => w.keyword === 'anyOf')) {
    const branches = resolve(/** @type {unknown[]} */ (e.schema));
    const mine = errors.filter((b) => b.instancePath === e.instancePath && branches.has(b.parentSchema));
    const elsewhere = errors.some((b) => b.instancePath.startsWith(`${e.instancePath}/`) && !absorbed.has(b));
    if (mine.length > 0 && !elsewhere) {
      mine.forEach((b) => absorbed.add(b));
      found.push({ at: e.instancePath, kind: 'choice' });
    }
  }
  for (const e of errors) {
    if (absorbed.has(e) || e.keyword === 'anyOf' || e.keyword === 'if' || e.keyword === 'allOf') continue;
    found.push({ at: place(e), kind: e.keyword === 'not' || e.keyword === 'oneOf' ? e.keyword : kind(e) });
  }
  return found.sort(byPlace);
};

/** @param {Problem} a @param {Problem} b */
const byPlace = (a, b) => (a.at === b.at ? a.kind.localeCompare(b.kind) : a.at < b.at ? -1 : 1);

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
    assert.deepEqual(problemsOf(deck), [...expected].sort(byPlace));
  });
}
