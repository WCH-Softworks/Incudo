/**
 * A character made into another kind — ADR 0134.
 *
 * No game in the fixture. A Wanderer has a level, a Path chosen at the start (whose own select offers a Knack), a bag,
 * two text fields and a typed Might. A Beast has a Danger rating its Form prints, lets a Knack be added, keeps one of
 * the Wanderer's text fields, and types Might and Guard. A Path adds 2 to Guard and a Beast adds 1 to Might, so a copy has
 * something to correct for. Each test names the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, deriveCharacter, MapElementIndex, type Character, type Element, type GameSystem, type Rule } from '@incudo/core';

import { CONVERSION_UNSAVED_NOTE, conversionPrompt, conversionTarget, convertCharacterKind, convertUnticking, copyLine, kindConversionTargets } from './kind-conversion.ts';

function element(id: string, type: string, rules: Rule[] = [], setters: Record<string, string> = {}): Element {
  return {
    id,
    type,
    name: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, ' '),
    source: 'Book',
    setters: Object.fromEntries(Object.entries(setters).map(([k, value]) => [k, { value }])),
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const add = (name: string, value: number): Rule => ({ kind: 'stat', key: `stat:${name}`, name, value: { kind: 'number', value } });
const select = (name: string, type: string): Rule => ({ kind: 'select', key: `select:${name}`, type, name, number: 1 });

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Path' }, { name: 'Knack' }, { name: 'Form' }, { name: 'Trinket' }],
  stats: [
    { name: 'level', default: 1 },
    { name: 'danger', default: 0 },
    { name: 'might', label: 'Might', default: 10 },
    { name: 'guard', label: 'Guard', default: 0 },
    { name: 'spare points', default: 0 },
  ],
  generationMethods: [
    { id: 'manual', label: 'Manual', min: 1, max: 30 },
    { id: 'entry', label: 'Entry', min: 0 },
  ],
  characterKinds: [
    {
      id: 'wanderer',
      name: 'Wanderer',
      default: true,
      progression: { kind: 'level', min: 1, max: 10, stat: 'level' },
      elementTypes: ['Path', 'Knack', 'Trinket'],
      inventory: { slots: [], slotSetter: 'slot', occupiedTag: 'any', emptyTag: 'none' },
      freeform: { label: 'About', fields: [{ key: 'tale', label: 'Tale' }, { key: 'notes', label: 'Notes' }] },
      buildSteps: [
        { id: 'path', label: 'Path', types: ['Path'], required: true },
        { id: 'scores', label: 'Scores', types: [], budget: { stat: 'spare points', targets: ['might'], methods: ['manual'] } },
      ],
      sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['might', 'guard'] }] },
    },
    {
      id: 'beast',
      name: 'Beast',
      progression: { kind: 'rating', stat: 'danger', min: 0, max: 30 },
      elementTypes: ['Form', 'Knack'],
      setterStats: [{ types: ['Form'], setter: 'danger', stat: 'danger' }],
      contributions: [{ stat: 'might', value: { kind: 'number', value: 1 } }],
      additions: { types: ['Knack'], description: 'Knacks of its own.' },
      freeform: { label: 'About', fields: [{ key: 'notes', label: 'Notes' }] },
      buildSteps: [
        { id: 'form', label: 'Form', types: ['Form'], pick: true },
        { id: 'numbers', label: 'Numbers', types: [], budget: { stat: 'spare points', targets: ['might', 'guard'], methods: ['entry'] } },
      ],
      sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['might', 'guard'] }] },
    },
  ],
};

const index = new MapElementIndex();
index.addAll([
  element('ROAD', 'Path', [select('Knack', 'Knack'), add('guard', 2)]),
  element('LUCK', 'Knack'),
  element('GRIT', 'Knack'),
  element('WOLF', 'Form', [], { danger: '2' }),
  element('COIN', 'Trinket'),
]);

/** A level 3 Wanderer on the Road with Luck, Might 14 typed, a coin, a tale, notes and a roll. */
function wanderer(): Character {
  const c = createCharacter('test', 'wanderer', { name: 'Ash', progress: 3 });
  c.choices = [
    { ruleKey: 'START/select:Path', elementIds: ['ROAD'] },
    { ruleKey: 'ROAD/select:Knack', elementIds: ['LUCK'] },
  ];
  c.baseStats = { might: 14 };
  c.inventory = [{ instanceId: '1', elementId: 'COIN', quantity: 3 }];
  c.freeform = { tale: 'Born on the road.', notes: 'Owes a debt.', aside: 'Kept by nothing.' };
  c.rolls = { 'other:roll': 4 };
  return c;
}

test('the targets are every other kind, and a conversion to its own kind is refused', () => {
  // Fails if the character's own kind is offered.
  assert.deepEqual(kindConversionTargets(system, 'wanderer'), [{ id: 'beast', name: 'Beast' }]);
  assert.throws(() => convertCharacterKind(wanderer(), system, 'wanderer', index), /already Wanderer/);
});

test("a confirmation left holding the character's own kind converts to the first target instead", () => {
  // Fails if the chosen kind is used unchecked: the dialog reopened after a conversion converted to its own kind and threw.
  const targets = kindConversionTargets(system, 'beast');
  assert.equal(conversionTarget(targets, 'beast'), 'wanderer');
  assert.equal(conversionTarget(targets, undefined), 'wanderer');
  assert.equal(conversionTarget(kindConversionTargets(system, 'wanderer'), 'beast'), 'beast');
});

test('a choice of a type the new kind does not list is dropped and named; the original is untouched', () => {
  // Fails if the type check is left out of the choice filter: the Beast would keep the Road, and its select's Luck.
  const before = wanderer();
  const copy = structuredClone(before);
  const result = convertCharacterKind(before, system, 'beast', index, { add: [] });
  assert.deepEqual(before, copy);
  assert.equal(result.character.kind, 'beast');
  assert.deepEqual(result.character.choices, []);
  const choices = result.lost.find((g) => g.heading === 'Choices')!;
  assert.deepEqual(choices.lines, ['Path: Road', 'Knack: Luck']);
});

test('a pick whose pool only something now gone opened is offered as an addition, and dropped when not taken', () => {
  // Fails if the closed-pick pass is skipped: Luck stays recorded under a select nothing holds.
  const kept = convertCharacterKind(wanderer(), system, 'beast', index);
  assert.deepEqual(kept.additions, [{ elementId: 'LUCK', name: 'Luck', from: 'Knack', added: true }]);
  assert.deepEqual(kept.character.additions, ['LUCK']);
  assert.ok(kept.character.formatVersion >= 5);
  assert.ok(!kept.lost.find((g) => g.heading === 'Choices')!.lines.includes('Knack: Luck'));
  assert.ok(kept.changed.some((line) => line.includes('Luck')));
  const dropped = convertCharacterKind(wanderer(), system, 'beast', index, { add: [] });
  assert.equal(dropped.character.additions, undefined);
  assert.equal(dropped.additions[0]!.added, false);
});

test('a level the new kind does not have is not kept, and the rating is left to what it is built on', () => {
  // Fails if progress is copied across: the Beast would read Danger 3, which nothing printed.
  const result = convertCharacterKind(wanderer(), system, 'beast', index);
  assert.equal(result.character.progress, undefined);
  assert.ok(result.character.formatVersion >= 3);
  assert.deepEqual(result.lost.find((g) => g.heading === 'Progression')!.lines, ['level 3: danger starts where what it is built on prints one, or at 0']);
});

test('the bag goes where the new kind has no inventory, and only text the old kind showed is dropped', () => {
  // Fails if freeform keys are filtered by the new kind alone: "aside", which neither shows, would go too.
  const result = convertCharacterKind(wanderer(), system, 'beast', index);
  assert.equal(result.character.inventory, undefined);
  assert.deepEqual(result.lost.find((g) => g.heading === 'Carried')!.lines, ['Coin ×3']);
  assert.deepEqual(result.character.freeform, { notes: 'Owes a debt.', aside: 'Kept by nothing.' });
  assert.deepEqual(result.lost.find((g) => g.heading === 'Text')!.lines, ['Tale']);
  assert.deepEqual(result.lost.find((g) => g.heading === 'Rolls')!.lines, ['Other: one recorded roll']);
});

test('a copied number is typed so the new sheet reads what the old one showed, and only when asked', () => {
  // Fails if the correction pass is skipped: with a Beast adding 1, Might typed as 14 reads 15.
  const old = wanderer();
  assert.equal(deriveCharacter(old, system, index).stats.get('guard')?.value, 2);

  const all = convertCharacterKind(old, system, 'beast', index);
  const derived = deriveCharacter(all.character, system, index);
  assert.equal(derived.stats.get('might')?.value, 14);
  assert.equal(derived.stats.get('guard')?.value, 2);
  assert.equal(all.character.baseStats?.might, 13);
  assert.deepEqual(all.copies.map((c) => [c.stat, c.value, c.without, c.copied]), [['might', 14, 15, true], ['guard', 2, 0, true]]);
  assert.equal(copyLine(all.copies[0]!), 'Might: type 14, as the old sheet showed (it would read 15)');
  assert.ok(all.changed.some((line) => line.startsWith('Might is typed as 13, so that with what is added it reads 14')));

  const one = convertCharacterKind(old, system, 'beast', index, { copy: ['guard'] });
  assert.deepEqual(one.copies.map((c) => c.copied), [false, true]);
  const none = convertCharacterKind(old, system, 'beast', index, { copy: [] });
  const plain = deriveCharacter(none.character, system, index);
  assert.equal(plain.stats.get('might')?.value, 15, 'the typed 14 is kept as a typed value and the Beast adds to it');
  assert.equal(plain.stats.get('guard')?.value, 0);
  assert.ok(none.copies.every((c) => !c.copied));
});

test('the prompt says what happens and that nothing is written until Save', () => {
  const result = convertCharacterKind(wanderer(), system, 'beast', index);
  assert.deepEqual(conversionPrompt(result, ' Ash '), {
    title: 'Change to Beast?',
    lead: '“Ash” will be changed to Beast. What Beast does not record is not kept:',
    confirm: 'Change to Beast',
  });
  assert.match(CONVERSION_UNSAVED_NOTE, /does not change until you save/);
});

test('back again, a converted character keeps what both kinds read', () => {
  // Fails if a typed value is dropped on the way back: Might is a Wanderer's typed score too.
  const beast = convertCharacterKind(wanderer(), system, 'beast', index, { copy: [] }).character;
  const back = convertCharacterKind(beast, system, 'wanderer', index, { copy: [] }).character;
  assert.equal(back.kind, 'wanderer');
  assert.equal(back.baseStats?.might, 14);
  assert.equal(back.progress, 1);
  assert.deepEqual(back.freeform, { notes: 'Owes a debt.', aside: 'Kept by nothing.' });
});

test('unticking a copy or an addition leaves it offered and not made', () => {
  // Fails if the offer is read from the unticked conversion: the unticked Guard would vanish from the boxes.
  const result = convertUnticking(wanderer(), system, 'beast', index, { copies: ['guard'], additions: ['LUCK'] });
  assert.deepEqual(result.copies.map((c) => [c.stat, c.copied]), [['might', true], ['guard', false]]);
  assert.deepEqual(result.additions.map((a) => [a.elementId, a.added]), [['LUCK', false]]);
  assert.equal(result.character.additions, undefined);
  assert.equal(result.character.baseStats?.guard, undefined);
});
