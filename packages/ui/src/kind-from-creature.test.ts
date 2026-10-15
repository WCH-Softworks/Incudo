/**
 * A kind built on a creature and levelled in a class of its own — ADR 0118's three format additions, with no game in
 * them: a kind's `available`, a level roll whose die is a stat and which starts after the first level, and a sheet
 * section whose dice are two stats. "Ward", "Beast" and "Calling" are this fixture's words.
 *
 * Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, type Element, type GameSystem, type Rule } from '@incudo/core';

import { characterKindChoices, kindUnavailable, newCharacterOfKind } from './character-kinds.ts';
import { CharacterBuilder } from './use-character-builder.ts';

const NOTE = 'A ward needs a calling, and none is loaded.';

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Beast' }, { name: 'Calling' }],
  stats: [{ name: 'level', label: 'Level', default: 1 }],
  characterKinds: [
    {
      id: 'ward',
      name: 'Ward',
      default: true,
      available: { types: ['Calling'], note: NOTE },
      progression: { kind: 'level', min: 1, max: 10, stat: 'level', trackStatPattern: 'level:{name}', trackType: 'Calling' },
      elementTypes: ['Beast', 'Calling'],
      stats: [
        { name: 'die', label: 'Die', default: 0 },
        { name: 'dice:printed', label: 'Printed Dice', default: 0 },
        {
          name: 'dice',
          label: 'Dice',
          derive: { kind: 'binary', op: '+', left: { kind: 'ref', stat: 'dice:printed' }, right: { kind: 'binary', op: '-', left: { kind: 'ref', stat: 'level' }, right: { kind: 'number', value: 1 } } },
        },
        { name: 'health', label: 'Health', default: 0, derive: { kind: 'rolls', pattern: 'health:{n}' } },
      ],
      setterStats: [
        { types: ['Beast'], setter: 'health', stat: 'die', read: 'dieSides' },
        { types: ['Beast'], setter: 'health', stat: 'dice:printed', read: 'diceCount' },
      ],
      buildSteps: [
        { id: 'beast', label: 'Beast', types: ['Beast'], required: true },
        { id: 'calling', label: 'Calling', types: ['Calling'], required: true },
        { id: 'levels', label: 'Levels', types: ['Calling'], perLevel: true, levelRoll: { pattern: 'health:{n}', dieStat: 'die', from: 2, classType: 'Calling' } },
      ],
      sheet: { sections: [{ id: 'calling', label: 'Calling', types: ['Calling'], trackProgress: true, trackDice: { count: 'dice', sides: 'die' } }] },
    },
  ],
};

function element(id: string, type: string, setters: Record<string, string> = {}, rules: Rule[] = []): Element {
  return {
    id,
    type,
    name: id.toLowerCase(),
    source: 'test',
    setters: Object.fromEntries(Object.entries(setters).map(([key, value]) => [key, { value }])),
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function indexOf(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  for (const e of elements) index.add(e);
  return index;
}

const beast = element('BEAST', 'Beast', { health: '9 (2d6 + 2)' });
const calling = element('CALLING', 'Calling');

test('a kind that needs a type no loaded element has says so, and one that is loaded does not', () => {
  // Fails if `available` is not carried through resolveCharacterKind, or is read from anything but the loaded index.
  const bare = indexOf(beast);
  const loaded = indexOf(beast, calling);
  assert.equal(characterKindChoices(system, bare)[0]!.unavailable, NOTE);
  assert.equal(characterKindChoices(system, loaded)[0]!.unavailable, undefined);
  assert.equal(characterKindChoices(system)[0]!.unavailable, undefined, 'not judged with nothing to judge by');
  assert.equal(new CharacterBuilder(newCharacterOfKind(system, 'ward'), system, bare).getState().unavailable, NOTE);
  assert.equal(new CharacterBuilder(newCharacterOfKind(system, 'ward'), system, loaded).getState().unavailable, undefined);
  assert.equal(kindUnavailable({ ...newBuilderKind(loaded), available: undefined }, bare), undefined);
});

function newBuilderKind(index: MapElementIndex) {
  return new CharacterBuilder(newCharacterOfKind(system, 'ward'), system, index).getState().kind;
}

test('a level roll may read its die from a stat and start after the first level', () => {
  // Fails if `from` is ignored (level 1 is offered and taken at the maximum), if `dieStat` is ignored (no die is known),
  // or if a level below `from` is read as the first.
  const b = new CharacterBuilder(newCharacterOfKind(system, 'ward'), system, indexOf(beast, calling));
  b.choose('build/beast', ['BEAST']);
  b.choose('build/calling', ['CALLING']);
  b.setProgress(3);
  let levels = b.getState().steps.find((step) => step.id === 'levels')!.hitPoints!;
  assert.deepEqual(levels.levels.map((l) => [l.level, l.dieSides, l.isFirst]), [[2, 6, false], [3, 6, false]]);
  b.recordHitPoints('levels', 2, 'average');
  levels = b.getState().steps.find((step) => step.id === 'levels')!.hitPoints!;
  assert.equal(levels.levels[0]!.recorded, 4, 'the average of the stat\'s die, not its maximum');
});

test('a sheet section may read a track root\'s dice from two stats', () => {
  // Fails if `trackDice` is not read (the calling is listed with no dice) or reads the setter's die instead.
  const b = new CharacterBuilder(newCharacterOfKind(system, 'ward'), system, indexOf(beast, calling));
  b.choose('build/beast', ['BEAST']);
  b.choose('build/calling', ['CALLING']);
  b.setProgress(3);
  const listed = b.getState().sheet.sections.flatMap((section) => section.elements).find((e) => e.elementId === 'CALLING');
  assert.deepEqual([listed?.progress, listed?.dice], [3, { count: 4, sides: 6 }]);
});
