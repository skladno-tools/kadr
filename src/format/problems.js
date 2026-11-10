// @ts-check
// Turns the validator's raw errors into problems: one per real mistake, each
// with the place that is wrong and the kind of mistake.
//
// A validator reports in terms of its keywords, and reports some things more
// than once: a failed "if" next to the errors inside it, every branch of a
// failed choice. A problem is what a person would call one mistake.

/**
 * @typedef {import('ajv').ErrorObject} RawError
 */

/**
 * @typedef {object} Problem
 * @property {string} at         JSON Pointer of the wrong place: the field itself
 *                               when it is unknown or missing
 * @property {string} kind       missing, unknown, dependent, type, value, pattern,
 *                               range, size, choice, or a wrapper keyword
 * @property {RawError} error    the validator's error; for a choice, the anyOf error
 * @property {RawError[]} branches  for a choice, the errors of its branches
 */

// What kind of mistake each validator keyword reports. The kinds are close to
// the diagnostic codes in docs/cli.md: a missing "alt" and an unknown "alt"
// are different mistakes at the same place.
/** @type {Record<string, string>} */
const kinds = {
  required: 'missing',
  additionalProperties: 'unknown',
  unevaluatedProperties: 'unknown',
  'false schema': 'unknown',
  dependentRequired: 'dependent',
  type: 'type',
  enum: 'value',
  const: 'value',
  pattern: 'pattern',
  minimum: 'range',
  maximum: 'range',
  exclusiveMinimum: 'range',
  exclusiveMaximum: 'range',
  minItems: 'size',
  maxItems: 'size',
  minLength: 'size',
  maxLength: 'size',
};

/** @param {RawError} e */
const place = (e) => {
  const p = /** @type {Record<string, unknown>} */ (e.params);
  const field = e.keyword === 'dependentRequired'
    ? p.property
    : p.unevaluatedProperty ?? p.additionalProperty ?? p.missingProperty;
  return field === undefined ? e.instancePath : `${e.instancePath}/${escapePointer(String(field))}`;
};

/** @param {string} segment */
const escapePointer = (segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

/** @param {Problem} a @param {Problem} b */
const byPlace = (a, b) => (a.at === b.at ? a.kind.localeCompare(b.kind) : a.at < b.at ? -1 : 1);

/**
 * The problems behind a list of validator errors, sorted by place. Every
 * error counts: the same mistake reported twice is two problems, so a schema
 * that reports one thing twice shows.
 *
 * - An unknown or missing field points at the field itself; a field that
 *   needs another one (slots without a layout) points at the field that is
 *   there.
 * - When every branch of an anyOf fails at the anyOf's own place (a color that
 *   is neither a theme name nor hex), the branch errors are one problem of
 *   kind "choice". Branch errors are recognised by the schema that reported
 *   them, so an unrelated error at the same place is still reported.
 * - "if" and "allOf" errors are dropped: the validator reports them only
 *   together with the errors inside them. Other wrappers ("not", "oneOf")
 *   are reported under their own keyword; the format's schemas use neither.
 *
 * @param {RawError[]} errors  from validate() in schema.js
 * @param {any} schema         the schema they come from
 * @returns {Problem[]}
 */
export function problems(errors, schema) {
  /** The schemas an anyOf chooses between, with references resolved. */
  const resolve = (/** @type {unknown[]} */ branches) => new Set(branches.map((b) => {
    const ref = /** @type {{ $ref?: string }} */ (b).$ref;
    if (ref === undefined) return b;
    const name = /^#\/\$defs\/([^/]+)$/.exec(ref)?.[1];
    if (name === undefined) throw new Error(`unexpected reference ${ref}`);
    return schema.$defs[name];
  }));

  /** @type {Problem[]} */
  const found = [];
  /** @type {Set<RawError>} */
  const absorbed = new Set();
  for (const e of errors.filter((w) => w.keyword === 'anyOf')) {
    const options = resolve(/** @type {unknown[]} */ (e.schema));
    const branches = errors.filter((b) => b.instancePath === e.instancePath && options.has(b.parentSchema));
    const elsewhere = errors.some((b) => b.instancePath.startsWith(`${e.instancePath}/`) && !absorbed.has(b));
    if (branches.length > 0 && !elsewhere) {
      branches.forEach((b) => absorbed.add(b));
      found.push({ at: e.instancePath, kind: 'choice', error: e, branches });
    }
  }
  for (const e of errors) {
    if (absorbed.has(e) || e.keyword === 'anyOf' || e.keyword === 'if' || e.keyword === 'allOf') continue;
    let kind = kinds[e.keyword];
    if (e.keyword === 'not' || e.keyword === 'oneOf') kind = e.keyword;
    if (kind === undefined) throw new Error(`no kind for the validator keyword "${e.keyword}"`);
    found.push({ at: place(e), kind, error: e, branches: [] });
  }
  return found.sort(byPlace);
}
