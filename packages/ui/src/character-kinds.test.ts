/**
 * Every kind a system declares can be started, and each names its own progression — ADR 0057.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GameSystem } from '@incudo/core';
import {
  characterKindChoices,
  describeKindAndProgress,
  formatProgress,
  newCharacterOfKind,
} from './character-kinds.ts';

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
