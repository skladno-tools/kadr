// @ts-check
// Tests of the JSON reader (src/format/json.js).
//
// The reader must agree with JSON.parse on every text: the same value for
// valid JSON, an error for invalid JSON. That is checked on every deck in the
// repository and on generated texts, valid and broken. The rest checks what
// JSON.parse does not do: positions, messages and duplicate keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJson, MAX_DEPTH } from '../src/format/json.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} text */
const reference = (text) => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: undefined };
  }
};

/**
 * Asserts that the reader agrees with JSON.parse on the text. JSON.parse
 * accepts duplicate keys and keeps the last; the reader reports them but must
 * still return the same value.
 * @param {string} text
 */
const agrees = (text) => {
  const ref = reference(text);
  const got = parseJson(text);
  const codes = got.diagnostics.map((d) => d.code);
  if (ref.ok) {
    assert.ok(!codes.includes('json-syntax'), `valid JSON reported as invalid: ${JSON.stringify(text)}\n${JSON.stringify(got.diagnostics)}`);
    assert.deepEqual(got.value, ref.value);
    assert.equal(got.ok, codes.length === 0);
  } else {
    assert.equal(got.ok, false, `invalid JSON accepted: ${JSON.stringify(text)}`);
    assert.deepEqual(codes.filter((c) => c === 'json-syntax'), ['json-syntax']);
  }
};

// A small deterministic random generator, so failures can be reproduced.
const random = (/** @type {number} */ seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** @param {() => number} rnd */
const generator = (rnd) => {
  /** @template T @param {T[]} list @returns {T} */
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const chars = ['a', 'Z', '0', ' ', '"', '\\', '/', '\n', '\t', '\u0001', 'ж', 'Ё', 'é', ' ', '😀', '\ud800', '~', '_'];
  const string = () => Array.from({ length: Math.floor(rnd() * 6) }, () => pick(chars)).join('');
  const numbers = [0, -0, 1, -1, 42, 3.14, -2.5e-7, 1e21, 123456789012, 0.1, Number.MAX_SAFE_INTEGER];
  /** @param {number} depth @returns {unknown} */
  const value = (depth) => {
    const r = rnd();
    if (depth > 4 || r < 0.35) return pick([() => string(), () => pick(numbers), () => true, () => false, () => null])();
    if (r < 0.65) return Array.from({ length: Math.floor(rnd() * 4) }, () => value(depth + 1));
    /** @type {Record<string, unknown>} */
    const obj = {};
    for (let i = Math.floor(rnd() * 4); i > 0; i--) obj[pick(['a', 'b', 'id', 'x-y', 'a/b', 'm~n', '', '__proto__', 'ключ', string()])] = value(depth + 1);
    return obj;
  };
  const space = () => pick(['', '', ' ', '\n', '\r\n', '\r', '\t', '  ']);
  /** @param {string} s */
  const quote = (s) => {
    // Escape some characters the long way, to exercise every escape.
    let out = '"';
    for (const ch of JSON.stringify(s).slice(1, -1).match(/\\u[0-9a-fA-F]{4}|\\.|[\s\S]/g) ?? []) {
      if (ch.length === 1 && rnd() < 0.15) out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      else if (ch === '/' && rnd() < 0.5) out += '\\/';
      else out += ch;
    }
    return out + '"';
  };
  /** @param {unknown} v @returns {string} */
  const write = (v) => {
    if (Array.isArray(v)) return `[${space()}${v.map((x) => write(x) + space()).join(`,${space()}`)}]`;
    if (v && typeof v === 'object') {
      return `{${space()}${Object.keys(v).map((k) => `${quote(k)}${space()}:${space()}${write(/** @type {any} */ (v)[k])}${space()}`).join(`,${space()}`)}}`;
    }
    if (typeof v === 'string') return quote(v);
    if (typeof v === 'number' && Object.is(v, -0)) return '-0';
    return JSON.stringify(v);
  };
  return { value, write, pick, space };
};

test('every deck in the repository reads exactly as JSON.parse reads it', () => {
  const dirs = ['examples', 'tests/schema/valid'];
  for (const dir of dirs) {
    for (const name of readdirSync(join(root, dir)).filter((n) => n.endsWith('.json'))) {
      const text = readFileSync(join(root, dir, name), 'utf8');
      const got = parseJson(text);
      assert.deepEqual(got.diagnostics, [], name);
      assert.deepEqual(got.value, JSON.parse(text), name);
    }
  }
  for (const name of readdirSync(join(root, 'tests/schema/invalid'))) {
    const text = readFileSync(join(root, 'tests/schema/invalid', name), 'utf8');
    assert.deepEqual(parseJson(text).value, JSON.parse(text), name);
  }
});

test('generated valid texts read exactly as JSON.parse reads them', () => {
  const { value, write, space } = generator(random(1));
  for (let i = 0; i < 20000; i++) agrees(space() + write(value(0)) + space());
});

test('generated broken texts are rejected exactly when JSON.parse rejects them', () => {
  const rnd = random(2);
  const { value, write, pick } = generator(rnd);
  const noise = ['{', '}', '[', ']', ',', ':', '"', '\\', '/', '*', ' ', '\n', '0', '1', '-', '+', '.', 'e', 'E', 'a', 't', 'n', 'u', "'", 'x', '\u0000', '﻿'];
  for (let i = 0; i < 20000; i++) {
    let text = write(value(0));
    for (let edits = 1 + Math.floor(rnd() * 3); edits > 0; edits--) {
      const at = Math.floor(rnd() * (text.length + 1));
      const r = rnd();
      if (r < 0.4) text = text.slice(0, at) + text.slice(at + 1);
      else if (r < 0.8) text = text.slice(0, at) + pick(noise) + text.slice(at);
      else text = text.slice(0, at) + text.slice(at, at + 4) + text.slice(at);
    }
    // A byte order mark at the very start is the one thing the reader accepts
    // and JSON.parse does not.
    if (text.charCodeAt(0) === 0xfeff) text = ' ' + text;
    agrees(text);
  }
});

test('every value has a place, and members have the place of their key', () => {
  const text = '{\n  "a": 1,\n  "list": [true, {"b": null}],\n  "x/y~z": "s"\n}';
  const { places, diagnostics } = parseJson(text);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(Object.fromEntries(places), {
    '': { value: { line: 1, column: 1 } },
    '/a': { key: { line: 2, column: 3 }, value: { line: 2, column: 8 } },
    '/list/0': { value: { line: 3, column: 12 } },
    '/list/1/b': { key: { line: 3, column: 19 }, value: { line: 3, column: 24 } },
    '/list/1': { value: { line: 3, column: 18 } },
    '/list': { key: { line: 3, column: 3 }, value: { line: 3, column: 11 } },
    '/x~1y~0z': { key: { line: 4, column: 3 }, value: { line: 4, column: 12 } },
  });
});

test('lines and columns: any line break, tabs, Cyrillic, emoji, byte order mark', () => {
  const at = (/** @type {string} */ text, /** @type {string} */ path) => parseJson(text).places.get(path)?.value;
  assert.deepEqual(at('{\r\n"a":\r\n1}', '/a'), { line: 3, column: 1 });
  assert.deepEqual(at('{\r"a":\r1}', '/a'), { line: 3, column: 1 });
  assert.deepEqual(at('{\n\t"a":\t1}', '/a'), { line: 2, column: 7 });
  assert.deepEqual(at('{"ключ": 1, "b": 2}', '/b'), { line: 1, column: 18 });
  assert.deepEqual(at('{"😀": 1, "b": 2}', '/b'), { line: 1, column: 15 });
  assert.deepEqual(at('﻿{"a": 1}', '/a'), { line: 1, column: 7 });
  assert.deepEqual(parseJson('﻿{"a": 1}').value, { a: 1 });
});

test('duplicate keys are all reported, at the second key, and reading goes on', () => {
  const { ok, value, diagnostics } = parseJson('{"a": 1,\n "b": {"c": 1, "c": 2},\n "a": 3}');
  assert.equal(ok, false);
  assert.deepEqual(value, { a: 3, b: { c: 2 } });
  assert.deepEqual(diagnostics, [
    {
      severity: 'error', code: 'json-duplicate-key', message: 'the key "c" appears twice in one object',
      hint: 'It first appears on line 2. Keep one of them.', path: '/b/c', line: 2, column: 16,
    },
    {
      severity: 'error', code: 'json-duplicate-key', message: 'the key "a" appears twice in one object',
      hint: 'It first appears on line 1. Keep one of them.', path: '/a', line: 3, column: 2,
    },
  ]);
});

test('"__proto__" is an ordinary member and cannot change the object', () => {
  const { value } = parseJson('{"__proto__": {"polluted": true}, "a": {"__proto__": null}}');
  const obj = /** @type {Record<string, any>} */ (value);
  assert.equal(Object.getPrototypeOf(obj), Object.prototype);
  assert.deepEqual(Object.keys(obj), ['__proto__', 'a']);
  assert.deepEqual(Object.getOwnPropertyDescriptor(obj, '__proto__')?.value, { polluted: true });
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
  assert.deepEqual(value, JSON.parse('{"__proto__": {"polluted": true}, "a": {"__proto__": null}}'));
});

test('reading time grows linearly, even when the whole file is one line', () => {
  // Scripts and AI tools often write a deck as one line (JSON.stringify with
  // no indentation). Finding a column must not mean counting from the start
  // of the line for every value, which would make reading quadratic.
  const slides = Array.from({ length: 8000 }, (_, i) => ({
    id: `s${i}`, layout: 'content', slots: { title: `Slide ${i}`, body: '- one\n- two' },
  }));
  const image = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
  const deck = { kadr: '0.1', slides: [{ layout: 'image', slots: { image: { src: image, alt: 'An image' } } }, ...slides] };
  const oneLine = JSON.stringify(deck);
  const duplicates = `{${Array.from({ length: 20000 }, () => '"a":1').join(',')}}`;
  for (const [name, text] of [['a 1.8 MB deck on one line', oneLine], ['20,000 duplicate keys on one line', duplicates]]) {
    const started = performance.now();
    const got = parseJson(text);
    const ms = performance.now() - started;
    assert.ok(got.value !== undefined, name);
    // A linear reader takes well under a second here; a quadratic one, minutes.
    assert.ok(ms < 3000, `${name}: ${Math.round(ms)} ms`);
  }
  assert.deepEqual(parseJson(oneLine).value, deck);
});

test(`nesting up to ${MAX_DEPTH} levels is read; deeper is refused`, () => {
  assert.equal(parseJson('['.repeat(MAX_DEPTH) + ']'.repeat(MAX_DEPTH)).ok, true);
  assert.equal(parseJson('{"a":'.repeat(MAX_DEPTH) + '1' + '}'.repeat(MAX_DEPTH)).ok, true);
  const deep = parseJson('['.repeat(MAX_DEPTH + 1) + ']'.repeat(MAX_DEPTH + 1));
  assert.deepEqual(deep.diagnostics.map((d) => [d.message, d.column]), [[`the nesting is deeper than ${MAX_DEPTH} levels`, MAX_DEPTH + 1]]);
  // Far deeper input must not exhaust the stack.
  assert.equal(parseJson('['.repeat(100000)).ok, false);
});

// [text, message, hint, line, column]
/** @type {[string, string, string | undefined, number, number][]} */
const syntax = [
  ['', 'the file is empty', 'A deck is a JSON object: { "kadr": "0.1", "slides": [{}] }.', 1, 1],
  [' \n ', 'the file is empty', 'A deck is a JSON object: { "kadr": "0.1", "slides": [{}] }.', 2, 2],
  ['{"a": 1,}', 'a trailing comma is not allowed in JSON', 'Remove the comma after the last member.', 1, 8],
  ['[1, 2,\n]', 'a trailing comma is not allowed in JSON', 'Remove the comma after the last item.', 1, 6],
  ['{"a": 1 // note\n}', 'comments are not allowed in JSON', 'Remove the comment, or keep notes in "notes" or an "x-" field.', 1, 9],
  ['/* note */ {}', 'comments are not allowed in JSON', 'Remove the comment, or keep notes in "notes" or an "x-" field.', 1, 1],
  ["{'a': 1}", 'keys use double quotes in JSON', 'Replace the single quotes with double quotes.', 1, 2],
  ["{\"a\": 'b'}", 'strings use double quotes in JSON', 'Replace the single quotes with double quotes.', 1, 7],
  ['{a: 1}', 'a key must be in double quotes', 'Put the key in double quotes.', 1, 2],
  ['{"a": 1 "b": 2}', 'a comma is missing between members', 'Add a comma after the previous value.', 1, 9],
  ['[1 2]', 'a comma is missing between items', 'Add a comma after the previous item.', 1, 4],
  ['{"a" 1}', 'expected ":" after the key, found "1"', undefined, 1, 6],
  ['{"a": 1', 'the file ends inside an object', 'Close the object with "}".', 1, 8],
  ['[1, 2', 'the file ends inside a list', 'Close the list with "]".', 1, 6],
  ['{"a": ', 'the file ends where a value is expected', undefined, 1, 7],
  ['{"a": "b}', 'the string is not closed', 'Add the closing double quote.', 1, 7],
  ['{"a": "b\nc"}', 'a string cannot span lines', 'Write \\n for a line break inside a string.', 1, 9],
  ['"a\tb"', 'the control character U+0009 is not allowed inside a string', 'Write it as an escape, such as \\t for a tab.', 1, 3],
  ['"\\x"', '"\\x" is not a JSON escape', 'Escapes are \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX. Write a backslash as \\\\.', 1, 2],
  ['"\\u12"', '"\\u" needs four hexadecimal digits', 'Write it as \\u0041, for example.', 1, 2],
  ['[01]', 'a number cannot start with 0 followed by more digits', 'Remove the leading zeros.', 1, 2],
  ['[+1]', 'a number cannot start with "+"', 'Remove the "+".', 1, 2],
  ['[.5]', 'a number needs a digit before the point', 'Write 0.5 rather than .5.', 1, 2],
  ['[-.5]', 'a number needs a digit before the point', 'Write -0.5 rather than -.5.', 1, 2],
  ['[1.]', 'a number needs a digit after the point', 'Write 1.0 or 1 rather than 1.', 1, 3],
  ['[1e]', 'the exponent needs digits', 'Write 1e3, for example.', 1, 3],
  ['[-]', 'a number is expected after "-"', undefined, 1, 2],
  ['[1.5.3]', 'expected "," or "]", found "."', undefined, 1, 5],
  ['[NaN]', 'NaN is not a JSON value', 'Use a number, or null.', 1, 2],
  ['{"a": undefined}', 'undefined is not a JSON value', 'Use a number, or null.', 1, 7],
  ['[True]', 'unexpected word "True"', 'Text values go in double quotes.', 1, 2],
  ['{"a": 1}}', 'unexpected text after the end of the JSON value', 'A file holds one JSON value. Remove what follows it.', 1, 9],
  ['{"a": 1} {"b": 2}', 'unexpected text after the end of the JSON value', 'A file holds one JSON value. Remove what follows it.', 1, 10],
  ['{,}', 'expected a key in double quotes, found ","', undefined, 1, 2],
  ['{"a": \u0001}', 'expected a value, found the control character U+0001', undefined, 1, 7],
];

for (const [text, message, hint, line, column] of syntax) {
  test(`syntax: ${JSON.stringify(text)}: ${message}`, () => {
    const got = parseJson(text);
    assert.equal(got.ok, false);
    assert.equal(got.value, undefined);
    assert.deepEqual(got.diagnostics, [
      { severity: 'error', code: 'json-syntax', message, ...(hint ? { hint } : {}), line, column },
    ]);
    assert.equal(reference(text).ok, false);
  });
}
