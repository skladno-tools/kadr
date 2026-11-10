// @ts-check
// "Did you mean ...?": the closest known name to a mistyped one.

/** Names longer than this get no suggestion; nobody mistypes a name that long. */
const MAX_LENGTH = 40;

/**
 * How many single edits turn one string into the other: an insertion, a
 * deletion, a replacement, or two neighbouring characters swapped.
 * @param {string} a @param {string} b
 */
export function distance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  /** @type {number[][]} */
  const d = Array.from({ length: rows }, (_, i) => [i, ...new Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * The candidate a mistyped name most likely stands for, or undefined when
 * nothing is close enough or two candidates are equally close. Case does not
 * count: "Align" is "align". The longer the name, the more edits are allowed:
 * one for 3 or 4 characters, two for 5 to 8, three beyond.
 * @param {string} name
 * @param {Iterable<string>} candidates
 * @returns {string | undefined}
 */
export function closest(name, candidates) {
  if (name.length === 0 || name.length > MAX_LENGTH) return undefined;
  const lower = name.toLowerCase();
  const allowed = name.length <= 2 ? 0 : name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  let best;
  let bestDistance = Infinity;
  let tie = false;
  for (const candidate of candidates) {
    if (candidate === name) continue;
    const d = distance(lower, candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
      tie = false;
    } else if (d === bestDistance) tie = true;
  }
  return bestDistance <= allowed && !tie ? best : undefined;
}
