import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequirements, evaluateRequirements, type RequirementContext } from './requirements.ts';

function ctx(opts: {
  elements?: string[];
  stats?: Record<string, number>;
  strings?: Record<string, string>;
}): RequirementContext {
  const elements = new Set(opts.elements ?? []);
  return {
    hasElement: (id) => elements.has(id),
    statNumber: (s) => opts.stats?.[s] ?? 0,
    statString: (s) => opts.strings?.[s],
    hasFlag: (n) => (opts.stats?.[n] ?? 0) > 0,
  };
}

test('a bare id is a membership check', () => {
  const expr = parseRequirements('ID_A');
  assert.equal(evaluateRequirements(expr, ctx({ elements: ['ID_A'] })), true);
  assert.equal(evaluateRequirements(expr, ctx({})), false);
});

test('negation', () => {
  const expr = parseRequirements('!ID_WOTC_PHB_MULTICLASS_ROGUE');
  assert.equal(evaluateRequirements(expr, ctx({})), true);
  assert.equal(
    evaluateRequirements(expr, ctx({ elements: ['ID_WOTC_PHB_MULTICLASS_ROGUE'] })),
    false,
  );
});

test('comma is and, pipe is or, ! binds tightest', () => {
  const expr = parseRequirements('!(ID_A|ID_B)');
  assert.equal(evaluateRequirements(expr, ctx({})), true);
  assert.equal(evaluateRequirements(expr, ctx({ elements: ['ID_B'] })), false);
});

test('real corpus expression: rogue multiclass', () => {
  const expr = parseRequirements(
    '([dex:13],!(ID_WOTC_PHB24_CLASS_ROGUE||ID_WOTC_PHB24_MULTICLASS_ROGUE))||ID_INTERNAL_GRANTS_MULTICLASS_UNLOCKER',
  );
  // Dex 13 and no 2024 rogue -> allowed
  assert.equal(evaluateRequirements(expr, ctx({ stats: { dex: 13 } })), true);
  // Dex 12 -> not allowed
  assert.equal(evaluateRequirements(expr, ctx({ stats: { dex: 12 } })), false);
  // Dex 12 but the unlocker is present -> allowed
  assert.equal(
    evaluateRequirements(
      expr,
      ctx({ stats: { dex: 12 }, elements: ['ID_INTERNAL_GRANTS_MULTICLASS_UNLOCKER'] }),
    ),
    true,
  );
  // Dex 13 but already a 2024 rogue -> not allowed
  assert.equal(
    evaluateRequirements(expr, ctx({ stats: { dex: 13 }, elements: ['ID_WOTC_PHB24_CLASS_ROGUE'] })),
    false,
  );
});

test('namespaced stat thresholds keep every segment but the numeric tail', () => {
  const expr = parseRequirements('[level:warlock:2]');
  assert.deepEqual(expr, { kind: 'atLeast', stat: 'level:warlock', value: 2 });
});

test('a non-numeric tail is a string equality check', () => {
  const expr = parseRequirements('[armor:heavy]');
  assert.deepEqual(expr, { kind: 'equals', stat: 'armor', value: 'heavy' });
  assert.equal(evaluateRequirements(expr, ctx({ strings: { armor: 'Heavy' } })), true);
  assert.equal(evaluateRequirements(expr, ctx({ strings: { armor: 'none' } })), false);
});

test('a single-segment bracket is a flag', () => {
  assert.deepEqual(parseRequirements('[d10s]'), { kind: 'flag', name: 'd10s' });
});

test('empty and missing input mean no requirement', () => {
  assert.equal(parseRequirements(undefined), undefined);
  assert.equal(parseRequirements('  '), undefined);
  assert.equal(evaluateRequirements(undefined, ctx({})), true);
});
