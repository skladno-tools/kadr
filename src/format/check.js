// @ts-check
// Checks the text of a deck: reads the JSON, finds the format version,
// validates against the schema of that version, and returns diagnostics with
// the place of each one in the text.
//
// The checks beyond the schema (docs/format.md section 15) are not here yet.
// Uses no Node and no DOM APIs: the CLI and the browser editor share it.

import { parseJson } from './json.js';
import { versions, newest, schemaOf, validate } from './schema.js';
import { problems } from './problems.js';
import { diagnose } from './diagnose.js';
import { describe } from './where.js';
import { show, kindOf, list } from './show.js';

/**
 * @typedef {object} Diagnostic
 * @property {'error' | 'warning'} severity
 * @property {string} code     stable; see docs/cli.md section 4
 * @property {string} message  what is wrong
 * @property {string} [hint]   what to do about it
 * @property {string} path     JSON Pointer of the value concerned; "" for the whole deck
 * @property {string} where    where that is, in words
 * @property {number} line     counted from 1
 * @property {number} column   counted from 1, in characters
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok                  no errors (warnings do not count)
 * @property {string} [version]            the format version, when the deck names one Kadr knows
 * @property {unknown} deck                the deck as read; undefined when the text is not JSON
 * @property {Diagnostic[]} diagnostics    in the order of the text
 */

const versionForm = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** @param {string} a @param {string} b  both of the form "1.2" */
const newer = (a, b) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 !== b1 ? a1 > b1 : a2 > b2;
};

/**
 * Checks the text of a deck.
 * @param {string} text
 * @returns {CheckResult}
 */
export function check(text) {
  const read = parseJson(text);
  const deck = read.value;
  /** @type {Diagnostic[]} */
  const diagnostics = read.diagnostics.map((d) => ({
    severity: d.severity,
    code: d.code,
    message: d.message,
    ...(d.hint ? { hint: d.hint } : {}),
    path: d.path ?? '',
    where: d.code === 'json-syntax' || d.path === undefined ? 'file' : describe(deck, d.path).where,
    line: d.line,
    column: d.column,
  }));

  /**
   * @param {string} path @param {'key' | 'value'} at
   * @param {Omit<Diagnostic, 'line' | 'column' | 'path'>} rest
   */
  const add = (path, at, rest) => {
    const place = read.places.get(path);
    const position = (at === 'key' ? place?.key : undefined) ?? place?.value ?? read.places.get('')?.value ?? { line: 1, column: 1 };
    const { severity, code, message, hint, where } = rest;
    diagnostics.push({ severity, code, message, ...(hint ? { hint } : {}), path, where, line: position.line, column: position.column });
  };

  /** @returns {CheckResult} */
  const done = (/** @type {string} */ version = '') => {
    diagnostics.sort((a, b) => a.line - b.line || a.column - b.column || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    return {
      ok: !diagnostics.some((d) => d.severity === 'error'),
      ...(version ? { version } : {}),
      deck,
      diagnostics,
    };
  };

  // Not JSON at all: nothing more can be said.
  if (diagnostics.some((d) => d.code === 'json-syntax')) return done();

  if (deck === null || typeof deck !== 'object' || Array.isArray(deck)) {
    add('', 'value', {
      severity: 'error', code: 'wrong-type', where: 'deck',
      message: `a deck must be an object, not ${kindOf(deck)}`,
      hint: `A deck looks like this: { "kadr": "${newest}", "slides": [{}] }.`,
    });
    return done();
  }

  // The version decides which schema applies, so a wrong version is reported
  // alone: one clear diagnostic rather than dozens of follow-on errors.
  const named = Object.hasOwn(deck, 'kadr') ? /** @type {Record<string, unknown>} */ (deck).kadr : undefined;
  const write = `Write "kadr": "${newest}".`;
  if (!Object.hasOwn(deck, 'kadr')) {
    add('', 'value', { severity: 'error', code: 'version-missing', where: 'deck', message: 'missing field "kadr"', hint: `Every deck names its format version. ${write}` });
    return done();
  }
  if (typeof named !== 'string' || !versionForm.test(named)) {
    const asText = typeof named === 'number' && versionForm.test(String(named)) ? String(named) : undefined;
    add('/kadr', 'value', {
      severity: 'error', code: 'version-invalid', where: 'deck',
      message: `"kadr" must be a version such as "${newest}", not ${typeof named === 'string' || typeof named === 'number' ? show(named) : kindOf(named)}`,
      hint: asText ? `A version is a string. Put it in quotes: "${asText}".` : write,
    });
    return done();
  }
  if (!versions.includes(named)) {
    const known = `This Kadr knows ${versions.length === 1 ? 'the format' : 'the formats'} ${list(versions.map((v) => `"${v}"`), 'and')}.`;
    if (newer(named, newest)) {
      add('/kadr', 'value', { severity: 'error', code: 'version-newer', where: 'deck', message: `the deck is in the format "${named}", which is newer than this Kadr`, hint: `${known} Update Kadr to read this deck.` });
    } else {
      add('/kadr', 'value', { severity: 'error', code: 'version-unknown', where: 'deck', message: `there is no format version "${named}"`, hint: `${known} ${write}` });
    }
    return done();
  }

  const schema = schemaOf(named);
  for (const finding of diagnose(problems(validate(named, deck), schema), deck, schema)) {
    add(finding.path, finding.at, finding);
  }
  return done(named);
}
