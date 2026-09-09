import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSupports, matchesSupports, type SupportsContext } from './supports.ts';

function candidate(tags: string[], id = 'ID_X', resolve: (k: string) => string | undefined = () => undefined): SupportsContext {
  return { tags: new Set(tags.map((t) => t.toLowerCase())), id, resolve };
}

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
  assert.equal(matchesSupports(expr, candidate([], 'ID_PHB_FEAT_ASI_DEXTERITY')), true);
  assert.equal(matchesSupports(expr, candidate([], 'ID_OTHER')), false);
});

test('an unresolved interpolation matches nothing rather than everything', () => {
  const expr = parseSupports('$(spellcasting:list), 0');
  assert.equal(matchesSupports(expr, candidate(['0'])), false);
  const resolved = candidate(['wizard', '0'], 'ID_X', (k) =>
    k === 'spellcasting:list' ? 'wizard' : undefined,
  );
  assert.equal(matchesSupports(expr, resolved), true);
});
