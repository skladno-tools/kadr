// @ts-check
// Reads the copyright notice (name ID 0) out of a WOFF2 font file.
//
// The font build uses it to check, and where needed repair, the notice in the
// license it ships next to each family: the notice in the font file itself is
// the authoritative one for that file.
//
// Format: https://www.w3.org/TR/WOFF2/. Only what is needed to reach the
// "name" table is read; the name table is never transformed in WOFF2.

import { brotliDecompressSync } from 'node:zlib';

// Tags of the known tables, by the index WOFF2 uses for them.
const knownTags = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ',
  'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc',
  'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/**
 * The strings of one name ID, Windows English first, then any Windows, then Mac.
 * @param {Buffer} font  a WOFF2 file
 * @param {number} nameId
 * @returns {string | undefined}
 */
export function nameOf(font, nameId) {
  if (font.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  if (font.toString('latin1', 4, 8) === 'ttcf') throw new Error('font collections are not supported');
  const numTables = font.readUInt16BE(12);
  const compressedLength = font.readUInt32BE(20);
  let pos = 48;

  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = font[pos++];
      if (i === 0 && byte === 0x80) throw new Error('bad UIntBase128');
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error('bad UIntBase128');
  };

  /** @type {{ tag: string, length: number }[]} */
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = font[pos++];
    const index = flags & 0x3f;
    let tag;
    if (index === 0x3f) { tag = font.toString('latin1', pos, pos + 4); pos += 4; } else tag = knownTags[index];
    const version = flags >> 6;
    const origLength = base128();
    // glyf and loca are transformed unless the version is 3; any other table
    // is transformed when the version is not 0. A transformed table stores
    // its transformed length.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const length = transformed ? base128() : origLength;
    tables.push({ tag, length });
  }

  const data = brotliDecompressSync(font.subarray(pos, pos + compressedLength));
  let offset = 0;
  for (const { tag, length } of tables) {
    if (tag === 'name') return readName(data.subarray(offset, offset + length), nameId);
    offset += length;
  }
  return undefined;
}

/** @param {Buffer} name @param {number} nameId */
function readName(name, nameId) {
  const count = name.readUInt16BE(2);
  const storage = name.readUInt16BE(4);
  /** @type {{ rank: number, text: string }[]} */
  const found = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = name.readUInt16BE(r);
    const language = name.readUInt16BE(r + 4);
    if (name.readUInt16BE(r + 6) !== nameId) continue;
    const length = name.readUInt16BE(r + 8);
    const start = storage + name.readUInt16BE(r + 10);
    const bytes = name.subarray(start, start + length);
    if (platform === 3 || platform === 0) {
      // UTF-16BE
      const swapped = Buffer.from(bytes);
      swapped.swap16();
      found.push({ rank: platform === 3 && language === 0x409 ? 0 : 1, text: swapped.toString('utf16le') });
    } else if (platform === 1) {
      found.push({ rank: 2, text: bytes.toString('latin1') });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  return found[0]?.text;
}
