import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatValue, evaluateExpr, evaluateExprAsString, statReferences, type ExpressionContext, type StatExpr } from './expression.ts';

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

test('the engine reads no :half suffix: a reference names the stat it names — ADR 0119', () => {
  // ADR 0046 read `level:paladin:half` here, at evaluation. The converter now writes it as `floor(level:paladin / 2)`
  // (`@incudo/aurora-import`'s `withoutHalves`), so a reference is the stat it names and nothing else. Perturbation: reading
  // the suffix here again gives 1 for the first.
  assert.equal(evaluateExpr({ kind: 'ref', stat: 'level:paladin:half' }, ctx({ 'level:paladin': 3 })), 0);
  assert.equal(evaluateExpr({ kind: 'ref', stat: 'level:x:half' }, ctx({ 'level:x': 8, 'level:x:half': 7 })), 7);
  assert.equal(evaluateExprAsString({ kind: 'ref', stat: 'level:paladin:half' }, ctx({ 'level:paladin': 5 })), '0');
});

test('an expression names the stats it reads, once each, in order', () => {
  // Fails with a branch of a binary, a call's arguments or a table's index not walked, or a repeat kept (ADR 0095: a
  // sheet follows these names, never their numbers).
  const expr: StatExpr = {
    kind: 'binary',
    op: '+',
    left: { kind: 'call', fn: 'floor', args: [{ kind: 'ref', stat: 'A' }, { kind: 'ref', stat: 'b:half:up' }] },
    right: { kind: 'binary', op: '*', left: { kind: 'table', index: { kind: 'ref', stat: 'c' }, values: [1, 2] }, right: { kind: 'ref', stat: 'a' } },
  };
  assert.deepEqual(statReferences(expr), ['a', 'b:half:up', 'c']);
  assert.deepEqual(statReferences({ kind: 'number', value: 3 }), []);
  assert.deepEqual(statReferences(undefined), []);
});
