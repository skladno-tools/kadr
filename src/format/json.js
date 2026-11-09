// @ts-check
// A strict JSON reader that remembers where every value is.
//
// It returns the same value as JSON.parse, plus the line and column of every
// value (and of the key of every object member), so diagnostics can point at
// the exact place in the file. The one difference in what it accepts: a byte
// order mark at the start is skipped, where JSON.parse fails. It also refuses duplicate keys, which
// JSON.parse accepts silently, keeping the last one.
//
// Uses no Node and no DOM APIs: the CLI and the browser editor share it.

/**
 * @typedef {object} Position
 * @property {number} line    counted from 1
 * @property {number} column  counted from 1, in characters (code points)
 */

/**
 * @typedef {object} Place
 * @property {Position} value       where the value starts
 * @property {Position} [key]       where the key starts, for object members
 */

/**
 * @typedef {object} Diagnostic
 * @property {'error' | 'warning'} severity
 * @property {string} code
 * @property {string} message
 * @property {string} [hint]
 * @property {string} [path]  JSON Pointer of the value concerned
 * @property {number} line
 * @property {number} column
 */

/**
 * @typedef {object} ParseResult
 * @property {boolean} ok              false if there is any error
 * @property {unknown} value           the value; undefined after a syntax error
 * @property {Map<string, Place>} places  by JSON Pointer ("" is the whole document)
 * @property {Diagnostic[]} diagnostics
 */

/** Deeper nesting is refused, so a crafted file cannot exhaust the stack. */
export const MAX_DEPTH = 512;

const BOM = 0xfeff;

class SyntaxProblem extends Error {
  /** @param {number} offset @param {string} message @param {string} [hint] */
  constructor(offset, message, hint) {
    super(message);
    this.offset = offset;
    this.hint = hint;
  }
}

/** @param {string} segment */
const escapePointer = (segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

/**
 * Names the character at an offset for a message. Characters that cannot be
 * seen, or that look like something else, are named by their code.
 * @param {string} text @param {number} offset
 */
const describe = (text, offset) => {
  if (offset >= text.length) return 'the end of the file';
  const cp = /** @type {number} */ (text.codePointAt(offset));
  const code = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  if (cp >= 0xd800 && cp <= 0xdfff) return `an unpaired surrogate ${code}`;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return `the control character ${code}`;
  const ch = String.fromCodePoint(cp);
  if (/\p{Zs}/u.test(ch)) return `the space character ${code}, which JSON does not count as a space`;
  if (/[\p{Z}\p{Cf}]/u.test(ch)) return `the invisible character ${code}`;
  return `"${ch}"`;
};

/**
 * Parses a JSON text.
 * @param {string} text
 * @returns {ParseResult}
 */
export function parseJson(text) {
  const start = text.charCodeAt(0) === BOM ? 1 : 0;

  // Offsets where each line starts. \r\n is one line break; a lone \r is one too.
  const lineStarts = [start];
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) lineStarts.push(i + 1);
    else if (c === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) i++;
      lineStarts.push(i + 1);
    }
  }

  // Positions are asked for almost always in increasing order, so locate()
  // remembers the last one and counts on from it. Counting from the start of
  // the line every time would make reading a one-line file quadratic.
  let cursorLine = 0;
  let cursorOffset = start;
  let cursorColumn = 1;

  /** @param {number} offset @returns {Position} */
  const locate = (offset) => {
    const nextLineStart = lineStarts[cursorLine + 1] ?? Infinity;
    if (offset < cursorOffset || offset >= nextLineStart) {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      cursorLine = lo;
      cursorOffset = lineStarts[lo];
      cursorColumn = 1;
    }
    const lineStart = lineStarts[cursorLine];
    for (let i = cursorOffset; i < offset; i++) {
      const c = text.charCodeAt(i);
      // The second half of a surrogate pair is part of the same character.
      if (c >= 0xdc00 && c <= 0xdfff && i > lineStart) {
        const prev = text.charCodeAt(i - 1);
        if (prev >= 0xd800 && prev <= 0xdbff) continue;
      }
      cursorColumn++;
    }
    cursorOffset = offset;
    return { line: cursorLine + 1, column: cursorColumn };
  };

  /** @type {Map<string, Place>} */
  const places = new Map();
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  let pos = start;

  const peek = () => text[pos] ?? '';

  const skipSpace = () => {
    for (;;) {
      const c = text.charCodeAt(pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) pos++;
      else if (c === 0x2f && (text[pos + 1] === '/' || text[pos + 1] === '*')) {
        throw new SyntaxProblem(pos, 'comments are not allowed in JSON', 'Remove the comment, or keep notes in "notes" or an "x-" field.');
      } else return;
    }
  };

  /** @param {string} path @param {number} depth @returns {unknown} */
  const parseValue = (path, depth) => {
    skipSpace();
    const ch = peek();
    if (ch === '{') return parseObject(path, depth + 1);
    if (ch === '[') return parseArray(path, depth + 1);
    if (ch === '"') return parseString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
    if (ch === "'") throw new SyntaxProblem(pos, 'strings use double quotes in JSON', 'Replace the single quotes with double quotes.');
    if (ch === '+') throw new SyntaxProblem(pos, 'a number cannot start with "+"', 'Remove the "+".');
    if (ch === '.') throw new SyntaxProblem(pos, 'a number needs a digit before the point', 'Write 0.5 rather than .5.');
    const word = /[A-Za-z_$][\w$]*/y;
    word.lastIndex = pos;
    const m = word.exec(text);
    if (m) {
      const w = m[0];
      if (w === 'true') { pos += 4; return true; }
      if (w === 'false') { pos += 5; return false; }
      if (w === 'null') { pos += 4; return null; }
      if (w === 'NaN' || w === 'Infinity' || w === 'undefined') {
        throw new SyntaxProblem(pos, `${w} is not a JSON value`, 'Use a number, or null.');
      }
      throw new SyntaxProblem(pos, `unexpected word "${w}"`, 'Text values go in double quotes.');
    }
    if (ch === '') throw new SyntaxProblem(pos, 'the file ends where a value is expected');
    throw new SyntaxProblem(pos, `expected a value, found ${describe(text, pos)}`);
  };

  /** @param {string} path @param {number} depth */
  const parseObject = (path, depth) => {
    if (depth > MAX_DEPTH) throw new SyntaxProblem(pos, `the nesting is deeper than ${MAX_DEPTH} levels`);
    pos++; // {
    /** @type {Record<string, unknown>} */
    const obj = {};
    /** @type {Map<string, Position>} */
    const seen = new Map();
    skipSpace();
    if (peek() === '}') { pos++; return obj; }
    for (;;) {
      skipSpace();
      const keyAt = pos;
      const ch = peek();
      if (ch !== '"') {
        if (ch === "'") throw new SyntaxProblem(pos, 'keys use double quotes in JSON', 'Replace the single quotes with double quotes.');
        if (/[A-Za-z_$]/.test(ch)) throw new SyntaxProblem(pos, 'a key must be in double quotes', 'Put the key in double quotes.');
        if (ch === '') throw new SyntaxProblem(pos, 'the file ends inside an object', 'Close the object with "}".');
        throw new SyntaxProblem(pos, `expected a key in double quotes, found ${describe(text, pos)}`);
      }
      const keyPlace = locate(keyAt);
      const key = parseString();
      const memberPath = `${path}/${escapePointer(key)}`;
      const was = seen.get(key);
      if (was !== undefined) {
        const at = keyPlace;
        diagnostics.push({
          severity: 'error',
          code: 'json-duplicate-key',
          message: `the key "${key}" appears twice in one object`,
          hint: `It first appears on line ${was.line}. Keep one of them.`,
          path: memberPath,
          line: at.line,
          column: at.column,
        });
      } else seen.set(key, keyPlace);
      skipSpace();
      if (peek() !== ':') {
        if (peek() === '') throw new SyntaxProblem(pos, 'the file ends inside an object', 'Close the object with "}".');
        throw new SyntaxProblem(pos, `expected ":" after the key, found ${describe(text, pos)}`);
      }
      pos++; // :
      skipSpace();
      // Places are taken in reading order, before the value is read.
      places.set(memberPath, { key: keyPlace, value: locate(pos) });
      const value = parseValue(memberPath, depth);
      // defineProperty makes "__proto__" an ordinary member, as JSON.parse does.
      Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
      skipSpace();
      const next = peek();
      if (next === ',') {
        const commaAt = pos;
        pos++;
        skipSpace();
        if (peek() === '}') throw new SyntaxProblem(commaAt, 'a trailing comma is not allowed in JSON', 'Remove the comma after the last member.');
        continue;
      }
      if (next === '}') { pos++; return obj; }
      if (next === '"') throw new SyntaxProblem(pos, 'a comma is missing between members', 'Add a comma after the previous value.');
      if (next === '') throw new SyntaxProblem(pos, 'the file ends inside an object', 'Close the object with "}".');
      throw new SyntaxProblem(pos, `expected "," or "}", found ${describe(text, pos)}`);
    }
  };

  /** @param {string} path @param {number} depth */
  const parseArray = (path, depth) => {
    if (depth > MAX_DEPTH) throw new SyntaxProblem(pos, `the nesting is deeper than ${MAX_DEPTH} levels`);
    pos++; // [
    /** @type {unknown[]} */
    const arr = [];
    skipSpace();
    if (peek() === ']') { pos++; return arr; }
    for (;;) {
      const itemPath = `${path}/${arr.length}`;
      places.set(itemPath, { value: locate(pos) });
      arr.push(parseValue(itemPath, depth));
      skipSpace();
      const next = peek();
      if (next === ',') {
        const commaAt = pos;
        pos++;
        skipSpace();
        if (peek() === ']') throw new SyntaxProblem(commaAt, 'a trailing comma is not allowed in JSON', 'Remove the comma after the last item.');
        continue;
      }
      if (next === ']') { pos++; return arr; }
      if (next === '') throw new SyntaxProblem(pos, 'the file ends inside a list', 'Close the list with "]".');
      const startsValue = next === '"' || next === '{' || next === '[' || next === '-' || (next >= '0' && next <= '9')
        || text.startsWith('true', pos) || text.startsWith('false', pos) || text.startsWith('null', pos);
      if (startsValue) {
        throw new SyntaxProblem(pos, 'a comma is missing between items', 'Add a comma after the previous item.');
      }
      throw new SyntaxProblem(pos, `expected "," or "]", found ${describe(text, pos)}`);
    }
  };

  const parseString = () => {
    const openAt = pos;
    pos++; // "
    let out = '';
    let chunk = pos;
    for (;;) {
      const c = text.charCodeAt(pos);
      if (Number.isNaN(c)) throw new SyntaxProblem(openAt, 'the string is not closed', 'Add the closing double quote.');
      if (c === 0x22) { out += text.slice(chunk, pos); pos++; return out; }
      if (c === 0x0a || c === 0x0d) throw new SyntaxProblem(pos, 'a string cannot span lines', 'Write \\n for a line break inside a string.');
      if (c < 0x20) throw new SyntaxProblem(pos, `${describe(text, pos)} is not allowed inside a string`, 'Write it as an escape, such as \\t for a tab.');
      if (c !== 0x5c) { pos++; continue; }
      out += text.slice(chunk, pos);
      const e = text[pos + 1] ?? '';
      const simple = /** @type {Record<string, string>} */ ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' })[e];
      if (simple !== undefined) { out += simple; pos += 2; }
      else if (e === 'u') {
        const hex = text.slice(pos + 2, pos + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new SyntaxProblem(pos, '"\\u" needs four hexadecimal digits', 'Write it as \\u0041, for example.');
        out += String.fromCharCode(parseInt(hex, 16));
        pos += 6;
      } else if (e === '') throw new SyntaxProblem(openAt, 'the string is not closed', 'Add the closing double quote.');
      else throw new SyntaxProblem(pos, `"\\${e}" is not a JSON escape`, 'Escapes are \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX. Write a backslash as \\\\.');
      chunk = pos;
    }
  };

  const parseNumber = () => {
    const at = pos;
    const re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    re.lastIndex = pos;
    const m = re.exec(text);
    const after = text[at + (m ? m[0].length : 0)] ?? '';
    if (!m || m[0] === '-') {
      if (text[at + 1] === '.') throw new SyntaxProblem(at, 'a number needs a digit before the point', 'Write -0.5 rather than -.5.');
      throw new SyntaxProblem(at, 'a number is expected after "-"');
    }
    const end = at + m[0].length;
    if (/[0-9]/.test(after) && /^-?0$/.test(m[0])) throw new SyntaxProblem(at, 'a number cannot start with 0 followed by more digits', 'Remove the leading zeros.');
    if (after === '.' && !/[.eE]/.test(m[0])) throw new SyntaxProblem(end, 'a number needs a digit after the point', 'Write 1.0 or 1 rather than 1.');
    if ((after === 'e' || after === 'E') && !/[eE]/.test(m[0])) throw new SyntaxProblem(end, 'the exponent needs digits', 'Write 1e3, for example.');
    pos = end;
    return Number(m[0]);
  };

  /** @type {unknown} */
  let value;
  try {
    skipSpace();
    if (pos >= text.length) throw new SyntaxProblem(pos, 'the file is empty', 'A deck is a JSON object: { "kadr": "0.1", "slides": [{}] }.');
    places.set('', { value: locate(pos) });
    value = parseValue('', 0);
    skipSpace();
    if (pos < text.length) throw new SyntaxProblem(pos, 'unexpected text after the end of the JSON value', 'A file holds one JSON value. Remove what follows it.');
  } catch (e) {
    if (!(e instanceof SyntaxProblem)) throw e;
    const at = locate(e.offset);
    diagnostics.push({
      severity: 'error',
      code: 'json-syntax',
      message: e.message,
      ...(e.hint ? { hint: e.hint } : {}),
      line: at.line,
      column: at.column,
    });
    return { ok: false, value: undefined, places, diagnostics };
  }
  // After a duplicate key, the places of the first occurrence's members are
  // stale: keep only places of values that are in the result.
  if (diagnostics.some((d) => d.code === 'json-duplicate-key')) {
    /** @type {Set<string>} */
    const live = new Set();
    /** @param {unknown} v @param {string} path */
    const walk = (v, path) => {
      live.add(path);
      if (v && typeof v === 'object') {
        for (const [k, child] of Object.entries(v)) walk(child, `${path}/${Array.isArray(v) ? k : escapePointer(k)}`);
      }
    };
    walk(value, '');
    for (const path of [...places.keys()]) if (!live.has(path)) places.delete(path);
  }
  return { ok: diagnostics.length === 0, value, places, diagnostics };
}
