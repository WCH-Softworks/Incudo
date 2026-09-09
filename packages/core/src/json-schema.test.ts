import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchesJsonSchema, validateJson, type JsonSchema } from './json-schema.ts';

function messages(value: unknown, schema: JsonSchema): string[] {
  return validateJson(value, schema).map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
}

test('types are reported in words, not in schema jargon', () => {
  assert.deepEqual(messages(3, { type: 'string' }), ['must be a string, not a number']);
  assert.deepEqual(messages(null, { type: 'object' }), ['must be an object, not null']);
  assert.deepEqual(messages([], { type: 'object' }), ['must be an object, not an array']);
  assert.deepEqual(messages('x', { type: ['number', 'integer'] }), [
    'must be a number or an integer, not a string',
  ]);
  assert.deepEqual(messages(1.5, { type: 'integer' }), ['must be an integer, not a number']);
});

test('required, and where the error is anchored', () => {
  const schema = { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string' } } };
  assert.deepEqual(messages({}, schema), ['id: is required', 'name: is required']);
  assert.deepEqual(messages({ id: 1, name: 'x' }, schema), ['id: must be a string, not a number']);
});

test('an unknown field suggests the field it was probably meant to be', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: { characterKinds: {}, elementTypes: {} },
  };
  assert.deepEqual(messages({ characterKind: [] }, schema), [
    'characterKind: is not a known field — did you mean "characterKinds"?',
  ]);
  assert.deepEqual(messages({ wildlyDifferent: [] }, schema), [
    'wildlyDifferent: is not a known field',
  ]);
});

test('array items report their index', () => {
  const schema = { type: 'array', items: { type: 'object', required: ['id'] } };
  assert.deepEqual(messages([{ id: 'a' }, {}], schema), ['[1].id: is required']);
});

test('nested paths read like the file looks', () => {
  const schema = {
    type: 'object',
    properties: {
      kinds: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
    },
  };
  assert.deepEqual(messages({ kinds: [{ id: 'ok' }, { id: 7 }] }, schema), [
    'kinds[1].id: must be a string, not a number',
  ]);
});

test('a discriminated union reports the branch the author meant', () => {
  const schema = {
    type: 'object',
    required: ['kind'],
    discriminator: 'kind',
    oneOf: [
      {
        type: 'object',
        required: ['kind', 'min', 'max'],
        properties: { kind: { const: 'level' }, min: { type: 'integer' }, max: { type: 'integer' } },
      },
      {
        type: 'object',
        required: ['kind', 'stat'],
        properties: { kind: { const: 'rating' }, stat: { type: 'string' } },
      },
      { type: 'object', required: ['kind'], properties: { kind: { const: 'none' } } },
    ],
  };

  assert.deepEqual(messages({ kind: 'level', min: 1 }, schema), ['max: is required']);
  // Not every branch's complaints at once — only the one the "kind" field named.
  assert.deepEqual(messages({ kind: 'rating' }, schema), ['stat: is required']);
  assert.deepEqual(messages({ kind: 'nope' }, schema), ['kind: must be one of level, rating, none']);
  assert.deepEqual(messages({ kind: 'none' }, schema), []);
});

test('$ref resolves inside a union branch, not just at the top level', () => {
  // The bug this guards: validating a oneOf branch by re-entering at the branch would
  // re-root the document, and every "#/$defs/…" inside it would stop resolving.
  const schema = {
    $defs: { name: { type: 'string', minLength: 1 } },
    type: 'object',
    oneOf: [
      { type: 'object', required: ['a'], properties: { a: { $ref: '#/$defs/name' } } },
      { type: 'object', required: ['b'], properties: { b: { $ref: '#/$defs/name' } } },
    ],
  };
  assert.deepEqual(messages({ b: 'fine' }, schema), []);
  assert.equal(messages({ b: '' }, schema).length, 1);
});

test('recursive $ref terminates', () => {
  const schema: JsonSchema = {
    $defs: {
      expr: {
        type: 'object',
        required: ['kind'],
        properties: { kind: { type: 'string' }, child: { $ref: '#/$defs/expr' } },
      },
    },
    $ref: '#/$defs/expr',
  };
  assert.deepEqual(messages({ kind: 'a', child: { kind: 'b', child: { kind: 'c' } } }, schema), []);
  assert.deepEqual(messages({ kind: 'a', child: { child: {} } }, schema), [
    'child.kind: is required',
    'child.child.kind: is required',
  ]);
});

test('a broken $ref is loud, because failing open would pass everything', () => {
  assert.throws(() => validateJson({}, { $ref: '#/$defs/nope' }), /does not resolve/);
});

test('string and number constraints', () => {
  assert.deepEqual(messages('', { type: 'string', minLength: 1 }), ['must not be empty']);
  assert.deepEqual(messages('ab', { type: 'string', minLength: 4 }), [
    'must be at least 4 characters',
  ]);
  assert.deepEqual(messages('Bad Id', { type: 'string', pattern: '^[a-z-]+$' }), [
    'must match the pattern ^[a-z-]+$',
  ]);
  assert.deepEqual(
    messages('Bad Id', {
      type: 'string',
      pattern: '^[a-z-]+$',
      patternDescription: 'must be lowercase letters and hyphens',
    }),
    ['must be lowercase letters and hyphens'],
  );
  assert.deepEqual(messages(0, { type: 'number', minimum: 1 }), ['must be at least 1']);
  assert.deepEqual(messages(21, { type: 'number', maximum: 20 }), ['must be at most 20']);
});

test('enum and const', () => {
  assert.deepEqual(messages('x', { enum: ['stream', 'download'] }), [
    'must be one of "stream", "download"',
  ]);
  assert.deepEqual(messages(2, { const: 1 }), ['must be 1']);
  assert.deepEqual(messages(1, { const: 1 }), []);
});

test('additionalProperties as a schema checks the values', () => {
  const schema = { type: 'object', additionalProperties: { type: 'number' } };
  assert.deepEqual(messages({ 'hp:level:2': 7 }, schema), []);
  assert.deepEqual(messages({ 'hp:level:2': 'seven' }, schema), [
    'hp:level:2: must be a number, not a string',
  ]);
});

test('an unknown keyword is ignored rather than treated as a failure', () => {
  assert.ok(matchesJsonSchema('x', { type: 'string', 'x-editor-hint': 'multiline' }));
});

test('a pattern that does not compile does not take the validator down', () => {
  assert.equal(messages('x', { type: 'string', pattern: '[' }).length, 1);
});

test('errors are capped', () => {
  const schema = { type: 'array', items: { type: 'string' } };
  assert.equal(validateJson(Array(500).fill(1), schema, { maxErrors: 5 }).length, 5);
});
