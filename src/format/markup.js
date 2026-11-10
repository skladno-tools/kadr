// @ts-check
// Text markup: the small subset of Markdown of docs/format.md section 10.
//
// parseMarkup turns the content of a text element into blocks (paragraphs and
// lists) of inline nodes (text, bold, italic, code, links, line breaks). The
// player draws them; the checks look at them.
//
// Emphasis follows the delimiter algorithm of the CommonMark specification
// (https://spec.commonmark.org/, "Emphasis and strong emphasis"), restricted
// to "*". The tests compare it with the reference implementation.
//
// Uses no Node and no DOM APIs.

/**
 * @typedef {{ type: 'text', text: string }
 *   | { type: 'code', text: string }
 *   | { type: 'break' }
 *   | { type: 'bold', children: Inline[] }
 *   | { type: 'italic', children: Inline[] }
 *   | { type: 'link', href: string, children: Inline[] }} Inline
 */

/**
 * @typedef {object} Item
 * @property {Inline[]} children  the text of the item
 * @property {List[]} lists       lists nested under it
 */

/**
 * @typedef {object} List
 * @property {'list'} type
 * @property {boolean} ordered    numbered ("1. ") or not ("- ")
 * @property {number} start       the number of the first item of a numbered list
 * @property {Item[]} items
 */

/**
 * @typedef {{ type: 'paragraph', children: Inline[] } | List} Block
 */

const punctuation = /[\p{P}\p{S}]/u;
const space = /\s/u;
const asciiPunctuation = /[!-/:-@[-`{-~]/;
const address = /^https?:\/\/[^\s()<>]+$/;

// While a text is being read, its nodes are kept in doubly linked lists, so
// wrapping a stretch of them in bold, italic or a link takes time
// proportional to that stretch, and reading stays linear in the length of the
// text. Arrays are built once, at the end.

/**
 * @typedef {object} Node
 * @property {'text' | 'code' | 'break' | 'bold' | 'italic' | 'link'} type
 * @property {string} text          for text and code; the address of a link
 * @property {Node | null} first    the children of bold, italic and link
 * @property {Node | null} last
 * @property {Node | null} prev
 * @property {Node | null} next
 * @property {Node | null} parent
 */

/**
 * A run of "*" that may open or close emphasis.
 * @typedef {object} Delimiter
 * @property {Node} node        its text node
 * @property {number} count     how many "*" are left in it
 * @property {number} length    how many it started with
 * @property {boolean} canOpen
 * @property {boolean} canClose
 * @property {Delimiter | null} prev
 * @property {Delimiter | null} next
 */

/** @param {Node['type']} type @param {string} [text] @returns {Node} */
const node = (type, text = '') => ({ type, text, first: null, last: null, prev: null, next: null, parent: null });

/** @param {Node} parent @param {Node} child */
const append = (parent, child) => {
  child.parent = parent;
  child.prev = parent.last;
  child.next = null;
  if (parent.last) parent.last.next = child;
  else parent.first = child;
  parent.last = child;
};

/** @param {Node} n */
const unlink = (n) => {
  const parent = /** @type {Node} */ (n.parent);
  if (n.prev) n.prev.next = n.next;
  else parent.first = n.next;
  if (n.next) n.next.prev = n.prev;
  else parent.last = n.prev;
  n.prev = n.next = n.parent = null;
};

/** @param {Node} after @param {Node} n  puts n right after "after" */
const insertAfter = (after, n) => {
  const parent = /** @type {Node} */ (after.parent);
  n.parent = parent;
  n.prev = after;
  n.next = after.next;
  if (after.next) after.next.prev = n;
  else parent.last = n;
  after.next = n;
};

/**
 * Moves every node after "from" in its list into "into".
 * @param {Node} from @param {Node} into @param {Node | null} [until]  stop before this node
 */
const moveAfter = (from, into, until = null) => {
  let n = from.next;
  while (n && n !== until) {
    const next = n.next;
    unlink(n);
    append(into, n);
    n = next;
  }
};

/**
 * Bold, italic and links nested deeper than this are shown without further
 * nesting: their text is kept, the extra level is not. Nobody writes such
 * text by hand, and code that draws or checks markup can then walk it with
 * plain recursion, whatever a deck contains.
 */
export const MAX_NESTING = 16;

/**
 * The children of a node as the arrays the rest of the code uses:
 * neighbouring text joined, empty text dropped. Walks without recursion.
 * @param {Node} root
 * @returns {Inline[]}
 */
function toInline(root) {
  /** @type {Inline[]} */
  const top = [];
  /** The lists being filled, outermost first. @type {Inline[][]} */
  const lists = [top];
  /** @type {Node | null} */
  let n = root.first;
  while (n !== null) {
    const out = lists[lists.length - 1];
    const last = out[out.length - 1];
    /** @type {Node | null} */
    let down = null;
    if (n.type === 'text') {
      if (n.text !== '') {
        if (last?.type === 'text') last.text += n.text;
        else out.push({ type: 'text', text: n.text });
      }
    } else if (n.type === 'code') out.push({ type: 'code', text: n.text });
    else if (n.type === 'break') out.push({ type: 'break' });
    else {
      /** @type {Inline[]} */
      const children = [];
      // Beyond the limit, the children go straight into the list around them.
      if (lists.length <= MAX_NESTING) {
        out.push(n.type === 'link' ? { type: 'link', href: n.text, children } : { type: n.type, children });
        lists.push(children);
      } else lists.push(out);
      down = n.first;
      if (down === null) lists.pop();
    }
    if (down !== null) { n = down; continue; }
    // Next: a sibling, or the sibling of the nearest parent that has one.
    while (n !== null && n.next === null && n.parent !== root && n.parent !== null) {
      n = n.parent;
      lists.pop();
    }
    n = n === null ? null : n.next;
  }
  return top;
}

const linkAddress = /\((https?:\/\/[^\s()<>]+)\)/y;

/**
 * Parses inline markup.
 * @param {string} source  the text of one paragraph or list item
 * @returns {Inline[]}
 */
export function parseInline(source) {
  const root = node('text');
  /** The stack of delimiter runs; "top" is the latest. @type {Delimiter | null} */
  let top = null;
  /**
   * Open "[": its node, and the top of the delimiter stack when it was read.
   * @type {{ node: Node, delimiters: Delimiter | null, active: boolean }[]}
   */
  const brackets = [];
  let pos = 0;

  /** @param {Delimiter} d */
  const remove = (d) => {
    if (d.prev) d.prev.next = d.next;
    if (d.next) d.next.prev = d.prev;
    else top = d.prev;
  };

  /**
   * Settles emphasis among the delimiters above "bottom": the algorithm
   * "process emphasis" of the CommonMark specification. Matched pairs become
   * bold or italic nodes; all delimiters above "bottom" are removed.
   * @param {Delimiter | null} bottom
   */
  const emphasis = (bottom) => {
    // For closers that found no opener: where the search stopped, by the
    // closer's length modulo 3 and whether it can also open.
    /** @type {(Delimiter | null)[]} */
    const searched = new Array(6).fill(bottom);

    if (top === bottom) return;
    // The first delimiter above the bottom.
    let closer = top;
    while (closer !== null && closer.prev !== bottom) closer = closer.prev;

    while (closer !== null) {
      if (!closer.canClose) { closer = closer.next; continue; }
      const key = (closer.canOpen ? 3 : 0) + (closer.length % 3);
      let opener = closer.prev;
      let found = false;
      while (opener !== null && opener !== bottom && opener !== searched[key]) {
        // The "rule of three": a run that can both open and close does not
        // pair with one whose lengths add up to a multiple of three, unless
        // both lengths are multiples of three.
        const odd = (closer.canOpen || opener.canClose) && closer.length % 3 !== 0 && (opener.length + closer.length) % 3 === 0;
        if (opener.canOpen && !odd) { found = true; break; }
        opener = opener.prev;
      }
      if (!found || opener === null) {
        const old = closer;
        closer = closer.next;
        searched[key] = old.prev;
        if (!old.canOpen) remove(old);
        continue;
      }
      const use = closer.count >= 2 && opener.count >= 2 ? 2 : 1;
      opener.count -= use;
      closer.count -= use;
      opener.node.text = '*'.repeat(opener.count);
      closer.node.text = '*'.repeat(closer.count);

      // Wrap the nodes between the two runs.
      const wrapped = node(use === 2 ? 'bold' : 'italic');
      moveAfter(opener.node, wrapped, closer.node);
      insertAfter(opener.node, wrapped);

      // Delimiters between the two are inside the wrapped stretch now.
      for (let between = closer.prev; between !== null && between !== opener;) {
        const before = between.prev;
        remove(between);
        between = before;
      }
      if (opener.count === 0) {
        unlink(opener.node);
        remove(opener);
      }
      if (closer.count === 0) {
        unlink(closer.node);
        const next = closer.next;
        remove(closer);
        closer = next;
      }
    }
    // Whatever is left above the bottom stays as ordinary text.
    while (top !== null && top !== bottom) remove(top);
  };

  while (pos < source.length) {
    const ch = source[pos];

    if (ch === '\\' && pos + 1 < source.length && asciiPunctuation.test(source[pos + 1])) {
      append(root, node('text', source[pos + 1]));
      pos += 2;
    } else if (ch === '`') {
      let run = 1;
      while (source[pos + run] === '`') run++;
      // Only single backticks form code; a longer run is ordinary characters.
      let end = -1;
      if (run === 1) {
        for (let i = pos + 1; i < source.length; i++) {
          if (source[i] !== '`') continue;
          let other = 1;
          while (source[i + other] === '`') other++;
          if (other === 1) { end = i; break; }
          i += other - 1;
        }
      }
      if (end === -1) {
        append(root, node('text', '`'.repeat(run)));
        pos += run;
      } else {
        append(root, node('code', source.slice(pos + 1, end).replace(/ *\n */g, ' ')));
        pos = end + 1;
      }
    } else if (ch === '*') {
      let run = 1;
      while (source[pos + run] === '*') run++;
      const before = pos === 0 ? '\n' : String.fromCodePoint(codePointBefore(source, pos));
      const after = pos + run >= source.length ? '\n' : String.fromCodePoint(/** @type {number} */ (source.codePointAt(pos + run)));
      const beforeSpace = space.test(before);
      const afterSpace = space.test(after);
      const beforePunct = punctuation.test(before);
      const afterPunct = punctuation.test(after);
      const leftFlanking = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
      const rightFlanking = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
      const n = node('text', '*'.repeat(run));
      append(root, n);
      /** @type {Delimiter} */
      const d = { node: n, count: run, length: run, canOpen: leftFlanking, canClose: rightFlanking, prev: top, next: null };
      if (top) top.next = d;
      top = d;
      pos += run;
    } else if (ch === '[') {
      const n = node('text', '[');
      append(root, n);
      brackets.push({ node: n, delimiters: top, active: true });
      pos++;
    } else if (ch === ']') {
      const opener = brackets.pop();
      linkAddress.lastIndex = pos + 1;
      const m = opener !== undefined && opener.active ? linkAddress.exec(source) : null;
      if (opener === undefined || m === null) {
        append(root, node('text', ']'));
        pos++;
      } else {
        // The nodes after the "[" become the link's text; emphasis inside it
        // is settled first, among the delimiters that came after the "[".
        emphasis(opener.delimiters);
        const link = node('link', m[1]);
        moveAfter(opener.node, link);
        insertAfter(opener.node, link);
        unlink(opener.node);
        // No link inside a link: a "[" before this one cannot open another.
        for (const b of brackets) b.active = false;
        pos += 1 + m[0].length;
      }
    } else if (ch === '\n') {
      const last = root.last;
      if (last?.type === 'text') last.text = last.text.replace(/ +$/, '');
      append(root, node('break'));
      pos++;
      while (source[pos] === ' ') pos++;
    } else {
      let end = pos + 1;
      while (end < source.length && !'\\`*[]\n'.includes(source[end])) end++;
      append(root, node('text', source.slice(pos, end)));
      pos = end;
    }
  }
  emphasis(null);
  return toInline(root);
}

/** @param {string} s @param {number} pos  @returns {number} */
function codePointBefore(s, pos) {
  const low = s.charCodeAt(pos - 1);
  if (low >= 0xdc00 && low <= 0xdfff && pos >= 2) {
    const high = s.charCodeAt(pos - 2);
    if (high >= 0xd800 && high <= 0xdbff) return /** @type {number} */ (s.codePointAt(pos - 2));
  }
  return low;
}

const itemLine = /^( *)(?:- |(\d{1,9})\. )(.*)$/;

/**
 * Parses the content of a text element.
 * @param {string} source
 * @returns {Block[]}
 */
export function parseMarkup(source) {
  /** @type {Block[]} */
  const blocks = [];
  /** Lines of the paragraph being read. @type {string[]} */
  let paragraph = [];
  /**
   * The lists being read, outermost first, with the indentation of each and
   * the lines of its last item.
   * @type {{ list: List, level: number, lines: string[] }[]}
   */
  let open = [];

  const closeItem = (/** @type {{ list: List, lines: string[] }} */ entry) => {
    const item = entry.list.items[entry.list.items.length - 1];
    if (item && entry.lines.length > 0) item.children = parseInline(entry.lines.join('\n'));
    entry.lines = [];
  };
  const closeLists = (/** @type {number} */ keep) => {
    while (open.length > keep) closeItem(/** @type {{ list: List, level: number, lines: string[] }} */ (open.pop()));
  };
  const closeParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      closeParagraph();
      closeLists(0);
      continue;
    }
    const m = itemLine.exec(line);
    // As in CommonMark, a numbered item interrupts a paragraph only when its
    // number is 1: "2024. A good year" on the second line of a paragraph is
    // text. Any item may start a block.
    const item = m !== null && !(paragraph.length > 0 && m[2] !== undefined && Number(m[2]) !== 1);
    if (!item) {
      if (open.length > 0) open[open.length - 1].lines.push(line.trim());
      else paragraph.push(line.trim());
      continue;
    }
    closeParagraph();
    const ordered = m[2] !== undefined;
    // Two spaces per level; an item cannot be more than one level deeper
    // than the list it is in, and lists do not nest beyond the limit.
    const level = Math.min(Math.floor(m[1].length / 2), open.length, MAX_NESTING - 1);
    closeLists(level + 1);
    let entry = open[level];
    if (entry !== undefined) closeItem(entry);
    if (entry === undefined || entry.list.ordered !== ordered) {
      /** @type {List} */
      const list = { type: 'list', ordered, start: ordered ? Number(m[2]) : 1, items: [] };
      if (entry !== undefined) open.pop();
      const parent = open[open.length - 1];
      if (parent === undefined) blocks.push(list);
      else parent.list.items[parent.list.items.length - 1].lists.push(list);
      entry = { list, level, lines: [] };
      open.push(entry);
    }
    entry.list.items.push({ children: [], lists: [] });
    entry.lines = [m[3]];
  }
  closeParagraph();
  closeLists(0);
  return blocks;
}
