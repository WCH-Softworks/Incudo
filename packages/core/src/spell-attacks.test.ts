import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveAttacks, type AttackReader, type SpellCasting } from './attacks.ts';
import { createCharacter, setSpellAttack, type Character } from './character.ts';
import { MapElementIndex, type Element, type Setter } from './model.ts';
import type { AttacksDef } from './system.ts';

// A cantrip's attack row — ADR 0111. No game here: "Charm", "rank" and "Bolt Tag" stand for 5e's spell, level and
// "Spell Attack"; core knows none of them.

function thing(id: string, name: string, setters: Record<string, string | Setter> = {}, supports: string[] = []): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = typeof value === 'string' ? { value } : value;
  return { id, type: 'Charm', name, source: 'test', setters: out, rules: [], supports, origin: { sourceId: 'test', format: 'incudo' } };
}

const DEF: AttacksDef = {
  types: ['Blade'],
  tagStat: 'blade',
  bonus: 'strike:bonus',
  damage: 'strike:damage',
  dice: 'hurt',
  stats: [],
  spells: {
    types: ['Charm'],
    setter: 'rank',
    values: ['0'],
    attack: { tag: 'Bolt Tag', bonus: '{name}:aim' },
    save: { tag: 'Ward Tag', dc: '{name}:difficulty' },
    count: { kind: 'table', index: { kind: 'ref', stat: 'tier' }, values: [1, 1, 2, 3] },
    dice: 'hurt',
    damageType: 'kind',
    range: 'reach',
    sides: [4, 6, 8],
  },
};

const BOLT = thing('BOLT', 'Bolt', { rank: '0', reach: '60 feet' }, ['Bolt Tag']);
const WARD = thing('WARD', 'Ward', { rank: '0' }, ['Ward Tag']);
const BIG = thing('BIG', 'Big Bolt', { rank: '1' }, ['Bolt Tag']);
const PLAIN = thing('PLAIN', 'Plain', { rank: '0' });
const STATED = thing('STATED', 'Stated', { rank: '0', hurt: { value: 'd10', attrs: { kind: 'burning' } } }, ['Bolt Tag']);
const ODD = thing('ODD', 'Odd', { rank: '0', hurt: '2d4+1' }, ['Bolt Tag']);

const STATS: Record<string, number> = { tier: 1, 'circle:aim': 5, 'circle:difficulty': 13, 'other:aim': 7 };

function reader(stats: Record<string, number> = STATS): AttackReader {
  return { hasElement: () => false, statNumber: (s) => stats[s.toLowerCase()] ?? 0, statString: () => undefined, hasFlag: () => false };
}

function casting(held: Element[], blocks: Record<string, string> = {}): SpellCasting {
  const declared = new Map([['circle', 'Circle'], ['other', 'Other']]);
  return { held, blockOf: (id) => blocks[id], blockNamed: (key) => declared.get(key.trim().toLowerCase()) };
}

function rows(character: Character, held: Element[], blocks: Record<string, string> = {}, stats?: Record<string, number>) {
  return deriveAttacks(character, new MapElementIndex(), DEF, reader(stats), undefined, casting(held, blocks));
}

const base = createCharacter('test', 'kind');

test('only a held spell of the setter value carrying the attack or the save tag is a row', () => {
  // Perturbation: drop the tag check and Plain is a row; drop the setter check and Big Bolt is.
  const out = rows(base, [BOLT, WARD, BIG, PLAIN], { BOLT: 'Circle', WARD: 'Circle' });
  assert.deepEqual(out.map((a) => [a.name, a.spell?.kind]), [['Bolt', 'attack'], ['Ward', 'save']]);
});

test("an attack reads its block's bonus and a save its block's DC; a spell no block holds has neither", () => {
  // Perturbation: read the template without filling {name} and every bonus is 0.
  const [bolt, ward] = rows(base, [BOLT, WARD], { BOLT: 'Circle', WARD: 'Circle' });
  assert.equal(bolt!.bonus, 5);
  assert.equal(bolt!.spell?.block, 'Circle');
  assert.equal(ward!.spell?.dc, 13);
  const [loose] = rows(base, [BOLT]);
  assert.equal(loose!.spell?.block, undefined);
  assert.equal(loose!.spell?.dc, undefined);
});

test('a chosen block replaces the one content gives, and one nothing declares falls back to it', () => {
  const chosen = setSpellAttack(base, 'BOLT', { block: 'Other' });
  assert.equal(rows(chosen, [BOLT], { BOLT: 'Circle' })[0]!.bonus, 7);
  assert.equal(rows(chosen, [BOLT])[0]!.spell?.block, 'Other');
  const gone = setSpellAttack(base, 'BOLT', { block: 'Nowhere' });
  assert.equal(rows(gone, [BOLT], { BOLT: 'Circle' })[0]!.spell?.block, 'Circle');
});

test("the user's die is rolled count times, a second die is offered beside it, none rolls nothing", () => {
  // Perturbation: ignore count and the die reads 1d8 at tier 3.
  assert.equal(rows(base, [BOLT])[0]!.spell?.dice, 'unchosen');
  assert.equal(rows(base, [BOLT])[0]!.dice, undefined);
  const one = setSpellAttack(base, 'BOLT', { sides: [8], damageType: 'shock' });
  const [row] = rows(one, [BOLT]);
  assert.equal(row!.dice, '1d8');
  assert.equal(row!.damageType, 'shock');
  assert.equal(row!.spell?.dice, 'chosen');
  assert.equal(rows(one, [BOLT], {}, { ...STATS, tier: 3 })[0]!.dice, '3d8');
  const two = setSpellAttack(base, 'WARD', { sides: [8, 12], ability: 'Grit' });
  const [ward] = rows(two, [WARD]);
  assert.equal(ward!.dice, '1d8');
  assert.deepEqual(ward!.spell?.orDice, ['1d12']);
  assert.equal(ward!.spell?.ability, 'Grit');
  const none = setSpellAttack(base, 'BOLT', { sides: [] });
  assert.equal(rows(none, [BOLT])[0]!.dice, undefined);
  assert.equal(rows(none, [BOLT])[0]!.spell?.dice, 'chosen');
});

test("a die content states wins over the user's; a dN scales, another shape is written as it is", () => {
  // Perturbation: read the user's choice first and Stated reads 1d4.
  const chose = setSpellAttack(base, 'STATED', { sides: [4], damageType: 'shock' });
  const [stated] = rows(chose, [STATED]);
  assert.equal(stated!.dice, '1d10');
  assert.equal(stated!.damageType, 'burning');
  assert.equal(stated!.spell?.dice, 'content');
  assert.equal(rows(base, [ODD])[0]!.dice, '2d4+1');
});

test('an ability is kept only on a saving throw, and the range is the setter as written', () => {
  const chose = setSpellAttack(base, 'BOLT', { ability: 'Grit' });
  const [bolt] = rows(chose, [BOLT]);
  assert.equal(bolt!.spell?.ability, undefined);
  assert.equal(bolt!.range, '60 feet');
});

test('a choice raises the format to 13, an empty one is forgotten, and forgetting the last leaves the version', () => {
  const chose = setSpellAttack(base, 'BOLT', { sides: [6] });
  assert.equal(chose.formatVersion, 13);
  assert.deepEqual(chose.spellAttacks, { BOLT: { sides: [6] } });
  const forgot = setSpellAttack(chose, 'BOLT', {});
  assert.equal(forgot.spellAttacks, undefined);
  assert.equal(forgot.formatVersion, 13);
  assert.equal(setSpellAttack(base, 'BOLT', undefined), base);
  assert.deepEqual(setSpellAttack(base, 'BOLT', { block: ' Circle ' }).spellAttacks, { BOLT: { block: 'circle' } });
});
