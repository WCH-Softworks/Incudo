/**
 * Every kind a system declares can be started, and each names its own progression — ADR 0057.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, type Element, type GameSystem } from '@incudo/core';
import {
  characterKindChoices,
  describeKindAndProgress,
  formatProgress,
  libraryEntryProgress,
  libraryEntryReferences,
  newCharacterOfKind,
} from './character-kinds.ts';
import { CharacterBuilder } from './use-character-builder.ts';

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [],
  stats: [{ name: 'tier', label: 'Tier', default: 0 }],
  characterKinds: [
    {
      id: 'beast',
      name: 'Beast',
      description: 'A creature.',
      progression: { kind: 'rating', stat: 'tier', min: 0, max: 30 },
      buildSteps: [],
      sheet: { sections: [] },
    },
    {
      id: 'hero',
      name: 'Hero',
      default: true,
      progression: { kind: 'level', min: 1, max: 20 },
      buildSteps: [],
      sheet: { sections: [] },
    },
    { id: 'elder', name: 'Elder Beast', extends: 'beast' },
    { id: 'drifter', name: 'Drifter', progression: { kind: 'none' }, buildSteps: [], sheet: { sections: [] } },
  ],
};

test('every declared kind is offered, the default first and the rest as declared', () => {
  // Fails if the list is only the default kind, which is all the app could start before.
  assert.deepEqual(
    characterKindChoices(system).map((k) => k.id),
    ['hero', 'beast', 'elder', 'drifter'],
  );
});

test("a progression is named by the kind's stat label, inherited along extends, and by nothing for none", () => {
  const byId = new Map(characterKindChoices(system).map((k) => [k.id, k]));
  assert.equal(byId.get('beast')?.progressLabel, 'Tier');
  assert.equal(byId.get('elder')?.progressLabel, 'Tier');
  assert.equal(byId.get('elder')?.description, 'A creature.');
  // No stat declared for a level progression: its stat's own name.
  assert.equal(byId.get('hero')?.progressLabel, 'level');
  assert.equal(byId.get('drifter')?.progressLabel, undefined);
});

test('a new character starts at its own kind and its own progression', () => {
  const beast = newCharacterOfKind(system, 'elder');
  assert.equal(beast.kind, 'elder');
  assert.equal(beast.progress, 0);
  assert.equal(newCharacterOfKind(system, 'hero').progress, 1);
  assert.throws(() => newCharacterOfKind(system, 'nobody'));
});

test('a progression is written as a person writes it', () => {
  assert.equal(formatProgress(3), '3');
  assert.equal(formatProgress(0.125), '1/8');
  assert.equal(formatProgress(0.25), '1/4');
  assert.equal(formatProgress(0.5), '1/2');
  assert.equal(formatProgress(0.3), '0.3');
});

test('a card says the kind by name and the progression by its label', () => {
  assert.equal(describeKindAndProgress(system, 'beast', 0.25), 'Beast · Tier 1/4');
  assert.equal(describeKindAndProgress(system, 'drifter', 0), 'Drifter');
  // A kind this system does not declare is named by its id, never dropped.
  assert.equal(describeKindAndProgress(system, 'ghost', 2), 'ghost · 2');
  assert.equal(describeKindAndProgress(system, undefined, undefined), '');
});

// --- a rating a creature prints (ADR 0060) ---------------------------------

const printing: GameSystem = {
  ...system,
  elementTypes: [{ name: 'Creature' }],
  characterKinds: [
    {
      ...system.characterKinds[0]!,
      elementTypes: ['Creature'],
      setterStats: [{ types: ['Creature'], setter: 'tier', stat: 'tier' }],
      buildSteps: [{ id: 'creature', label: 'Creature', types: ['Creature'], required: true }],
    },
    ...system.characterKinds.slice(1),
  ],
};

function creature(id: string, tier: string): Element {
  return { id, type: 'Creature', name: id, source: 'test', setters: { tier: { value: tier } }, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

test('a kind a creature prints for starts recording nothing; every other kind records its start', () => {
  // Fails if `newCharacterOfKind` writes the progression's start for it (the creature's print could never apply).
  const beast = newCharacterOfKind(printing, 'beast');
  assert.equal(beast.progress, undefined);
  assert.equal(beast.formatVersion, 3);
  // `extends` carries the declaration.
  assert.equal(newCharacterOfKind(printing, 'elder').progress, undefined);
  assert.equal(newCharacterOfKind(printing, 'hero').progress, 1);
  assert.equal(newCharacterOfKind(printing, 'hero').formatVersion, 2);
});

test("a card for a character that records no rating reads its creature's", () => {
  // Fails if the card reads only what is recorded (it says the kind and no rating at all).
  const entry = { kind: 'beast', chosen: [creature('WOLF', '1/4')] };
  assert.equal(libraryEntryProgress(printing, entry), 0.25);
  assert.equal(describeKindAndProgress(printing, 'beast', libraryEntryProgress(printing, entry)), 'Beast · Tier 1/4');
  assert.equal(libraryEntryProgress(printing, { ...entry, progress: 3 }), 3, 'a recorded rating wins');
  assert.equal(libraryEntryProgress(printing, { kind: 'beast' }), 0, 'with no creature, where the progression starts');
  assert.equal(libraryEntryProgress(printing, { kind: 'drifter' }), undefined);
});

test("the builder shows the creature's rating until one is typed, and clearing it goes back", () => {
  // Fails if `setProgress(undefined)` is ignored for a printing kind, or honoured for one that always records.
  const index = new MapElementIndex();
  index.addAll([creature('OX', '5')]);
  const b = new CharacterBuilder(newCharacterOfKind(printing, 'beast'), printing, index);
  assert.deepEqual(b.getState().progress, { value: 0, recorded: false, printed: undefined, printable: true });
  b.choose('build/creature', ['OX']);
  assert.deepEqual(b.getState().progress, { value: 5, recorded: false, printed: 5, printable: true });
  b.setProgress(2);
  assert.deepEqual(b.getState().progress, { value: 2, recorded: true, printed: 5, printable: true });
  assert.equal(b.getState().derived.stats.get('tier')?.value, 2);
  b.setProgress(undefined);
  assert.deepEqual(b.getState().progress, { value: 5, recorded: false, printed: 5, printable: true });
  assert.equal(b.getState().character.progress, undefined, 'the print is not copied into the character');

  const hero = new CharacterBuilder(newCharacterOfKind(printing, 'hero'), printing, index);
  hero.setProgress(4);
  hero.setProgress(undefined);
  assert.equal(hero.getState().character.progress, 4, 'a kind nothing prints for keeps what was typed');
});

test("a library card names what a character keeps, under its kind's label, and counts past three — ADR 0070", () => {
  // Fails if the kind's label is not read (or not inherited along extends), if an unknown kind loses the line rather
  // than taking the default label, if the list is not cut at three with the rest counted, or if a character keeping
  // nothing gets a line.
  const keeping: GameSystem = structuredClone(system);
  keeping.characterKinds[0]!.references = { types: ['Note'], label: 'Lore' };
  const named = (...names: string[]) => names.map((name) => ({ name }));
  assert.equal(libraryEntryReferences(keeping, { kind: 'beast', references: named('Kraken') }), 'Lore: Kraken');
  assert.equal(libraryEntryReferences(keeping, { kind: 'elder', references: named('Kraken', 'Rat') }), 'Lore: Kraken and Rat');
  assert.equal(libraryEntryReferences(keeping, { kind: 'beast', references: named('A', 'B', 'C') }), 'Lore: A, B and C');
  assert.equal(libraryEntryReferences(keeping, { kind: 'beast', references: named('A', 'B', 'C', 'D', 'E') }), 'Lore: A, B, C and 2 more');
  assert.equal(libraryEntryReferences(keeping, { kind: 'hero', references: named('Kraken') }), 'For reference: Kraken');
  assert.equal(libraryEntryReferences(keeping, { kind: 'ghost', references: named('Kraken') }), 'For reference: Kraken');
  assert.equal(libraryEntryReferences(keeping, { kind: 'beast' }), undefined);
  assert.equal(libraryEntryReferences(keeping, { kind: 'beast', references: [] }), undefined);
});
