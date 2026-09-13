import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEVER_MATCHES,
  parseSupports,
  matchesSupports,
  supportsInterpolations,
  type SupportsContext,
  type SupportsExpr,
} from './supports.ts';

interface CandidateOptions {
  id?: string;
  setters?: string[];
  resolve?: (key: string) => SupportsExpr | undefined;
}

function candidate(tags: string[], options: CandidateOptions = {}): SupportsContext {
  return {
    tags: new Set(tags.map((t) => t.toLowerCase())),
    setterValues: new Set((options.setters ?? []).map((s) => s.toLowerCase())),
    id: options.id ?? 'ID_X',
    resolve: options.resolve ?? (() => undefined),
  };
}

const tag = (t: string): SupportsExpr => ({ kind: 'tag', tag: t });

test('a single tag', () => {
  const expr = parseSupports('Skill');
  assert.equal(matchesSupports(expr, candidate(['Skill'])), true);
  assert.equal(matchesSupports(expr, candidate(['Tool'])), false);
});

test('comma is and', () => {
  const expr = parseSupports('Skill,Rogue');
  assert.equal(matchesSupports(expr, candidate(['Skill', 'Rogue'])), true);
  assert.equal(matchesSupports(expr, candidate(['Skill'])), false);
});

test('double pipe is or', () => {
  const expr = parseSupports('Standard||Exotic');
  assert.equal(matchesSupports(expr, candidate(['Exotic'])), true);
  assert.equal(matchesSupports(expr, candidate(['Martial'])), false);
});

test('bare ids are legal operands', () => {
  const expr = parseSupports('ID_PHB_FEAT_ASI_STRENGTH|ID_PHB_FEAT_ASI_DEXTERITY');
  assert.equal(matchesSupports(expr, candidate([], { id: 'ID_PHB_FEAT_ASI_DEXTERITY' })), true);
  assert.equal(matchesSupports(expr, candidate([], { id: 'ID_OTHER' })), false);
});

/**
 * The precedence case, and the corpus proves the answer rather than the format describing it.
 *
 * Tasha's Aberrant Mind writes `1,(Divination||Enchantment),(Sorcerer||Warlock||Wizard)||Arms
 * of Hadar` and then *appends a bespoke `Arms of Hadar` support tag to that one spell*, so the
 * trailing operand has something to find. Arms of Hadar is a 1st-level **Conjuration**: under
 * the other precedence the school clause ANDs over the whole filter and excludes the very
 * spell the `||` was written to add, and the appended tag would be dead content.
 */
test('comma binds tighter than the pipe', () => {
  const expr = parseSupports('1,Enchantment||Arms of Hadar');
  // The named exception, which fails both the level and the school clause.
  assert.equal(matchesSupports(expr, candidate(['Arms of Hadar'], { setters: ['1', 'Conjuration'] })), true);
  // The ordinary case: 1st-level enchantment.
  assert.equal(matchesSupports(expr, candidate([], { setters: ['1', 'Enchantment'] })), true);
  // A 2nd-level enchantment is neither.
  assert.equal(matchesSupports(expr, candidate([], { setters: ['2', 'Enchantment'] })), false);
});

test('parentheses group', () => {
  const expr = parseSupports('1,(Druid||Wizard)');
  assert.equal(matchesSupports(expr, candidate(['Wizard'], { setters: ['1'] })), true);
  assert.equal(matchesSupports(expr, candidate(['Cleric'], { setters: ['1'] })), false);
  assert.equal(matchesSupports(expr, candidate(['Wizard'], { setters: ['2'] })), false);
});

test('a parenthesised group may be a whole operand of an or', () => {
  // `(0)||($(spellcasting:slots))` — a bard's Magical Secrets, once the interpolation is gone.
  const expr = parseSupports('(0)||(1||2)');
  assert.equal(matchesSupports(expr, candidate([], { setters: ['0'] })), true);
  assert.equal(matchesSupports(expr, candidate([], { setters: ['2'] })), true);
  assert.equal(matchesSupports(expr, candidate([], { setters: ['3'] })), false);
});

/**
 * A spell's level and school are setters, not tags, so without this every levelled select in
 * the game matches nothing. Unconditional across setters rather than narrowed to named ones,
 * because the corpus says narrowing buys nothing: over operands 0-9 the two agree exactly.
 */
test('an operand may name a setter value', () => {
  const expr = parseSupports('Bard,0');
  assert.equal(matchesSupports(expr, candidate(['Bard'], { setters: ['0', 'Evocation'] })), true);
  assert.equal(matchesSupports(expr, candidate(['Bard'], { setters: ['1', 'Evocation'] })), false);
  // A candidate with no setters at all is not a crash and is not a match.
  assert.equal(matchesSupports(parseSupports('0'), { tags: new Set(), id: 'ID_X', resolve: () => undefined }), false);
});

test('an unresolved interpolation matches nothing rather than everything', () => {
  const expr = parseSupports('$(spellcasting:list), 0');
  assert.equal(matchesSupports(expr, candidate(['0'])), false);
  const resolved = candidate(['wizard'], {
    setters: ['0'],
    resolve: (k) => (k === 'spellcasting:list' ? tag('wizard') : undefined),
  });
  assert.equal(matchesSupports(expr, resolved), true);
});

/**
 * The interpolation expands to an *expression*, not a tag — an Eldritch Knight's list is
 * `Wizard,(Abjuration||Evocation)` and its slot set is an OR that widens as it levels.
 */
test('an interpolation may expand to a sub-expression', () => {
  const expr = parseSupports('$(spellcasting:list), $(spellcasting:slots)');
  const resolve = (k: string): SupportsExpr | undefined =>
    k === 'spellcasting:list'
      ? parseSupports('Wizard,(Abjuration||Evocation)')
      : k === 'spellcasting:slots'
        ? { kind: 'or', children: [tag('1'), tag('2')] }
        : undefined;
  const abjuration2 = candidate(['Wizard'], { setters: ['2', 'Abjuration'], resolve });
  const necromancy2 = candidate(['Wizard'], { setters: ['2', 'Necromancy'], resolve });
  const abjuration3 = candidate(['Wizard'], { setters: ['3', 'Abjuration'], resolve });
  assert.equal(matchesSupports(expr, abjuration2), true);
  assert.equal(matchesSupports(expr, necromancy2), false, 'the school clause must survive nesting');
  assert.equal(matchesSupports(expr, abjuration3), false, 'the slot set must survive nesting');
});

test('an expansion that finds nothing is not the same as one that cannot be evaluated', () => {
  const expr = parseSupports('$(spellcasting:slots)');
  const empty = candidate([], { setters: ['1'], resolve: () => NEVER_MATCHES });
  assert.equal(matchesSupports(expr, empty), false);
  assert.notEqual(NEVER_MATCHES, undefined);
});

test('a self-referential expansion terminates', () => {
  const expr = parseSupports('$(loop)');
  const looping = candidate([], { resolve: () => parseSupports('$(loop)') });
  assert.equal(matchesSupports(expr, looping), false);
});

test('the interpolations an expression carries are reported, parenthesised or not', () => {
  assert.deepEqual(
    [...supportsInterpolations(parseSupports('(Wizard||$(spellcasting:list)), $(spellcasting:slots)'))],
    ['spellcasting:list', 'spellcasting:slots'],
  );
});
