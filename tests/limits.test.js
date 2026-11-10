// @ts-check
// docs/format.md section 16 lists every range, pattern and default the schema
// sets, for people and for AI tools that learn the format from prose. These
// tests hold the section to the schema, both ways:
//
//   - every row and pattern in the section says what the schema says;
//   - every place in the schema that sets a limit has a row or a pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'schema', '0.1', 'kadr.schema.json'), 'utf8'));
const format = readFileSync(join(root, 'docs', 'format.md'), 'utf8');

const start = format.indexOf('## 16. Limits and defaults');
const section = format.slice(start, format.indexOf('\n## ', start + 1));

/**
 * Every keyword of JSON Schema that sets a range, a length, a form or a
 * default. The schema uses only some of them; the rest are here so that one
 * added later cannot go unnoticed. "type" counts only for numbers.
 */
const limitKeys = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
  'default',
];

/** @param {string} pointer @returns {any} */
const at = (pointer) => {
  let node = schema;
  for (const raw of pointer.split('/').slice(1)) {
    node = node?.[raw.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  assert.notEqual(node, undefined, `the schema has nothing at ${pointer}`);
  return node;
};

/**
 * The limits a schema node sets, following one reference: what the node says
 * itself wins over what it refers to.
 * @param {string} pointer
 */
const limitsAt = (pointer) => {
  const node = at(pointer);
  const target = typeof node.$ref === 'string' ? at(node.$ref.slice(1)) : {};
  const merged = { ...target, ...node };
  /** @type {Record<string, unknown>} */
  const out = {};
  if (merged.type === 'integer' || merged.type === 'number') out.type = merged.type;
  for (const key of limitKeys) if (key in merged) out[key] = merged[key];
  return out;
};

// Branches are found by what they select, not by their position in the list.
/** @param {string} type */
const background = (type) => {
  const i = schema.$defs.background.else.allOf.findIndex((/** @type {any} */ b) => b.if.properties.type.const === type);
  return `/$defs/background/else/allOf/${i}/then/properties`;
};
const rectRadius = (() => {
  const i = schema.$defs.shapeElement.allOf.findIndex((/** @type {any} */ b) => b.if.properties.shape?.const === 'rect');
  return `/$defs/shapeElement/allOf/${i}/then/properties/radius`;
})();

// Where the schema sets what each row of the table describes.
/** @type {Record<string, string[]>} */
const rows = {
  '`slides`': ['/properties/slides'],
  '`canvas.width`': ['/$defs/canvas/properties/width'],
  '`canvas.height`': ['/$defs/canvas/properties/height'],
  '`theme`': ['/$defs/theme'],
  '`x`, `y`': ['/$defs/px'],
  '`w`, `h`': ['/$defs/size'],
  '`rotate`': ['/$defs/rotate'],
  '`opacity`': ['/$defs/opacity'],
  '`step`': ['/$defs/step'],
  '`duration`, `delay` (transitions and entrances, in ms)': ['/$defs/ms'],
  '`hidden`': ['/$defs/slide/properties/hidden'],
  '`alt`': ['/$defs/imageElement/properties/alt', '/$defs/imageSlot/properties/alt'],
  '`fit`': ['/$defs/imageElement/properties/fit', '/$defs/imageSlot/properties/fit'],
  '`focus.x`, `focus.y`': ['/$defs/unit'],
  '`dim` (image background)': [`${background('image')}/dim`],
  '`blur` (image background)': [`${background('image')}/blur`],
  '`radius`': ['/$defs/imageElement/properties/radius', '/$defs/imageSlot/properties/radius', rectRadius],
  '`size` (text)': ['/$defs/textElement/properties/size/anyOf/0', '/$defs/textOverride/properties/size/anyOf/0'],
  '`size` (code)': ['/$defs/codeElement/properties/size'],
  '`lineHeight`': ['/$defs/textElement/properties/lineHeight', '/$defs/textOverride/properties/lineHeight'],
  '`reveal`': ['/$defs/textElement/properties/reveal', '/$defs/textOverride/properties/reveal'],
  '`strokeWidth`': ['/$defs/shapeElement/properties/strokeWidth'],
  '`colors` (gradient background)': [`${background('gradient')}/colors`],
  '`angle` (gradient background)': [`${background('gradient')}/angle`],
  '`kind` (gradient background)': [`${background('gradient')}/kind`],
  '`colors` (live background)': [`${background('live')}/colors`],
  '`speed` (live background)': [`${background('live')}/speed`],
};

// Where the schema sets each pattern in the list under the table.
/** @type {Record<string, string[]>} */
const patterns = {
  '`id`': ['/$defs/id'],
  'hex color': ['/$defs/hex'],
  '`meta.lang`': ['/$defs/meta/properties/lang'],
  '`lang` (code)': ['/$defs/codeElement/properties/lang'],
  '`src`': ['/$defs/src'],
};

const number = '(-?\\d+(?:\\.\\d+)?)';

/**
 * What the "Allowed" and "Default" cells of a row say, as schema limits.
 * @param {string} allowed @param {string} fallback
 */
const read = (allowed, fallback) => {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (/whole number/.test(allowed)) out.type = 'integer';
  else if (/\bnumber\b/.test(allowed)) out.type = 'number';
  let m;
  if ((m = new RegExp(`${number} to ${number} colors`).exec(allowed))) {
    out.minItems = Number(m[1]);
    out.maxItems = Number(m[2]);
  } else if ((m = new RegExp(`${number} to ${number}`).exec(allowed))) {
    out.minimum = Number(m[1]);
    out.maximum = Number(m[2]);
  }
  if ((m = new RegExp(`above ${number}`).exec(allowed))) out.exclusiveMinimum = Number(m[1]);
  if ((m = /at least (\d+) slide/.exec(allowed))) out.minItems = Number(m[1]);
  else if ((m = /at least (\d+) character/.exec(allowed))) out.minLength = Number(m[1]);
  else if ((m = new RegExp(`at least ${number}`).exec(allowed))) out.minimum = Number(m[1]);
  if (fallback !== '-') {
    const code = /^`(.+)`$/.exec(fallback);
    assert.ok(code, `a default is written in backticks: ${fallback}`);
    out.default = JSON.parse(code[1]);
  }
  return out;
};

const table = section.split('\n')
  .filter((line) => line.startsWith('| ') && !line.startsWith('| Field') && !line.startsWith('|---'))
  .map((line) => line.slice(2, -2).split(' | '));

test('the table has the rows the test knows, and no others', () => {
  assert.deepEqual(table.map(([field]) => field).sort(), Object.keys(rows).sort());
  assert.ok(table.every((cells) => cells.length === 3));
});

for (const [field, allowed, fallback] of table) {
  test(`limits: ${field.replace(/`/g, '')}: ${allowed.replace(/`/g, '')}`, () => {
    const said = read(allowed, fallback);
    for (const pointer of rows[field] ?? []) assert.deepEqual(limitsAt(pointer), said, pointer);
  });
}

const listed = [...section.matchAll(/^- (.+?): `(.+)`$/gm)].map((m) => [m[1], m[2]]);

test('the list of patterns has the entries the test knows, and no others', () => {
  assert.deepEqual(listed.map(([name]) => name).sort(), Object.keys(patterns).sort());
});

for (const [name, pattern] of listed) {
  test(`pattern: ${name.replace(/`/g, '')}`, () => {
    for (const pointer of patterns[name] ?? []) assert.deepEqual(limitsAt(pointer), { pattern }, pointer);
  });
}

test('every limit in the schema is in the section', () => {
  const covered = new Set([...Object.values(rows), ...Object.values(patterns)].flat());
  /** @type {string[]} */
  const missing = [];
  /** @param {unknown} node @param {string} pointer */
  const walk = (node, pointer) => {
    if (Array.isArray(node)) node.forEach((child, i) => walk(child, `${pointer}/${i}`));
    else if (node && typeof node === 'object') {
      // "properties" and "$defs" map names to schemas: a name such as
      // "default" or "pattern" there would be a field, not a limit.
      const names = /\/(?:properties|\$defs)$/.test(pointer);
      if (!names && limitKeys.some((key) => key in node) && !covered.has(pointer)) missing.push(pointer);
      for (const [key, child] of Object.entries(node)) {
        walk(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
      }
    }
  };
  walk(schema, '');
  assert.deepEqual(missing, []);
});
