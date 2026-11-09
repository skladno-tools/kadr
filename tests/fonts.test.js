// @ts-check
// Integrity of the bundled font library (fonts/), as tools/fonts/build.mjs
// writes it. These tests catch a hand edit or a partial build: a family the
// schema allows but the library lacks, a license without a copyright notice,
// a stylesheet pointing at a missing file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameOf } from '../tools/fonts/woff2.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = join(root, 'fonts');

/** @type {{ fonts: { id: string, family: string, license: string, copyright: string }[] }} */
const catalog = JSON.parse(readFileSync(join(fonts, 'catalog.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(root, 'schema', '0.1', 'kadr.schema.json'), 'utf8'));
const css = readFileSync(join(fonts, 'fonts.css'), 'utf8');
const hasNotice = (/** @type {string} */ text) => /copyright|\u00a9/i.test(text);

test('the schema allows exactly the families in the catalog, in the same order', () => {
  assert.deepEqual(schema.$defs.fontFamily.enum, catalog.fonts.map((f) => f.family));
});

test('the catalog and the folders list the same families', () => {
  const folders = readdirSync(fonts).filter((name) => statSync(join(fonts, name)).isDirectory()).sort();
  assert.deepEqual(folders, catalog.fonts.map((f) => f.id).sort());
});

for (const font of catalog.fonts) {
  test(`${font.family}: OFL 1.1 license with a copyright notice`, () => {
    assert.equal(font.license, 'OFL-1.1');
    assert.ok(hasNotice(font.copyright), `catalog: ${font.copyright}`);
    const license = readFileSync(join(fonts, font.id, 'LICENSE'), 'utf8');
    const body = license.indexOf('This Font Software is licensed under the SIL Open Font License, Version 1.1.');
    assert.ok(body >= 0, 'not the usual OFL text');
    assert.ok(hasNotice(license.slice(0, body)), `no copyright notice before the license text: ${license.slice(0, body).trim()}`);
  });
}

test('every file the stylesheet names exists, and every font file is named', () => {
  const named = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map((m) => m[1]).sort();
  const files = catalog.fonts
    .flatMap((f) => readdirSync(join(fonts, f.id)).filter((n) => n.endsWith('.woff2')).map((n) => `${f.id}/${n}`))
    .sort();
  assert.deepEqual(named, files);
});

test('every font file carries a copyright notice of its own', () => {
  for (const font of catalog.fonts) {
    for (const name of readdirSync(join(fonts, font.id)).filter((n) => n.endsWith('.woff2'))) {
      const notice = nameOf(readFileSync(join(fonts, font.id, name)), 0);
      assert.ok(notice && hasNotice(notice), `${font.id}/${name}: ${notice}`);
    }
  }
});
