import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatValue, evaluateExpr, type ExpressionContext } from './expression.ts';

function ctx(stats: Record<string, number> = {}, strings: Record<string, string> = {}): ExpressionContext {
  return {
    statNumber: (s) => stats[s.toLowerCase()] ?? 0,
    statString: (s) => strings[s.toLowerCase()],
  };
}

test('a content value is a number, a reference, or a literal', () => {
  assert.deepEqual(parseStatValue('3'), { kind: 'number', value: 3 });
  assert.deepEqual(parseStatValue('charisma:modifier'), {
    kind: 'ref',
    stat: 'charisma:modifier',
  });
  assert.deepEqual(parseStatValue('1d6 fire damage'), {
    kind: 'literal',
    value: '1d6 fire damage',
  });
});

test('a negated reference subtracts rather than naming a stat that starts with a minus', () => {
  // The warlock's pact table takes back the previous tier this way. Read as a plain
  // reference, "-warlock:…" names nothing, resolves to 0, and the slots are never removed.
  const expr = parseStatValue('-warlock:spellcasting:slots:count');
  assert.equal(evaluateExpr(expr, ctx({ 'warlock:spellcasting:slots:count': 4 })), -4);
});

test('a negative number is still a number, not a negated reference', () => {
  assert.deepEqual(parseStatValue('-2'), { kind: 'number', value: -2 });
});

test('a leading minus on something that is not a reference stays a literal', () => {
  assert.deepEqual(parseStatValue('-Fire and Ice'), { kind: 'literal', value: '-Fire and Ice' });
});
