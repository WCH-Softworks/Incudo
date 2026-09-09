/**
 * A small JSON Schema validator.
 *
 * This exists because of one sentence in ADR 0011: *"if it parses, the app should be able
 * to build in it."* That promise is only worth something if "parses" has a definition, and
 * the definition is `schemas/system.schema.json`. So the validator has to be **one
 * implementation** that the CLI and the app both run — a second one in the app would mean
 * a system that passes `incudo system validate` and then fails to load, which is exactly
 * the experience the ADR is trying to prevent.
 *
 * That is also why it lives in `core` and takes no dependency: `core` may import the
 * standard library and nothing else (docs/CODE-REUSE-POLICY.md), and a validator is a pure
 * function over data. The schemas themselves are read by whoever has a filesystem or a
 * bundler and handed in.
 *
 * The supported subset is Draft 2020-12 minus everything a hand-written schema for a config
 * file does not need: no remote `$ref`, no `if`/`then`/`else`, no `unevaluatedProperties`,
 * no format assertions. `$ref` resolves against `#/$defs/...` in the same document only.
 * An unknown keyword is ignored rather than treated as an error, which is what the spec
 * says and also what keeps a schema readable.
 *
 * Error messages are aimed at someone who is not a programmer and is editing JSON by hand.
 * "characterKinds[1].progression: must be one of level, rating, xp, none" beats a stack of
 * failed subschema reports every time.
 */

export interface SchemaError {
  /** JSON Pointer to the offending value, rendered for humans: `characterKinds[1].id`. */
  path: string;
  message: string;
}

export type JsonSchema = boolean | { [keyword: string]: unknown };

export interface ValidateOptions {
  /** Stop after this many errors. A malformed file should not print 4,000 lines. */
  maxErrors?: number;
}

export function validateJson(
  value: unknown,
  schema: JsonSchema,
  options: ValidateOptions = {},
): SchemaError[] {
  const maxErrors = options.maxErrors ?? 100;
  return validateAgainst(value, schema, schema, maxErrors);
}

/**
 * The same walk, but keeping the document root a `$ref` resolves against. Subschema
 * attempts inside `anyOf`/`oneOf` go through here rather than back through
 * {@link validateJson}, which would re-root and break every `#/$defs/...` reference.
 */
function validateAgainst(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  maxErrors: number,
): SchemaError[] {
  const errors: SchemaError[] = [];
  check(value, schema, [], { root, errors, maxErrors });
  return errors.slice(0, maxErrors);
}

/** True when `value` satisfies `schema`. Cheaper than collecting every error. */
export function matchesJsonSchema(value: unknown, schema: JsonSchema): boolean {
  return validateJson(value, schema, { maxErrors: 1 }).length === 0;
}

function matchesWithRoot(value: unknown, schema: JsonSchema, root: JsonSchema): boolean {
  return validateAgainst(value, schema, root, 1).length === 0;
}

interface Ctx {
  root: JsonSchema;
  errors: SchemaError[];
  maxErrors: number;
}

function fail(ctx: Ctx, path: string[], message: string): void {
  if (ctx.errors.length >= ctx.maxErrors) return;
  ctx.errors.push({ path: renderPath(path), message });
}

function check(value: unknown, schema: JsonSchema, path: string[], ctx: Ctx): void {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    fail(ctx, path, 'is not allowed here');
    return;
  }
  if (ctx.errors.length >= ctx.maxErrors) return;

  const s = resolveRef(schema, ctx);

  if (s['const'] !== undefined && !deepEqual(value, s['const'])) {
    fail(ctx, path, `must be ${JSON.stringify(s['const'])}`);
    return;
  }

  if (Array.isArray(s['enum'])) {
    const allowed = s['enum'] as unknown[];
    if (!allowed.some((a) => deepEqual(a, value))) {
      fail(ctx, path, `must be one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}`);
      return;
    }
  }

  if (s['type'] !== undefined && !matchesType(value, s['type'])) {
    fail(ctx, path, `must be ${describeType(s['type'])}, not ${typeName(value)}`);
    return;
  }

  if (typeof value === 'string') checkString(value, s, path, ctx);
  if (typeof value === 'number') checkNumber(value, s, path, ctx);
  if (Array.isArray(value)) checkArray(value, s, path, ctx);
  else if (isPlainObject(value)) checkObject(value, s, path, ctx);

  checkCombinators(value, s, path, ctx);
}

function checkString(value: string, s: Record<string, unknown>, path: string[], ctx: Ctx): void {
  const min = s['minLength'];
  const max = s['maxLength'];
  if (typeof min === 'number' && value.length < min) {
    fail(ctx, path, min === 1 ? 'must not be empty' : `must be at least ${min} characters`);
  }
  if (typeof max === 'number' && value.length > max) {
    fail(ctx, path, `must be at most ${max} characters`);
  }
  const pattern = s['pattern'];
  if (typeof pattern === 'string' && !safeTest(pattern, value)) {
    const hint = s['patternDescription'];
    fail(ctx, path, typeof hint === 'string' ? hint : `must match the pattern ${pattern}`);
  }
}

function checkNumber(value: number, s: Record<string, unknown>, path: string[], ctx: Ctx): void {
  const min = s['minimum'];
  const max = s['maximum'];
  const exMin = s['exclusiveMinimum'];
  const exMax = s['exclusiveMaximum'];
  if (typeof min === 'number' && value < min) fail(ctx, path, `must be at least ${min}`);
  if (typeof max === 'number' && value > max) fail(ctx, path, `must be at most ${max}`);
  if (typeof exMin === 'number' && value <= exMin) fail(ctx, path, `must be greater than ${exMin}`);
  if (typeof exMax === 'number' && value >= exMax) fail(ctx, path, `must be less than ${exMax}`);
  const multiple = s['multipleOf'];
  if (typeof multiple === 'number' && multiple > 0 && value % multiple !== 0) {
    fail(ctx, path, `must be a multiple of ${multiple}`);
  }
}

function checkArray(value: unknown[], s: Record<string, unknown>, path: string[], ctx: Ctx): void {
  const min = s['minItems'];
  const max = s['maxItems'];
  if (typeof min === 'number' && value.length < min) {
    fail(ctx, path, min === 1 ? 'must not be empty' : `must have at least ${min} entries`);
  }
  if (typeof max === 'number' && value.length > max) {
    fail(ctx, path, `must have at most ${max} entries`);
  }
  if (s['uniqueItems'] === true) {
    const seen: string[] = [];
    for (const item of value) {
      const key = JSON.stringify(item);
      if (seen.includes(key)) {
        fail(ctx, path, `has a duplicate entry: ${key}`);
        break;
      }
      seen.push(key);
    }
  }
  const items = s['items'];
  if (items !== undefined) {
    for (let i = 0; i < value.length; i++) {
      check(value[i], items as JsonSchema, [...path, `[${i}]`], ctx);
    }
  }
}

function checkObject(
  value: Record<string, unknown>,
  s: Record<string, unknown>,
  path: string[],
  ctx: Ctx,
): void {
  const properties = isPlainObject(s['properties'])
    ? (s['properties'] as Record<string, JsonSchema>)
    : {};

  for (const name of asStringArray(s['required'])) {
    if (!(name in value) || value[name] === undefined) {
      fail(ctx, [...path, name], 'is required');
    }
  }

  const patternProperties = isPlainObject(s['patternProperties'])
    ? (s['patternProperties'] as Record<string, JsonSchema>)
    : {};

  for (const [name, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const childPath = [...path, name];
    let matched = false;

    if (name in properties) {
      check(child, properties[name]!, childPath, ctx);
      matched = true;
    }
    for (const [pattern, sub] of Object.entries(patternProperties)) {
      if (safeTest(pattern, name)) {
        check(child, sub, childPath, ctx);
        matched = true;
      }
    }

    if (matched) continue;
    const additional = s['additionalProperties'];
    if (additional === false) {
      // The most common authoring mistake is a typo in a key, so say so.
      const suggestion = nearest(name, Object.keys(properties));
      fail(
        ctx,
        childPath,
        suggestion ? `is not a known field — did you mean "${suggestion}"?` : 'is not a known field',
      );
    } else if (additional !== undefined && additional !== true) {
      check(child, additional as JsonSchema, childPath, ctx);
    }
  }
}

function checkCombinators(
  value: unknown,
  s: Record<string, unknown>,
  path: string[],
  ctx: Ctx,
): void {
  for (const branch of asSchemaArray(s['allOf'])) check(value, branch, path, ctx);

  const alternatives = asSchemaArray(s['anyOf']).concat(asSchemaArray(s['oneOf']));
  if (alternatives.length) {
    const attempts = alternatives.map((branch) => ({
      branch,
      errors: validateAgainst(value, branch, ctx.root, ctx.maxErrors),
    }));
    if (!attempts.some((a) => a.errors.length === 0)) {
      reportBestAlternative(value, s, attempts, path, ctx);
    }
  }

  const not = s['not'];
  if (not !== undefined && matchesWithRoot(value, not as JsonSchema, ctx.root)) {
    fail(ctx, path, 'is not allowed here');
  }
}

/**
 * A union that fails is where a naive validator produces its worst message — every branch's
 * complaints at once, most of them irrelevant. Two ways out, in order of usefulness:
 *
 * 1. If the schema names a `discriminator` and the value carries it, the user has already
 *    said which branch they meant. Report only that branch's errors.
 * 2. Otherwise report the branch that got closest, which for hand-written schemas is
 *    almost always the intended one.
 */
function reportBestAlternative(
  value: unknown,
  s: Record<string, unknown>,
  attempts: Array<{ branch: JsonSchema; errors: SchemaError[] }>,
  path: string[],
  ctx: Ctx,
): void {
  const discriminator = typeof s['discriminator'] === 'string' ? s['discriminator'] : undefined;

  if (discriminator && isPlainObject(value)) {
    const tag = value[discriminator];
    const chosen = attempts.find((a) => branchTag(a.branch, discriminator) === tag);
    if (chosen) {
      for (const error of chosen.errors) fail(ctx, [...path, error.path], error.message);
      return;
    }
    const tags = attempts
      .map((a) => branchTag(a.branch, discriminator))
      .filter((t): t is string => typeof t === 'string');
    if (tags.length) {
      fail(ctx, [...path, discriminator], `must be one of ${tags.join(', ')}`);
      return;
    }
  }

  const best = attempts.reduce((a, b) => (b.errors.length < a.errors.length ? b : a));
  if (best.errors.length === 0) return;
  for (const error of best.errors) fail(ctx, [...path, error.path], error.message);
}

function branchTag(branch: JsonSchema, discriminator: string): unknown {
  if (typeof branch !== 'object' || branch === null) return undefined;
  const properties = (branch as Record<string, unknown>)['properties'];
  if (!isPlainObject(properties)) return undefined;
  const tagSchema = properties[discriminator];
  if (!isPlainObject(tagSchema)) return undefined;
  return tagSchema['const'];
}

// --- helpers ---------------------------------------------------------------

function resolveRef(schema: Record<string, unknown>, ctx: Ctx): Record<string, unknown> {
  const ref = schema['$ref'];
  if (typeof ref !== 'string') return schema;

  const target = pointer(ctx.root, ref);
  if (!isPlainObject(target)) {
    // A broken $ref is a bug in the schema, not in the document being validated. Failing
    // open would silently pass everything, so this is loud.
    throw new Error(`Schema $ref "${ref}" does not resolve.`);
  }
  // Sibling keywords beside a $ref are legal in 2020-12 and occasionally handy.
  const { $ref: _ignored, ...siblings } = schema;
  return Object.keys(siblings).length ? { ...target, ...siblings } : target;
}

function pointer(root: JsonSchema, ref: string): unknown {
  if (!ref.startsWith('#')) return undefined;
  let current: unknown = root;
  for (const raw of ref.slice(1).split('/')) {
    if (raw === '') continue;
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isPlainObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

function matchesType(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some((t) => matchesType(value, t));
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function describeType(type: unknown): string {
  if (Array.isArray(type)) return type.map((t) => article(String(t))).join(' or ');
  return article(String(type));
}

function article(type: string): string {
  return /^[aeiou]/i.test(type) ? `an ${type}` : `a ${type}`;
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return 'a string';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'a boolean';
  return 'nothing';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asSchemaArray(value: unknown): JsonSchema[] {
  return Array.isArray(value) ? (value as JsonSchema[]) : [];
}

/**
 * Schemas here are written by this project, but a user overlay could in principle carry
 * one. A pattern that does not compile is reported as a non-match rather than thrown,
 * so one bad regex cannot take the whole validator down.
 */
function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(value);
  } catch {
    return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/** The closest known key within one or two edits, for "did you mean" on a typo'd field. */
function nearest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

function renderPath(path: string[]): string {
  let out = '';
  for (const segment of path) {
    if (segment === '') continue;
    if (segment.startsWith('[')) out += segment;
    else if (out === '') out = segment;
    else out += `.${segment}`;
  }
  return out;
}
