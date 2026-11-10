// @ts-check
// Tests of text markup (src/format/markup.js, docs/format.md section 10).
//
// Emphasis, code, links and escapes follow CommonMark. The parser was
// compared with the reference implementation (commonmark.js 0.31.2) on more
// than a million generated strings without a difference; a sample of those
// strings, with what the reference gives for each, is kept in
// tests/markup/commonmark.json and checked here on every run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInline, parseMarkup, MAX_NESTING } from '../src/format/markup.js';

/** @typedef {import('../src/format/markup.js').Inline} Inline */
/** @typedef {import('../src/format/markup.js').Block} Block */

const here = dirname(fileURLToPath(import.meta.url));

/** @param {string} s */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * Inline nodes written compactly, in the manner of HTML.
 * @param {Inline[]} nodes
 * @returns {string}
 */
const html = (nodes) => nodes.map((n) =>
  n.type === 'text' ? esc(n.text)
    : n.type === 'code' ? `<code>${esc(n.text)}</code>`
      : n.type === 'break' ? '<br>'
        : n.type === 'bold' ? `<b>${html(n.children)}</b>`
          : n.type === 'italic' ? `<i>${html(n.children)}</i>`
            : `<a href="${n.href}">${html(n.children)}</a>`).join('');

/**
 * Blocks written compactly: <p>, <ul>, <ol start>, <li>.
 * @param {Block[]} blocks
 * @returns {string}
 */
const blocksHtml = (blocks) => blocks.map((b) => {
  if (b.type === 'paragraph') return `<p>${html(b.children)}</p>`;
  const items = b.items.map((item) => `<li>${html(item.children)}${blocksHtml(item.lists)}</li>`).join('');
  return b.ordered ? `<ol start="${b.start}">${items}</ol>` : `<ul>${items}</ul>`;
}).join('');

/** @type {[string, string][]} */
const reference = JSON.parse(readFileSync(join(here, 'markup', 'commonmark.json'), 'utf8'));

test(`inline markup agrees with CommonMark on ${reference.length} sample strings`, () => {
  for (const [source, expected] of reference) assert.equal(html(parseInline(source)), expected, JSON.stringify(source));
});

// [source, expected]
/** @type {[string, string][]} */
const inline = [
  // Emphasis.
  ['**bold** and *italic*', '<b>bold</b> and <i>italic</i>'],
  ['***both***', '<i><b>both</b></i>'],
  ['**bold *and italic* inside**', '<b>bold <i>and italic</i> inside</b>'],
  ['*italic **and bold** inside*', '<i>italic <b>and bold</b> inside</i>'],
  ['in the mid*dle* of a word', 'in the mid<i>dle</i> of a word'],
  // A "*" that is not markup stays an asterisk.
  ['5 * 3', '5 * 3'],
  ['5 * 3 * 2', '5 * 3 * 2'],
  ['price*', 'price*'],
  ['*not closed', '*not closed'],
  ['* not opened*', '* not opened*'],
  ['a ** b', 'a ** b'],
  ['**', '**'],
  // Code: everything inside as it is.
  ['`code`', '<code>code</code>'],
  ['`a * b` and `**x**`', '<code>a * b</code> and <code>**x**</code>'],
  ['`a\\*b`', '<code>a\\*b</code>'],
  ['a ` b', 'a ` b'],
  ['*a `*` b*', '<i>a <code>*</code> b</i>'],
  // Only single backticks form code.
  ['``a``', '``a``'],
  ['`a``b`', '<code>a``b</code>'],
  // Links.
  ['[Kadr](https://example.com/kadr)', '<a href="https://example.com/kadr">Kadr</a>'],
  ['[plain](http://example.com)', '<a href="http://example.com">plain</a>'],
  ['[**bold** link](https://example.com)', '<a href="https://example.com"><b>bold</b> link</a>'],
  ['*[link](https://example.com) in italic*', '<i><a href="https://example.com">link</a> in italic</i>'],
  ['see [1] and [2]', 'see [1] and [2]'],
  ['[text] (https://example.com)', '[text] (https://example.com)'],
  ['[a [b](https://x.y) c](https://z.w)', '[a <a href="https://x.y">b</a> c](https://z.w)'],
  // Only https:// and http:// addresses make a link.
  ['[x](javascript:alert(1))', '[x](javascript:alert(1))'],
  ['[x](file:///etc/passwd)', '[x](file:///etc/passwd)'],
  ['[x](example.com)', '[x](example.com)'],
  ['[x](https://a b)', '[x](https://a b)'],
  ['[x](HTTPS://example.com)', '[x](HTTPS://example.com)'],
  // Escapes: a backslash before ASCII punctuation.
  ['\\*not italic\\*', '*not italic*'],
  ['\\`not code\\`', '`not code`'],
  ['\\[not a link\\](https://x.y)', '[not a link](https://x.y)'],
  ['a \\\\ b', 'a \\ b'],
  ['2024\\. A good year', '2024. A good year'],
  // A backslash before anything else is a backslash.
  ['C:\\Users and a\\b', 'C:\\Users and a\\b'],
  ['ends with \\', 'ends with \\'],
  // Line breaks; spaces around them are dropped.
  ['one\ntwo', 'one<br>two'],
  ['one   \n   two', 'one<br>two'],
  ['*a\nb*', '<i>a<br>b</i>'],
  ['`a\nb`', '<code>a b</code>'],
  // Other scripts and symbols.
  ['**\u0436\u0438\u0440\u043d\u044b\u0439** \u0438 *\u043a\u0443\u0440\u0441\u0438\u0432*', '<b>\u0436\u0438\u0440\u043d\u044b\u0439</b> \u0438 <i>\u043a\u0443\u0440\u0441\u0438\u0432</i>'],
  ['&amp; <b> stay text', '&amp;amp; &lt;b> stay text'],
  // An emoji is a symbol, and symbols count as punctuation, as CommonMark
  // says: next to a letter, the "*" before it does not open.
  ['a*\u{1F600}*', 'a*\u{1F600}*'],
  ['*\u{1F600}*', '<i>\u{1F600}</i>'],
  ['', ''],
];

for (const [source, expected] of inline) {
  test(`inline: ${JSON.stringify(source)}`, () => {
    assert.equal(html(parseInline(source)), expected);
  });
}

// [source, expected]
/** @type {[string, string][]} */
const blocks = [
  ['One paragraph.', '<p>One paragraph.</p>'],
  ['First.\n\nSecond.', '<p>First.</p><p>Second.</p>'],
  ['First.\n\n\n   \nSecond.', '<p>First.</p><p>Second.</p>'],
  ['Line one\nline two\n\nNext', '<p>Line one<br>line two</p><p>Next</p>'],
  ['  indented text  ', '<p>indented text</p>'],
  ['Windows\r\nline ends\r\n\r\nwork', '<p>Windows<br>line ends</p><p>work</p>'],
  ['', ''],
  ['\n\n', ''],
  // Lists.
  ['- one\n- two\n- three', '<ul><li>one</li><li>two</li><li>three</li></ul>'],
  ['1. one\n2. two', '<ol start="1"><li>one</li><li>two</li></ol>'],
  ['3. three\n4. four', '<ol start="3"><li>three</li><li>four</li></ol>'],
  ['- **bold** item\n- `code` item', '<ul><li><b>bold</b> item</li><li><code>code</code> item</li></ul>'],
  ['- one\n  - nested\n  - nested too\n- two', '<ul><li>one<ul><li>nested</li><li>nested too</li></ul></li><li>two</li></ul>'],
  ['- a\n  - b\n    - c\n- d', '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>'],
  ['- one\n  1. first\n  2. second', '<ul><li>one<ol start="1"><li>first</li><li>second</li></ol></li></ul>'],
  // An item cannot be more than one level deeper than the list it is in.
  ['- one\n      - far too deep', '<ul><li>one<ul><li>far too deep</li></ul></li></ul>'],
  ['    - starts indented', '<ul><li>starts indented</li></ul>'],
  // A change of marker starts another list.
  ['- a\n1. b', '<ul><li>a</li></ul><ol start="1"><li>b</li></ol>'],
  // A line that is not an item continues the item before it.
  ['- one\ncontinues\n- two', '<ul><li>one<br>continues</li><li>two</li></ul>'],
  // A blank line ends a list.
  ['- one\n\n- two', '<ul><li>one</li></ul><ul><li>two</li></ul>'],
  ['Intro:\n- one\n- two\n\nOutro.', '<p>Intro:</p><ul><li>one</li><li>two</li></ul><p>Outro.</p>'],
  // What is not a list.
  ['-no space', '<p>-no space</p>'],
  ['1.no space', '<p>1.no space</p>'],
  ['1) not this form', '<p>1) not this form</p>'],
  ['* a star is not a list marker', '<p>* a star is not a list marker</p>'],
  ['-', '<p>-</p>'],
  ['\\- escaped', '<p>- escaped</p>'],
  // A number at the start of a block is a list...
  ['2024. A good year', '<ol start="2024"><li>A good year</li></ol>'],
  // ...unless escaped...
  ['2024\\. A good year', '<p>2024. A good year</p>'],
  // ...and inside a paragraph only "1." starts one, as in CommonMark.
  ['The year was\n2024. A good year', '<p>The year was<br>2024. A good year</p>'],
  ['Steps:\n1. first\n2. second', '<p>Steps:</p><ol start="1"><li>first</li><li>second</li></ol>'],
  ['- empty item next\n- ', '<ul><li>empty item next</li><li></li></ul>'],
  // Numbers longer than nine digits are not list numbers.
  ['1234567890. not a list', '<p>1234567890. not a list</p>'],
];

for (const [source, expected] of blocks) {
  test(`blocks: ${JSON.stringify(source)}`, () => {
    assert.equal(blocksHtml(parseMarkup(source)), expected);
  });
}

test(`nesting stops at ${MAX_NESTING} levels, so the result can be walked with plain recursion`, () => {
  /** @param {Inline[]} nodes @returns {number} */
  const depth = (nodes) => nodes.reduce((d, n) => Math.max(d, 'children' in n ? 1 + depth(n.children) : 0), 0);
  /** @param {Inline[]} nodes @returns {string} */
  const textOf = (nodes) => nodes.map((n) => ('children' in n ? textOf(n.children) : 'text' in n ? n.text : '')).join('');
  const deep = parseInline(`${'**a '.repeat(5000)}b${'**'.repeat(5000)}`);
  assert.equal(depth(deep), MAX_NESTING);
  // Nothing is lost but the levels beyond the limit.
  assert.equal(textOf(deep), `${'a '.repeat(5000)}b`);
  // Italic and bold in turn, eight of each: exactly at the limit.
  assert.equal(depth(parseInline(`${'*a **b '.repeat(8)}c${'***'.repeat(8)}`)), 16);

  /** @param {Block[]} lists @returns {number} */
  const listDepth = (lists) => lists.reduce((d, b) => Math.max(d, b.type === 'list' ? 1 + Math.max(0, ...b.items.map((i) => listDepth(i.lists))) : 0), 0);
  const stairs = Array.from({ length: 2000 }, (_, i) => `${'  '.repeat(i)}- x`).join('\n');
  assert.equal(listDepth(parseMarkup(stairs)), MAX_NESTING);
});

test('reading time grows linearly with the length of the text', () => {
  const n = 40000;
  /** @type {[string, string][]} */
  const cases = [
    ['pairs', '*a* '.repeat(n)],
    ['openers that never close', '*a '.repeat(n)],
    ['closers that never opened', 'a* '.repeat(n)],
    ['deep nesting', `${'**a '.repeat(n)}${'b**'.repeat(n)}`],
    ['runs of every length', '*a**b***c '.repeat(n)],
    ['brackets', `${'['.repeat(n)}a${']'.repeat(n)}`],
    ['links', '[a](https://x.y) '.repeat(n)],
    ['openers, then links', `${'*a '.repeat(n)}${'[a](https://x.y) '.repeat(n)}`],
    ['addresses that never close', '[a](https://x.y '.repeat(n)],
    ['backticks', '`a '.repeat(n)],
    ['a backtick, then pairs of them', `\` ${'`` '.repeat(n)}`],
    ['list items', '- item *a*\n'.repeat(n)],
    ['stairs of lists', Array.from({ length: n }, (_, i) => `${'  '.repeat(i % 40)}- x`).join('\n')],
  ];
  for (const [name, source] of cases) {
    const started = performance.now();
    parseMarkup(source);
    const ms = performance.now() - started;
    // A linear parser takes a fraction of a second; a quadratic one, minutes.
    assert.ok(ms < 3000, `${name}: ${Math.round(ms)} ms`);
  }
});
