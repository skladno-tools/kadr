// @ts-check
// Tests of check (src/format/check.js): from the text of a deck to
// diagnostics with codes, places in words and positions in the text.
//
// The wording of every diagnostic is pinned in case files, so a change of
// wording shows in review:
//
//   tests/schema/invalid/*.json  next to the problems the schema must find,
//                                the "diagnostics" check must give for them
//   tests/checks/*.json          a deck that passes the schema, and the exact
//                                diagnostics of the checks beyond the schema;
//                                "files" lists the image files that exist

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/format/check.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = join(root, 'tests', 'schema');

/** @param {string} dir @param {string} suffix */
const filesIn = (dir, suffix) => readdirSync(dir).filter((name) => name.endsWith(suffix)).sort().map((name) => join(dir, name));

/** A diagnostic without its position. @param {import('../src/format/check.js').Diagnostic} d */
const slim = ({ code, where, path, message, hint }) => ({ code, where, path, message, ...(hint ? { hint } : {}) });

for (const path of [...filesIn(join(casesDir, 'valid'), '.kadr.json'), ...filesIn(join(root, 'examples'), '.kadr.json')]) {
  test(`valid: ${path.slice(root.length + 1)}`, () => {
    // Valid by the schema: no errors. Warnings, such as one for an image
    // loaded from the network, are pinned in tests/checks.
    const result = check(readFileSync(path, 'utf8'));
    assert.deepEqual(result.diagnostics.filter((d) => d.severity === 'error'), []);
    assert.equal(result.ok, true);
    assert.equal(result.version, '0.1');
  });
}

for (const path of filesIn(join(casesDir, 'invalid'), '.json')) {
  const { description, deck, diagnostics } = JSON.parse(readFileSync(path, 'utf8'));
  test(`diagnostics: ${path.slice(casesDir.length + 9, -5)}: ${description}`, () => {
    const result = check(JSON.stringify(deck, null, 2));
    assert.deepEqual(result.diagnostics.map(slim), diagnostics);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.every((d) => d.severity === 'error' && d.line >= 1 && d.column >= 1));
  });
}

for (const path of filesIn(join(root, 'tests', 'checks'), '.json')) {
  const { description, deck, files, diagnostics } = JSON.parse(readFileSync(path, 'utf8'));
  test(`checks: ${path.slice(root.length + 14, -5)}: ${description}`, () => {
    /** @type {import('../src/format/checks.js').Options} */
    const options = files ? { exists: (/** @type {string} */ p) => files.includes(p) } : {};
    const result = check(JSON.stringify(deck, null, 2), options);
    assert.deepEqual(result.diagnostics.map((d) => ({ severity: d.severity, ...slim(d) })), diagnostics);
    assert.equal(result.ok, !diagnostics.some((/** @type {{ severity: string }} */ d) => d.severity === 'error'));
  });
}

test('the example deck gets no diagnostics at all, and its images exist', () => {
  const text = readFileSync(join(root, 'examples', 'hello.kadr.json'), 'utf8');
  const result = check(text, { exists: (p) => existsSync(join(root, 'examples', p)) });
  assert.deepEqual(result.diagnostics, []);
});

test('the checks beyond the schema wait until the deck passes the schema', () => {
  // Two elements share an id, but one of them also has an unknown field.
  const result = check(JSON.stringify({ kadr: '0.1', slides: [{ elements: [
    { type: 'text', id: 'a', x: 0, y: 0, w: 100, content: 'One', aling: 'left' },
    { type: 'text', id: 'a', x: 0, y: 0, w: 100, content: 'Two' },
  ] }] }));
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['unknown-field']);
});

test('each diagnostic points at the place to edit', () => {
  const text = [
    '{',
    '  "kadr": "0.1",',
    '  "slides": [',
    '    {',
    '      "id": "intro",',
    '      "elements": [',
    '        { "type": "text", "id": "tagline", "x": 0, "y": 0, "w": 100, "content": "Hi", "aling": "left" },',
    '        { "type": "image", "x": 0, "y": 0, "w": 100, "h": 100, "src": "a.png" },',
    '        { "type": "shape", "shape": "rect", "x": 0, "y": 0, "w": 100, "h": 100, "fill": "red" }',
    '      ]',
    '    }',
    '  ]',
    '}',
  ];
  const column = (/** @type {number} */ line, /** @type {string} */ part) => text[line - 1].indexOf(part) + 1;
  assert.deepEqual(check(text.join('\n')).diagnostics, [
    {
      // An unknown field: its key.
      severity: 'error', code: 'unknown-field', message: 'unknown field "aling"', hint: 'Did you mean "align"?',
      path: '/slides/0/elements/0/aling', where: 'slide 1 "intro", element "tagline"', line: 7, column: column(7, '"aling"'),
    },
    {
      // A missing field: the object it is missing from.
      severity: 'error', code: 'missing-field', message: 'missing field "alt"', hint: 'Describe what the image shows; it is never drawn on the slide.',
      path: '/slides/0/elements/1', where: 'slide 1 "intro", element 2', line: 8, column: column(8, '{'),
    },
    {
      // A wrong value: the value.
      severity: 'error', code: 'bad-color', message: '"red" is not a color',
      hint: 'Use a theme color (bg, surface, text, muted, accent, accent2) or hex, such as "#ff3366".',
      path: '/slides/0/elements/2/fill', where: 'slide 1 "intro", element 3', line: 9, column: column(9, '"red"'),
    },
  ]);
});

// [the value of "kadr" as JSON text, or null for no field; code; message; hint]
/** @type {[string | null, string, string, string][]} */
const versions = [
  [null, 'version-missing', 'missing field "kadr"', 'Every deck names its format version. Write "kadr": "0.1".'],
  ['0.1', 'version-invalid', '"kadr" must be a version such as "0.1", not 0.1', 'A version is a string. Put it in quotes: "0.1".'],
  ['1', 'version-invalid', '"kadr" must be a version such as "0.1", not 1', 'Write "kadr": "0.1".'],
  ['"1"', 'version-invalid', '"kadr" must be a version such as "0.1", not "1"', 'Write "kadr": "0.1".'],
  ['"v0.1"', 'version-invalid', '"kadr" must be a version such as "0.1", not "v0.1"', 'Write "kadr": "0.1".'],
  ['"0.1.0"', 'version-invalid', '"kadr" must be a version such as "0.1", not "0.1.0"', 'Write "kadr": "0.1".'],
  ['" 0.1"', 'version-invalid', '"kadr" must be a version such as "0.1", not " 0.1"', 'Write "kadr": "0.1".'],
  ['null', 'version-invalid', '"kadr" must be a version such as "0.1", not null', 'Write "kadr": "0.1".'],
  ['["0.1"]', 'version-invalid', '"kadr" must be a version such as "0.1", not a list', 'Write "kadr": "0.1".'],
  ['"0.0"', 'version-unknown', 'there is no format version "0.0"', 'This Kadr knows the format "0.1". Write "kadr": "0.1".'],
  ['"0.2"', 'version-newer', 'the deck is in the format "0.2", which is newer than this Kadr', 'This Kadr knows the format "0.1". Update Kadr to read this deck.'],
  ['"1.0"', 'version-newer', 'the deck is in the format "1.0", which is newer than this Kadr', 'This Kadr knows the format "0.1". Update Kadr to read this deck.'],
  ['"0.10"', 'version-newer', 'the deck is in the format "0.10", which is newer than this Kadr', 'This Kadr knows the format "0.1". Update Kadr to read this deck.'],
];

for (const [value, code, message, hint] of versions) {
  test(`version: ${value ?? 'no field'}: ${code}`, () => {
    // Everything else in the deck is wrong too, and none of it is reported.
    const text = `{\n  ${value === null ? '' : `"kadr": ${value},\n  `}"slides": "none",\n  "titel": 1\n}`;
    const result = check(text);
    assert.deepEqual(result.diagnostics, [{
      severity: 'error', code, message, hint,
      path: value === null ? '' : '/kadr', where: 'deck',
      line: value === null ? 1 : 2, column: value === null ? 1 : 11,
    }]);
    assert.equal(result.ok, false);
    assert.equal(result.version, undefined);
  });
}

test('text that is not JSON gives the syntax error and nothing else', () => {
  const result = check('{\n  "kadr": "0.1",\n  "slides": [{}],\n}');
  assert.deepEqual(result.diagnostics, [{
    severity: 'error', code: 'json-syntax', message: 'a trailing comma is not allowed in JSON',
    hint: 'Remove the comma after the last member.', path: '', where: 'file', line: 3, column: 17,
  }]);
  assert.equal(result.deck, undefined);
  assert.equal(result.ok, false);
});

test('a deck that is not an object', () => {
  for (const [text, kind] of [['[]', 'a list'], ['"deck"', 'a string'], ['42', 'a number'], ['null', 'null']]) {
    assert.deepEqual(check(text).diagnostics, [{
      severity: 'error', code: 'wrong-type', message: `a deck must be an object, not ${kind}`,
      hint: 'A deck looks like this: { "kadr": "0.1", "slides": [{}] }.', path: '', where: 'deck', line: 1, column: 1,
    }]);
  }
});

test('duplicate keys are reported, and the rest of the deck is still checked', () => {
  const text = '{\n  "kadr": "0.1",\n  "slides": [{ "id": "a", "id": "b", "layuot": "title" }]\n}';
  const line = text.split('\n')[2];
  assert.deepEqual(check(text).diagnostics.map((d) => [d.code, d.where, d.line, d.column, d.message]), [
    ['json-duplicate-key', 'slide 1 "b"', 3, line.lastIndexOf('"id"') + 1, 'the key "id" appears twice in one object'],
    ['unknown-field', 'slide 1 "b"', 3, line.indexOf('"layuot"') + 1, 'unknown field "layuot"'],
  ]);
});

test('diagnostics come in the order of the text', () => {
  const result = check(JSON.stringify({
    kadr: '0.1',
    slides: [{ elements: [{ type: 'text', x: 0, y: 0, w: 1, content: 'a', color: 'red', aling: 1 }] }, { layout: 'grid' }],
    theme: 'dark',
  }, null, 2));
  const lines = result.diagnostics.map((d) => d.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['bad-color', 'unknown-field', 'bad-value', 'bad-value']);
});

test('nothing from a deck reaches a message unescaped', () => {
  const bell = String.fromCharCode(7);
  const escape = `${String.fromCharCode(27)}[2J`;
  const reverse = String.fromCharCode(0x202e);
  const deck = {
    kadr: '0.1',
    theme: `dark${escape}`,
    [`ti${bell}tel`]: 1,
    slides: [{
      layout: `gr${reverse}id`,
      slots: { [`bo${escape}dy`]: 'x' },
      elements: [{ type: 'text', x: 0, y: 0, w: 1, content: 'a', color: `re${bell}d`, font: `Int${reverse}er` }],
    }],
  };
  const result = check(JSON.stringify(deck));
  assert.ok(result.diagnostics.length >= 5);
  for (const d of result.diagnostics) {
    assert.match(`${d.message} ${d.hint ?? ''} ${d.where}`, /^[\x20-\x7e]*$/, d.code);
  }
});

test('check never fails, whatever the text', () => {
  let seed = 11;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** @template T @param {T[]} items @returns {T} */
  const pick = (items) => items[Math.floor(rnd() * items.length)];
  const seeds = [
    ...filesIn(join(casesDir, 'valid'), '.kadr.json').map((p) => JSON.parse(readFileSync(p, 'utf8'))),
    ...filesIn(join(casesDir, 'invalid'), '.json').map((p) => JSON.parse(readFileSync(p, 'utf8')).deck),
  ];
  const values = [0, -1, 1.5, '', 'x', 'red', '#12345', 'line', 'text', 'title', 'Inter', true, null, [], {}, ['a'], { effect: 'spin' }, '0.1', '9.9', '../x', ' y'];
  const keys = ['kadr', 'type', 'x', 'w', 'h', 'content', 'src', 'alt', 'shape', 'color', 'enter', 'step', 'layout', 'slots', 'id', 'theme',
    'title', 'slides', 'elements', 'x-a', 'aling', 'radius', 'background', '__proto__', 'constructor'];
  /** @param {unknown} v @param {object[]} [out] */
  const nodes = (v, out = []) => {
    if (v && typeof v === 'object') {
      out.push(v);
      for (const child of Object.values(v)) nodes(child, out);
    }
    return out;
  };
  for (let i = 0; i < 4000; i++) {
    const deck = structuredClone(pick(seeds));
    for (let edits = 1 + Math.floor(rnd() * 4); edits > 0; edits--) {
      const all = nodes(deck);
      if (all.length === 0) break;
      const node = /** @type {Record<string, unknown>} */ (pick(all));
      const key = rnd() < 0.5 && Object.keys(node).length > 0 ? pick(Object.keys(node)) : pick(keys);
      if (rnd() < 0.3) delete node[key];
      else Object.defineProperty(node, key, { value: structuredClone(pick(values)), writable: true, enumerable: true, configurable: true });
    }
    let text = JSON.stringify(deck);
    if (rnd() < 0.1) text = text.slice(0, Math.floor(rnd() * text.length));
    const result = check(text);
    assert.equal(result.ok, !result.diagnostics.some((d) => d.severity === 'error'), text);
    for (const d of result.diagnostics) {
      assert.ok(d.code && d.message && d.where && d.line >= 1 && d.column >= 1, `${JSON.stringify(d)}\n${text}`);
    }
  }
});
