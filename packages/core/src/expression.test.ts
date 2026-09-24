import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatValue, evaluateExpr, evaluateExprAsString, type ExpressionContext } from './expression.ts';

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

test('a reference may be halved, rounding down, or up with :up — ADR 0046', () => {
  // It stays a plain reference in the parsed form, so a corpus cached or embedded before this reads the same.
  assert.deepEqual(parseStatValue('level:paladin:half'), { kind: 'ref', stat: 'level:paladin:half' });
  const stats = { 'level:paladin': 3, proficiency: 5, 'intelligence:modifier': 3 };
  assert.equal(evaluateExpr(parseStatValue('level:paladin:half'), ctx(stats)), 1);
  assert.equal(evaluateExpr(parseStatValue('level:paladin:half:up'), ctx(stats)), 2);
  assert.equal(evaluateExpr(parseStatValue('proficiency:half'), ctx(stats)), 2);
  assert.equal(evaluateExpr(parseStatValue('proficiency:half:up'), ctx(stats)), 3);
  assert.equal(evaluateExpr(parseStatValue('intelligence:modifier:half:up'), ctx(stats)), 2);
  // A class the character does not have reads 0, so the half of it is 0 and adds nothing.
  assert.equal(evaluateExpr(parseStatValue('level:artificer:half'), ctx(stats)), 0);
});

test('a suffix is read only when nothing is published under the suffixed name', () => {
  assert.equal(evaluateExpr({ kind: 'ref', stat: 'level:x:half' }, ctx({ 'level:x': 8, 'level:x:half': 7 })), 7);
  // `half` alone and `:half` name nothing to halve.
  assert.equal(evaluateExpr({ kind: 'ref', stat: 'half' }, ctx({ '': 8 })), 0);
  assert.equal(evaluateExpr({ kind: 'ref', stat: ':half' }, ctx({ '': 8 })), 0);
  // The string form of a reference takes the same reading.
  assert.equal(evaluateExprAsString({ kind: 'ref', stat: 'level:paladin:half' }, ctx({ 'level:paladin': 5 })), '2');
});
