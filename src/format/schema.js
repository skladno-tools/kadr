// @ts-check
// The schemas of the format, by version, and validation against them.
//
// Validation collects every error (it does not stop at the first) and keeps,
// for each one, the part of the schema that reported it and the value it
// objected to; problems.js needs both.

import { Ajv2020 } from 'ajv/dist/2020.js';
import schema01 from '../../schema/0.1/kadr.schema.json' with { type: 'json' };

/** Every format version there has been, oldest first. */
export const versions = ['0.1'];

/** The newest format version this code knows. */
export const newest = '0.1';

/** @type {Record<string, any>} */
const schemas = { '0.1': schema01 };

/** @type {Map<string, import('ajv').ValidateFunction>} */
const compiled = new Map();

/**
 * The JSON Schema of a format version.
 * @param {string} version
 * @returns {any}
 */
export function schemaOf(version) {
  const schema = schemas[version];
  if (schema === undefined) throw new Error(`no schema for the format version ${version}`);
  return schema;
}

/**
 * Validates a value against the schema of a format version.
 * @param {string} version
 * @param {unknown} value
 * @returns {import('ajv').ErrorObject[]}  empty when the value is valid
 */
export function validate(version, value) {
  let check = compiled.get(version);
  if (check === undefined) {
    check = new Ajv2020({ allErrors: true, strict: true, verbose: true }).compile(schemaOf(version));
    compiled.set(version, check);
  }
  return check(value) ? [] : [...(check.errors ?? [])];
}
