/**
 * The two model additions Phase 1 forced, checked without naming a game.
 *
 * `baseStats` (ADR 0014) and a kind's `grants` / `elementIdPattern` both exist because
 * Aurora answers something in application code that Incudo has to answer in data. The tests
 * below use a made-up system, as everything in `core` does.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { baselineElementIds, resolveCharacterKind, type GameSystem } from './system.ts';

function element(id: string, type: string, rules: Rule[] = []): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function system(patch: (s: GameSystem) => void = () => {}): GameSystem {
  const value: GameSystem = {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }],
    stats: [
      { name: 'vigour', default: 10 },
      {
        name: 'vigour:modifier',
        derive: {
          kind: 'binary',
          op: '-',
          left: { kind: 'ref', stat: 'vigour' },
          right: { kind: 'number', value: 10 },
        },
      },
    ],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', min: 1, max: 5, stat: 'tier', elementIdPattern: 'ID_TIER_{n}' },
        elementTypes: ['Widget'],
        grants: ['ID_BASELINE'],
        buildSteps: [{ id: 'b', label: 'B', types: ['Widget'] }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
    ],
  };
  patch(value);
  return value;
}

// --- baseStats -------------------------------------------------------------

test('a base stat replaces the declared default', () => {
  const character = { ...createCharacter('test', 'hero'), baseStats: { vigour: 15 } };
  const derived = deriveCharacter(character, system(), new MapElementIndex());
  assert.equal(derived.stats.get('vigour')!.value, 15);
});

test('contributions add on top of a base stat — the whole reason it is not an override', () => {
  const index = new MapElementIndex();
  index.add(
    element('ID_KIN', 'Widget', [
      { kind: 'stat', key: 'stat-0', name: 'vigour', value: { kind: 'number', value: 2 } },
    ]),
  );
  const character = {
    ...createCharacter('test', 'hero'),
    baseStats: { vigour: 15 },
    choices: [{ ruleKey: 'build/kin', elementIds: ['ID_KIN'] }],
  };
  const derived = deriveCharacter(character, system(), index);
  assert.equal(derived.stats.get('vigour')!.value, 17, '15 bought, +2 from the kin');
  // An override would have produced 15 and quietly eaten the +2.
  assert.equal(derived.stats.get('vigour:modifier')!.value, 7);
});

test('a base stat is matched case-insensitively, like every other stat key', () => {
  const character = { ...createCharacter('test', 'hero'), baseStats: { Vigour: 12 } };
  const derived = deriveCharacter(character, system(), new MapElementIndex());
  assert.equal(derived.stats.get('vigour')!.value, 12);
});

test('an override still wins over everything, including a base stat', () => {
  const character = {
    ...createCharacter('test', 'hero'),
    baseStats: { vigour: 15 },
    overrides: { vigour: 3 },
  };
  const derived = deriveCharacter(character, system(), new MapElementIndex());
  assert.equal(derived.stats.get('vigour')!.value, 3);
});

// --- kind baselines --------------------------------------------------------

test('a kind grants its baseline and one element per step of progression', () => {
  const kind = resolveCharacterKind(system(), 'hero');
  assert.deepEqual(baselineElementIds(kind, 3), [
    'ID_BASELINE',
    'ID_TIER_1',
    'ID_TIER_2',
    'ID_TIER_3',
  ]);
});

test('the progression maximum caps the pattern, so a corrupt progress cannot run away', () => {
  const kind = resolveCharacterKind(system(), 'hero');
  assert.equal(baselineElementIds(kind, 1_000_000).length, 1 + 5);
});

test('a fractional progression produces no per-step elements — there is no ID_TIER_0.25', () => {
  const kind = resolveCharacterKind(
    system((s) => {
      s.characterKinds[0]!.progression = {
        kind: 'rating',
        stat: 'challenge',
        min: 0,
        elementIdPattern: 'ID_CR_{n}',
      };
    }),
    'hero',
  );
  assert.deepEqual(baselineElementIds(kind, 0.25), ['ID_BASELINE']);
});

test('a kind with no pattern and no grants has no baseline at all', () => {
  const kind = resolveCharacterKind(
    system((s) => {
      s.characterKinds[0]!.progression = { kind: 'none' };
      delete s.characterKinds[0]!.grants;
    }),
    'hero',
  );
  assert.deepEqual(baselineElementIds(kind, 3), []);
});

test('the baseline reaches the derivation, and grants expand from it', () => {
  const index = new MapElementIndex();
  index.addAll([
    element('ID_BASELINE', 'Widget', [{ kind: 'grant', key: 'grant-0', type: 'Widget', id: 'ID_FROM_BASELINE' }]),
    element('ID_FROM_BASELINE', 'Widget'),
    element('ID_TIER_1', 'Widget'),
    element('ID_TIER_2', 'Widget'),
  ]);
  const character = { ...createCharacter('test', 'hero'), progress: 2 };
  const derived = deriveCharacter(character, system(), index);

  for (const id of ['ID_BASELINE', 'ID_FROM_BASELINE', 'ID_TIER_1', 'ID_TIER_2']) {
    assert.ok(derived.elementIds.has(id), `${id} should be derived`);
  }
  assert.deepEqual(derived.problems, []);
});

test('a baseline the loaded content lacks warns; a chosen element it lacks is an error', () => {
  const character = {
    ...createCharacter('test', 'hero'),
    progress: 1,
    choices: [{ ruleKey: 'build/kin', elementIds: ['ID_GONE'] }],
  };
  const derived = deriveCharacter(character, system(), new MapElementIndex());

  const byId = new Map(derived.problems.map((p) => [p.elementId, p]));
  // The system definition describing content this profile has not loaded is the system's
  // problem, not the character's.
  assert.equal(byId.get('ID_BASELINE')!.level, 'warning');
  assert.equal(byId.get('ID_TIER_1')!.level, 'warning');
  // A choice that has vanished is the user's build broken.
  assert.equal(byId.get('ID_GONE')!.level, 'error');
});

test('a kind inherits its parent’s grants and can replace them', () => {
  const base = system((s) => {
    s.characterKinds.push({ id: 'sidekick', extends: 'hero' });
    s.characterKinds.push({ id: 'thrall', extends: 'hero', grants: ['ID_OTHER'] });
  });
  assert.deepEqual(resolveCharacterKind(base, 'sidekick').grants, ['ID_BASELINE']);
  assert.deepEqual(resolveCharacterKind(base, 'thrall').grants, ['ID_OTHER']);
});
