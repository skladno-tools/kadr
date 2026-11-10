// @ts-check
// Tests of the small helpers that word diagnostics: showing values safely
// (src/format/show.js), suggesting names (src/format/suggest.js) and
// describing places (src/format/where.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plain, show, kindOf, list, MAX_SHOWN } from '../src/format/show.js';
import { distance, closest } from '../src/format/suggest.js';
import { describe } from '../src/format/where.js';

test('show: values as written in JSON', () => {
  assert.equal(show('red'), '"red"');
  assert.equal(show('say "hi"'), '"say \\"hi\\""');
  assert.equal(show(1.5), '1.5');
  assert.equal(show(true), 'true');
  assert.equal(show(null), 'null');
  assert.equal(show([1]), 'a list');
  assert.equal(show({}), 'an object');
  assert.equal(kindOf('1'), 'a string');
  assert.equal(kindOf(1), 'a number');
  assert.equal(kindOf(null), 'null');
  assert.equal(kindOf([]), 'a list');
  assert.equal(kindOf({}), 'an object');
});

test('show: nothing from a deck can steer the terminal or hide in a message', () => {
  // An escape sequence that would clear the screen, a bell, a line break.
  assert.equal(plain('a\u001b[2Jb\u0007c\nd'), 'a\\u001b[2Jb\\u0007c\\u000ad');
  // Characters that reverse the direction of text or cannot be seen.
  assert.equal(plain('photo\u202egnp.exe'), 'photo\\u202egnp.exe');
  assert.equal(plain('a\u200bb\ufeffc\u0085d\u00ade'), 'a\\u200bb\\ufeffc\\u0085d\\u00ade');
  // Half of a surrogate pair.
  assert.equal(plain('a\ud83db'), 'a\\ud83db');
  // Ordinary text of any script is left alone.
  assert.equal(plain('Заголовок: r\u00e9sum\u00e9 \u{1F600}'), 'Заголовок: r\u00e9sum\u00e9 \u{1F600}');
});

test('show: long values are cut, by characters, without reading all of them', () => {
  assert.equal(plain('a'.repeat(MAX_SHOWN)), 'a'.repeat(MAX_SHOWN));
  assert.equal(plain('a'.repeat(MAX_SHOWN + 1)), `${'a'.repeat(MAX_SHOWN)}...`);
  assert.equal(plain('\u{1F600}'.repeat(MAX_SHOWN + 1)), `${'\u{1F600}'.repeat(MAX_SHOWN)}...`);
  const started = performance.now();
  assert.equal(plain('x'.repeat(50_000_000)).length, MAX_SHOWN + 3);
  assert.ok(performance.now() - started < 1000);
});

test('list: in words', () => {
  assert.equal(list([]), '');
  assert.equal(list(['a']), 'a');
  assert.equal(list(['a', 'b']), 'a or b');
  assert.equal(list(['a', 'b', 'c']), 'a, b or c');
  assert.equal(list(['a', 'b', 'c'], 'and'), 'a, b and c');
});

test('distance: single edits, a swap of neighbours counts as one', () => {
  assert.equal(distance('align', 'align'), 0);
  assert.equal(distance('aling', 'align'), 1);
  assert.equal(distance('algn', 'align'), 1);
  assert.equal(distance('alignn', 'align'), 1);
  assert.equal(distance('alibn', 'align'), 1);
  assert.equal(distance('', 'abc'), 3);
  assert.equal(distance('kitten', 'sitting'), 3);
});

test('closest: the likely name, or nothing', () => {
  const fields = ['align', 'valign', 'color', 'content', 'font', 'size', 'weight', 'lineHeight', 'reveal'];
  assert.equal(closest('aling', fields), 'align');
  assert.equal(closest('colour', fields), 'color');
  assert.equal(closest('Content', fields), 'content');
  assert.equal(closest('lineheight', fields), 'lineHeight');
  assert.equal(closest('wieght', fields), 'weight');
  // Too far from anything.
  assert.equal(closest('fill', fields), undefined);
  assert.equal(closest('zzz', fields), undefined);
  // Two names equally close: no guess.
  assert.equal(closest('xlign', ['align', 'ylign']), undefined);
  // Very short names are never guessed; one edit would match too much.
  assert.equal(closest('w', ['x', 'y', 'h']), undefined);
  assert.equal(closest('', fields), undefined);
  // An absurdly long name is not compared at all.
  assert.equal(closest('a'.repeat(1_000_000), fields), undefined);
});

test('describe: places in the words a person would use', () => {
  const deck = {
    kadr: '0.1',
    theme: { fonts: { heading: 'Comic Sans MS' } },
    background: { type: 'gradient', colors: ['accent', 'red'] },
    slides: [
      { layout: 'title', slots: { title: 'A', 'bo/dy': 'B' } },
      { id: 'pricing', background: { type: 'image' }, elements: [{ type: 'text' }, { id: 'logo', type: 'image', enter: { durration: 1 } }] },
      { id: 'Not An Id', elements: [{ id: 'x y' }] },
    ],
  };
  /** @type {[string, string, string, string][]} */
  const cases = [
    ['', 'deck', '', ''],
    ['/titel', 'deck', 'titel', ''],
    ['/theme/fonts/heading', 'theme', 'fonts.heading', '/theme'],
    ['/background/colors/1', 'background', 'colors[1]', '/background'],
    ['/canvas/width', 'canvas', 'width', '/canvas'],
    ['/slides', 'deck', 'slides', ''],
    ['/slides/0', 'slide 1', '', '/slides/0'],
    ['/slides/0/layout', 'slide 1', 'layout', '/slides/0'],
    ['/slides/0/slots', 'slide 1', 'slots', '/slides/0'],
    ['/slides/0/slots/title/color', 'slide 1, slot "title"', 'color', '/slides/0/slots/title'],
    ['/slides/0/slots/bo~1dy', 'slide 1, slot "bo/dy"', '', '/slides/0/slots/bo~1dy'],
    ['/slides/1', 'slide 2 "pricing"', '', '/slides/1'],
    ['/slides/1/background/src', 'slide 2 "pricing", background', 'src', '/slides/1/background'],
    ['/slides/1/elements/0/aling', 'slide 2 "pricing", element 1', 'aling', '/slides/1/elements/0'],
    ['/slides/1/elements/1/enter/durration', 'slide 2 "pricing", element "logo"', 'enter.durration', '/slides/1/elements/1'],
    // An id that is not a valid id is not shown.
    ['/slides/2/elements/0/id', 'slide 3, element 1', 'id', '/slides/2/elements/0'],
    // A slide that is not there is still a slide by its number.
    ['/slides/7/elements/2/x', 'slide 8, element 3', 'x', '/slides/7/elements/2'],
  ];
  for (const [pointer, where, field, anchor] of cases) {
    assert.deepEqual(describe(deck, pointer), { where, field, anchor }, pointer);
  }
  // A deck that is not what it should be never makes describe fail.
  assert.deepEqual(describe({ slides: 'none' }, '/slides/0/x'), { where: 'deck', field: 'slides.0.x', anchor: '' });
  assert.deepEqual(describe(null, '/slides/0'), { where: 'deck', field: 'slides.0', anchor: '' });
  // A slot name from the deck is made safe to show.
  assert.equal(describe({ slides: [{ slots: {} }] }, '/slides/0/slots/a\u001bb').where, 'slide 1, slot "a\\u001bb"');
});
