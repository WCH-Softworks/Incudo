/**
 * One thing printed in two books — ADR 0125.
 *
 * The fixture has no game in it: a hero who learns Tricks (a type identified by name) through a pool of two, and holds
 * Quirks (a type that is not). "Spark" is printed in the Old Book and the New Book, and the New Book prints "Echo" twice
 * on purpose, as content prints a feat five times so it can be taken five times. Each test names the change that fails
 * it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { HeldPrintings, isOtherPrinting, printingKey, printingTypes } from './printings.ts';
import type { GameSystem } from './system.ts';

function element(id: string, type: string, name: string, source: string, rules: Rule[] = []): Element {
  return { id, type, name, source, setters: {}, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test System',
  version: '1.0.0',
  elementTypes: [{ name: 'Role' }, { name: 'Trick', identifiedByName: true }, { name: 'Quirk' }],
  stats: [{ name: 'level', default: 0 }],
  characterKinds: [
    {
      id: 'hero',
      name: 'Hero',
      default: true,
      progression: { kind: 'level', min: 1, max: 20 },
      elementTypes: ['Role', 'Trick', 'Quirk'],
      repeatableSetter: 'again',
      buildSteps: [],
      sheet: { sections: [] },
    },
  ],
};

const tricks: Rule = { kind: 'select', key: 'select:Tricks', type: 'Trick', name: 'Tricks', number: 2 };
const quirk: Rule = { kind: 'select', key: 'select:Quirk', type: 'Quirk', name: 'Quirk', number: 1 };

const index = new MapElementIndex();
index.addAll([
  element('ROLE', 'Role', 'Role', 'Old Book', [tricks, quirk]),
  element('GIFTED', 'Role', 'Gifted', 'Old Book', [tricks, { kind: 'grant', key: 'g', type: 'Trick', id: 'SPARK_OLD' }]),
  element('SPARK_OLD', 'Trick', 'Spark', 'Old Book'),
  element('SPARK_NEW', 'Trick', ' spark ', 'New Book'),
  element('ECHO_1', 'Trick', 'Echo', 'New Book'),
  element('ECHO_2', 'Trick', 'Echo', 'New Book'),
  element('GLOW', 'Trick', 'Glow', 'Old Book'),
  element('AGILE_DEER', 'Quirk', 'Agile', 'Old Book'),
  element('AGILE_RAT', 'Quirk', 'Agile', 'New Book'),
]);

function hero(role: string, picks: string[], quirks: string[] = []): Character {
  const character = { ...createCharacter('test', 'hero'), progress: 1 };
  character.choices = [
    { ruleKey: 'build/role', elementIds: [role] },
    ...(picks.length ? [{ ruleKey: `${role}/select:Tricks`, elementIds: picks }] : []),
    ...(quirks.length ? [{ ruleKey: `${role}/select:Quirk`, elementIds: quirks }] : []),
  ];
  return character;
}

const types = printingTypes(system);
const get = (id: string): Element => index.get(id)!;

test('a name repeated in another book is one thing; in the same book, or of another type, it is two', () => {
  // Fails if the key ignores the type, keeps case or space, or if the same book counts as a reprint.
  assert.equal(printingKey(get('SPARK_OLD'), types), printingKey(get('SPARK_NEW'), types));
  assert.ok(isOtherPrinting(get('SPARK_OLD'), get('SPARK_NEW'), types));
  assert.ok(!isOtherPrinting(get('ECHO_1'), get('ECHO_2'), types));
  assert.ok(!isOtherPrinting(get('SPARK_OLD'), get('SPARK_OLD'), types));
  assert.ok(!isOtherPrinting(get('AGILE_DEER'), get('AGILE_RAT'), types));
  assert.equal(printingKey(get('AGILE_DEER'), types), undefined);
});

test('both printings are offered until one is taken, and then the other is not', () => {
  // Fails if the pool stops offering the printings before either is held, or keeps offering the second.
  const fresh = deriveCharacter(hero('ROLE', []), system, index).pendingChoices.find((c) => c.label === 'Tricks')!;
  assert.ok(fresh.candidates.includes('SPARK_OLD') && fresh.candidates.includes('SPARK_NEW'));

  const one = deriveCharacter(hero('ROLE', ['SPARK_OLD']), system, index).pendingChoices.find((c) => c.label === 'Tricks')!;
  assert.ok(!one.candidates.includes('SPARK_NEW'));
  // Its own pick's slot may still change book.
  assert.deepEqual(one.otherPrintings, ['SPARK_NEW']);
  // A name the same book repeats is still offered after one copy is taken.
  const echo = deriveCharacter(hero('ROLE', ['ECHO_1']), system, index).pendingChoices.find((c) => c.label === 'Tricks')!;
  assert.ok(echo.candidates.includes('ECHO_2'));
  assert.deepEqual(echo.otherPrintings, []);
});

test('a full pool offers its slot the other printing of its own answer, and nothing else of it', () => {
  // Fails if a settled pool's change list drops the other printing for every slot, or offers it to the pool.
  const full = deriveCharacter(hero('ROLE', ['SPARK_NEW', 'GLOW']), system, index).answeredChoices.find((c) => c.label === 'Tricks')!;
  assert.ok(!full.candidates.includes('SPARK_OLD'));
  assert.deepEqual(full.otherPrintings, ['SPARK_OLD']);
});

test('a printing held from elsewhere keeps the other out of a pool altogether', () => {
  // Fails if a printing granted by something else is treated as the pool's own, offered to a slot to change to.
  const derived = deriveCharacter(hero('GIFTED', []), system, index);
  const pool = derived.pendingChoices.find((c) => c.label === 'Tricks')!;
  assert.ok(!pool.candidates.includes('SPARK_NEW'));
  assert.deepEqual(pool.otherPrintings, []);
});

test('a type the system does not identify by name is offered whatever is held', () => {
  // Fails if every type is identified by name: the deer's Agile and the rat's are two traits.
  const derived = deriveCharacter(hero('ROLE', [], ['AGILE_DEER']), system, index);
  const tricksPool = derived.pendingChoices.find((c) => c.label === 'Tricks')!;
  assert.ok(tricksPool.candidates.length > 0);
  const quirks = deriveCharacter(hero('ROLE', []), system, index).pendingChoices.find((c) => c.label === 'Quirk')!;
  assert.ok(quirks.candidates.includes('AGILE_DEER') && quirks.candidates.includes('AGILE_RAT'));
});

test('a character holding both is warned, and both stay held', () => {
  // Fails if the derivation drops one printing, or says nothing.
  const derived = deriveCharacter(hero('GIFTED', ['SPARK_NEW']), system, index);
  assert.ok(derived.elementIds.has('SPARK_OLD') && derived.elementIds.has('SPARK_NEW'));
  const warned = derived.problems.filter((problem) => problem.code === 'printing-twice');
  assert.equal(warned.length, 1);
  assert.equal(warned[0]!.level, 'warning');
  assert.match(warned[0]!.message, /^spark is held twice, from (Old Book and New Book|New Book and Old Book)\./i);
  // The same book twice is not a reprint.
  const echoes = deriveCharacter(hero('ROLE', ['ECHO_1', 'ECHO_2']), system, index);
  assert.ok(!echoes.problems.some((problem) => problem.code === 'printing-twice'));
});

test('what the kind lets be taken again is offered again and not warned', () => {
  // Fails if the repeatable setter is ignored for printings.
  const repeatable = new MapElementIndex();
  repeatable.addAll([...index.all()].map((e) => (e.type === 'Trick' ? { ...e, setters: { again: { value: 'true' } } } : e)));
  const derived = deriveCharacter(hero('GIFTED', ['SPARK_NEW']), system, repeatable);
  assert.ok(!derived.problems.some((problem) => problem.code === 'printing-twice'));
  const open = deriveCharacter(hero('ROLE', ['SPARK_OLD']), system, repeatable).pendingChoices.find((c) => c.label === 'Tricks')!;
  assert.ok(open.candidates.includes('SPARK_NEW'));
});

test('a system that identifies no type changes nothing', () => {
  // Fails if printings are read without the system saying which types.
  const plain: GameSystem = { ...system, elementTypes: system.elementTypes.map(({ name }) => ({ name })) };
  const open = deriveCharacter(hero('ROLE', ['SPARK_OLD']), plain, index).pendingChoices.find((c) => c.label === 'Tricks')!;
  assert.ok(open.candidates.includes('SPARK_NEW'));
  assert.equal(new HeldPrintings([get('SPARK_OLD'), get('SPARK_NEW')], printingTypes(plain)).heldTwice().length, 0);
});

