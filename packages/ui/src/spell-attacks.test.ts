import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, setSpellAttack, type DerivedAttack, type Element, type ResolvedCharacterKind } from '@incudo/core';

import { attackHead } from './sheet-document.ts';
import { sheetAttack, SPELL_NO_CLASS, SPELL_NO_DAMAGE, SPELL_ROLLS_NOTHING } from './sheet.ts';
import { givenBlockLabel, spellAttackRefusal, spellAttacksState } from './spell-attacks.ts';

// A spell's attack row as the sheet words it and the editor offers it — ADR 0111. No game: "Charm", "Circle" and "Grit"
// stand for 5e's spell, a class and an ability.

function row(spell: NonNullable<DerivedAttack['spell']>, extra: Partial<DerivedAttack> = {}): DerivedAttack {
  return { elementId: 'BOLT', name: 'Bolt', equipped: true, bonus: 5, damageBonus: 0, alternatives: [], properties: [], stats: {}, spell, ...extra };
}

test('an attack writes its bonus, a save its DC and ability, and a spell no class casts a dash and a note', () => {
  // Perturbation: write the bonus for a save and the save reads "+5".
  assert.equal(attackHead(sheetAttack(row({ kind: 'attack', block: 'Circle', dice: 'chosen' }, { dice: '2d10', damageType: 'fire', range: '120 feet' }))), 'Bolt: +5, 2d10 fire (range 120 feet)');
  assert.equal(attackHead(sheetAttack(row({ kind: 'save', block: 'Circle', dc: 13, ability: 'Grit', dice: 'chosen' }, { dice: '1d8', damageType: 'radiant' }))), 'Bolt: DC 13 Grit, 1d8 radiant');
  assert.equal(attackHead(sheetAttack(row({ kind: 'save', block: 'Circle', dc: 13, dice: 'chosen' }, { dice: '1d8' }))), 'Bolt: DC 13, 1d8');
  assert.equal(attackHead(sheetAttack(row({ kind: 'attack', dice: 'chosen' }, { dice: '1d10' }))), `Bolt: —, 1d10 (${SPELL_NO_CLASS})`);
});

test('two dice read "or", no die chosen a dash and a note, and none chosen "no damage"', () => {
  // Perturbation: drop orDice and Toll the Dead's second die is lost.
  assert.equal(sheetAttack(row({ kind: 'save', block: 'Circle', dc: 12, dice: 'chosen', orDice: ['1d12'] }, { dice: '1d8', damageType: 'necrotic' })).damage, '1d8 or 1d12 necrotic');
  const unchosen = sheetAttack(row({ kind: 'attack', block: 'Circle', dice: 'unchosen' }));
  assert.equal(unchosen.damage, '—');
  assert.deepEqual(unchosen.notes, [SPELL_NO_DAMAGE]);
  assert.equal(sheetAttack(row({ kind: 'attack', block: 'Circle', dice: 'chosen' })).damage, SPELL_ROLLS_NOTHING);
});

const KIND = {
  attacks: {
    types: [], tagStat: 't', bonus: 'b', damage: 'd', dice: 'x', stats: [],
    spells: { types: ['Charm'], setter: 'rank', values: ['0'], count: { kind: 'number', value: 1 }, sides: [6, 8], damageTypes: ['fire'], abilities: ['Grit'] },
  },
} as unknown as Pick<ResolvedCharacterKind, 'attacks'>;

const CASTER: Element = {
  id: 'CASTER', type: 'Class', name: 'Caster', source: 't', setters: {}, rules: [], supports: [],
  spellcasting: [{ name: 'Circle', attributes: {} }], origin: { sourceId: 't', format: 'incudo' },
} as unknown as Element;

function state(attacks: DerivedAttack[], character = createCharacter('t', 'k')) {
  return spellAttacksState({ attacks, elements: [CASTER], character }, KIND);
}

test("the editor lists each spell row with the user's choice and the class content gives, and offers the system's lists", () => {
  const character = setSpellAttack(createCharacter('t', 'k'), 'BOLT', { sides: [8] });
  const s = state([row({ kind: 'attack', block: 'Circle', given: 'Circle', dice: 'chosen' }, { dice: '1d8' }), { ...row({ kind: 'attack', dice: 'unchosen' }), spell: undefined, elementId: 'SWORD' }], character);
  assert.equal(s.available, true);
  assert.deepEqual(s.rows.map((r) => [r.elementId, r.given, r.choice]), [['BOLT', 'Circle', { sides: [8] }]]);
  assert.deepEqual(s.sides, [6, 8]);
  assert.deepEqual(s.blocks.map((b) => b.key), ['circle']);
  assert.equal(givenBlockLabel(s.rows[0]!), 'As content gives it (Circle)');
  assert.equal(givenBlockLabel({}), 'No class');
  assert.equal(spellAttacksState({ attacks: [], elements: [], character }, { attacks: undefined } as never).available, false);
});

test('a choice not offered is refused with a sentence, and one that is offered is not', () => {
  // Perturbation: skip the sides check and a d20 is accepted.
  const s = state([row({ kind: 'attack', block: 'Circle', dice: 'unchosen' }), { ...row({ kind: 'save', dice: 'content' }), elementId: 'WARD' }]);
  assert.equal(spellAttackRefusal(s, 'BOLT', { sides: [8], damageType: 'fire', block: 'Circle' }), undefined);
  assert.equal(spellAttackRefusal(s, 'BOLT', { sides: [] }), undefined);
  assert.match(spellAttackRefusal(s, 'BOLT', { sides: [20] })!, /not offered/);
  assert.match(spellAttackRefusal(s, 'BOLT', { sides: [6, 8, 6] })!, /two/);
  assert.match(spellAttackRefusal(s, 'BOLT', { damageType: 'cold' })!, /not offered/);
  assert.match(spellAttackRefusal(s, 'BOLT', { ability: 'Grit' })!, /not offered/);
  assert.match(spellAttackRefusal(s, 'BOLT', { block: 'Elsewhere' })!, /no such class/);
  assert.match(spellAttackRefusal(s, 'WARD', { sides: [6] })!, /stated by its content/);
  assert.equal(spellAttackRefusal(s, 'WARD', { ability: 'Grit' }), undefined);
  assert.match(spellAttackRefusal(s, 'NOTHING', {})!, /no attack row/);
});
