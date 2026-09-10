import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import type { GameSystem } from './system.ts';

// A fixture with no game in it — see the note in system.test.ts.

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

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }, { name: 'Gadget' }],
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
        id: 'levelled',
        name: 'Levelled',
        default: true,
        progression: { kind: 'level', min: 1, max: 20 },
        elementTypes: ['Widget', 'Gadget'],
        buildSteps: [],
        sheet: { sections: [] },
      },
      {
        id: 'rated',
        name: 'Rated',
        progression: { kind: 'rating', stat: 'threat', min: 0, max: 30 },
        elementTypes: ['Widget'],
        stats: [{ name: 'threat', default: 0 }],
        buildSteps: [],
        sheet: { sections: [] },
      },
      {
        id: 'flat',
        name: 'Flat',
        progression: { kind: 'none' },
        elementTypes: ['Widget'],
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

function indexWith(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll(elements);
  return index;
}

test('the progression number is published as the stat the kind names', () => {
  const index = indexWith(element('W', 'Widget'));

  const levelled = { ...createCharacter('test', 'levelled'), progress: 7 };
  levelled.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];
  const a = deriveCharacter(levelled, system(), index);
  assert.equal(a.stats.get('level')?.value, 7);
  assert.equal(a.stats.get('threat'), undefined);

  const rated = { ...createCharacter('test', 'rated'), progress: 12 };
  rated.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];
  const b = deriveCharacter(rated, system(), index);
  assert.equal(b.stats.get('threat')?.value, 12);
  // "level" is not a thing this kind has. Nothing in the engine says otherwise.
  assert.equal(b.stats.get('level'), undefined);
});

test('a level gate compares against progress, whatever progress counts', () => {
  const index = indexWith(
    element('W', 'Widget', [
      { kind: 'stat', key: 'early', name: 'vigour', value: { kind: 'number', value: 1 } },
      {
        kind: 'stat',
        key: 'late',
        name: 'vigour',
        value: { kind: 'number', value: 100 },
        level: 5,
      },
    ]),
  );

  const low = { ...createCharacter('test', 'levelled'), progress: 1 };
  low.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];
  assert.equal(deriveCharacter(low, system(), index).stats.get('vigour')?.value, 11);

  const high = { ...low, progress: 5 };
  assert.equal(deriveCharacter(high, system(), index).stats.get('vigour')?.value, 111);

  // The same gate on a rating: CR 5 is past a level="5" gate, because the engine only
  // ever compares two numbers and never asks what they mean.
  const rated = { ...createCharacter('test', 'rated'), progress: 5 };
  rated.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];
  assert.equal(deriveCharacter(rated, system(), index).stats.get('vigour')?.value, 111);
});

test('a kind with no progression ignores level gates rather than failing them', () => {
  const index = indexWith(
    element('W', 'Widget', [
      { kind: 'stat', key: 'late', name: 'vigour', value: { kind: 'number', value: 5 }, level: 3 },
    ]),
  );
  const flat = createCharacter('test', 'flat');
  flat.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];

  const derived = deriveCharacter(flat, system(), index);
  assert.equal(derived.character.progress, 0);
  // 15, not 10: a level-less system cannot express "at level 3", so dropping the rule
  // would be a reading the content never asked for.
  assert.equal(derived.stats.get('vigour')?.value, 15);
});

test('grants expand to a fixed point, and derived stats see the result', () => {
  const index = indexWith(
    element('A', 'Widget', [{ kind: 'grant', key: 'g', type: 'Widget', id: 'B' }]),
    element('B', 'Widget', [
      { kind: 'grant', key: 'g', type: 'Widget', id: 'C' },
      { kind: 'stat', key: 's', name: 'vigour', value: { kind: 'number', value: 2 } },
    ]),
    element('C', 'Widget', [
      { kind: 'stat', key: 's', name: 'vigour', value: { kind: 'number', value: 4 } },
    ]),
  );
  const character = createCharacter('test', 'levelled');
  character.progress = 1;
  character.choices = [{ ruleKey: 'seed', elementIds: ['A'] }];

  const derived = deriveCharacter(character, system(), index);
  assert.deepEqual([...derived.elementIds].sort(), ['A', 'B', 'C']);
  assert.equal(derived.stats.get('vigour')?.value, 16);
  assert.equal(derived.stats.get('vigour:modifier')?.value, 6);
  assert.deepEqual(derived.problems, []);
});

test('bonuses sharing a bucket do not stack; the largest wins', () => {
  const index = indexWith(
    element('A', 'Widget', [
      { kind: 'stat', key: 'a', name: 'vigour', value: { kind: 'number', value: 2 }, bonus: 'ring' },
      { kind: 'stat', key: 'b', name: 'vigour', value: { kind: 'number', value: 5 }, bonus: 'ring' },
      { kind: 'stat', key: 'c', name: 'vigour', value: { kind: 'number', value: 1 } },
    ]),
  );
  const character = createCharacter('test', 'levelled');
  character.progress = 1;
  character.choices = [{ ruleKey: 'seed', elementIds: ['A'] }];

  assert.equal(deriveCharacter(character, system(), index).stats.get('vigour')?.value, 16);
});

test('the resolved kind travels with the derivation', () => {
  const character = createCharacter('test', 'rated');
  const derived = deriveCharacter(character, system(), indexWith());
  assert.equal(derived.kind.id, 'rated');
  assert.deepEqual(derived.kind.elementTypes, ['Widget']);
});

// --- stat bounds (ADR 0016) ------------------------------------------------

/** A system whose one stat is bounded, so the bound itself is what a test varies. */
function boundedSystem(max: GameSystem['stats'][number]['max']): GameSystem {
  const base = system();
  base.stats = [{ name: 'vigour', default: 10, max }];
  return base;
}

test('a bound applies to a contributed stat, which it never used to', () => {
  const index = indexWith(
    element('A', 'Widget', [
      { kind: 'stat', key: 'a', name: 'vigour', value: { kind: 'number', value: 40 } },
    ]),
  );
  const character = createCharacter('test', 'levelled');
  character.progress = 1;
  character.choices = [{ ruleKey: 'seed', elementIds: ['A'] }];

  // 10 + 40, capped at 20. Before ADR 0016 the clamp only ran for stats with a `derive`,
  // so this answered 50 and the declared maximum did nothing at all.
  assert.equal(deriveCharacter(character, boundedSystem(20), index).stats.get('vigour')?.value, 20);
});

test('a bound may be an expression, so content can raise it', () => {
  // The 5e shape: the system owns the 20, content contributes only the delta above it.
  const max: GameSystem['stats'][number]['max'] = {
    kind: 'binary',
    op: '+',
    left: { kind: 'number', value: 20 },
    right: { kind: 'ref', stat: 'vigour:max' },
  };
  const index = indexWith(
    element('A', 'Widget', [
      { kind: 'stat', key: 'a', name: 'vigour', value: { kind: 'number', value: 40 } },
    ]),
    element('TOME', 'Widget', [
      { kind: 'stat', key: 'b', name: 'vigour:max', value: { kind: 'number', value: 2 } },
    ]),
  );
  const character = createCharacter('test', 'levelled');
  character.progress = 1;

  character.choices = [{ ruleKey: 'seed', elementIds: ['A'] }];
  assert.equal(deriveCharacter(character, boundedSystem(max), index).stats.get('vigour')?.value, 20);

  character.choices = [{ ruleKey: 'seed', elementIds: ['A', 'TOME'] }];
  assert.equal(deriveCharacter(character, boundedSystem(max), index).stats.get('vigour')?.value, 22);
});

test('a bound still clamps a derived stat, and a plain number still means a number', () => {
  const base = system();
  base.stats = [
    { name: 'vigour', default: 10 },
    { name: 'vigour:doubled', min: 5, max: 15, derive: { kind: 'binary', op: '*', left: { kind: 'ref', stat: 'vigour' }, right: { kind: 'number', value: 2 } } },
  ];
  const character = createCharacter('test', 'levelled');
  character.progress = 1;

  assert.equal(deriveCharacter(character, base, indexWith()).stats.get('vigour:doubled')?.value, 15);
});

test('an override beats a bound, because a repair the engine clamps is not a repair', () => {
  const character = createCharacter('test', 'levelled');
  character.progress = 1;
  character.overrides = { vigour: 99 };

  assert.equal(deriveCharacter(character, boundedSystem(20), indexWith()).stats.get('vigour')?.value, 99);
});

test('baseStats are bounded too — a starting value above the cap is still capped', () => {
  const character = createCharacter('test', 'levelled');
  character.progress = 1;
  character.baseStats = { vigour: 30 };

  assert.equal(deriveCharacter(character, boundedSystem(20), indexWith()).stats.get('vigour')?.value, 20);
});

// --- advancement and tracks (ADR 0015) --------------------------------------

/**
 * Two tracks, each granting a feature gated on its own level. Nothing here is a class; the
 * engine cannot tell, which is the point.
 */
function trackedSystem(): GameSystem {
  const base = system();
  const pc = base.characterKinds[0]!;
  pc.progression = {
    kind: 'level',
    min: 1,
    max: 20,
    trackStatPattern: 'level:{name}',
  };
  return base;
}

function trackedIndex(): MapElementIndex {
  return indexWith(
    element('Alpha', 'Widget', [
      { kind: 'grant', key: 'g1', type: 'Gadget', id: 'ALPHA_EARLY', level: 2 },
      { kind: 'grant', key: 'g2', type: 'Gadget', id: 'ALPHA_LATE', level: 6 },
    ]),
    element('Beta', 'Widget', [
      { kind: 'grant', key: 'g1', type: 'Gadget', id: 'BETA_EARLY', level: 2 },
      { kind: 'grant', key: 'g2', type: 'Gadget', id: 'BETA_LATE', level: 6 },
    ]),
    element('ALPHA_EARLY', 'Gadget'),
    element('ALPHA_LATE', 'Gadget'),
    element('BETA_EARLY', 'Gadget'),
    element('BETA_LATE', 'Gadget'),
  );
}

test('a level gate reads its own track, not the character total', () => {
  const character = createCharacter('test', 'levelled');
  character.progress = 8;
  // Six points to Alpha, two to Beta. Alpha reaches its level 6 grant; Beta does not, even
  // though the character is level 8 — which is the whole bug ADR 0015 is about. Before
  // tracks, both fired.
  character.advancement = [
    { at: 1, elementId: 'Alpha' },
    { at: 2, elementId: 'Alpha' },
    { at: 3, elementId: 'Alpha' },
    { at: 4, elementId: 'Alpha' },
    { at: 5, elementId: 'Alpha' },
    { at: 6, elementId: 'Alpha' },
    { at: 7, elementId: 'Beta' },
    { at: 8, elementId: 'Beta' },
  ];

  const derived = deriveCharacter(character, trackedSystem(), trackedIndex());
  assert.equal(derived.elementIds.has('ALPHA_EARLY'), true);
  assert.equal(derived.elementIds.has('ALPHA_LATE'), true);
  assert.equal(derived.elementIds.has('BETA_EARLY'), true);
  assert.equal(derived.elementIds.has('BETA_LATE'), false);
});

test('each track publishes its own count as a stat', () => {
  const character = createCharacter('test', 'levelled');
  character.progress = 8;
  character.advancement = [
    ...Array.from({ length: 5 }, (_, i) => ({ at: i + 1, elementId: 'Alpha' })),
    ...Array.from({ length: 3 }, (_, i) => ({ at: i + 6, elementId: 'Beta' })),
  ];

  const derived = deriveCharacter(character, trackedSystem(), trackedIndex());
  assert.equal(derived.stats.get('level:alpha')?.value, 5);
  assert.equal(derived.stats.get('level:beta')?.value, 3);
  // The character's own progression number is still there and still the total.
  assert.equal(derived.stats.get('level')?.value, 8);
});

test('an advancement entry seeds the derivation, because no select chose it', () => {
  const character = createCharacter('test', 'levelled');
  character.progress = 2;
  character.advancement = [{ at: 1, elementId: 'Beta' }, { at: 2, elementId: 'Beta' }];

  // No choices at all — Beta is present only because progression was spent on it.
  const derived = deriveCharacter(character, trackedSystem(), trackedIndex());
  assert.equal(derived.elementIds.has('Beta'), true);
  assert.equal(derived.elementIds.has('BETA_EARLY'), true);
});

test('a character with no advancement gates on the total, exactly as before', () => {
  const character = createCharacter('test', 'levelled');
  character.progress = 8;
  character.choices = [{ ruleKey: 'seed', elementIds: ['Alpha'] }];

  const derived = deriveCharacter(character, trackedSystem(), trackedIndex());
  assert.equal(derived.elementIds.has('ALPHA_LATE'), true);
  assert.equal(derived.stats.get('level:alpha'), undefined);
});

test('a system that declares no trackStatPattern publishes no track stats', () => {
  const character = createCharacter('test', 'levelled');
  character.progress = 2;
  character.advancement = [{ at: 1, elementId: 'Alpha' }, { at: 2, elementId: 'Alpha' }];

  const derived = deriveCharacter(character, system(), trackedIndex());
  assert.equal(derived.stats.get('level:alpha'), undefined);
  assert.equal(derived.elementIds.has('ALPHA_EARLY'), true);
});

test('entries past the character progress do not count towards a track', () => {
  const character = createCharacter('test', 'levelled');
  character.progress = 2;
  // A character levelled back down keeps the record but not the levels.
  character.advancement = [
    { at: 1, elementId: 'Alpha' },
    { at: 2, elementId: 'Alpha' },
    { at: 3, elementId: 'Alpha' },
  ];

  assert.equal(
    deriveCharacter(character, trackedSystem(), trackedIndex()).stats.get('level:alpha')?.value,
    2,
  );
});

test('an element granted by two tracks reports the ambiguity, but only when a gate rides on it', () => {
  const index = indexWith(
    element('Alpha', 'Widget', [
      { kind: 'grant', key: 'g1', type: 'Gadget', id: 'SHARED_GATED' },
      { kind: 'grant', key: 'g2', type: 'Gadget', id: 'SHARED_PLAIN' },
    ]),
    element('Beta', 'Widget', [
      { kind: 'grant', key: 'g1', type: 'Gadget', id: 'SHARED_GATED' },
      { kind: 'grant', key: 'g2', type: 'Gadget', id: 'SHARED_PLAIN' },
    ]),
    element('SHARED_GATED', 'Gadget', [
      { kind: 'stat', key: 's', name: 'vigour', value: { kind: 'number', value: 1 }, level: 4 },
    ]),
    // A shared proficiency: no level gate, so it reads the same from either track and is
    // not worth a warning. Every multiclassed character has several.
    element('SHARED_PLAIN', 'Gadget', [
      { kind: 'stat', key: 's', name: 'vigour', value: { kind: 'number', value: 1 } },
    ]),
  );
  const character = createCharacter('test', 'levelled');
  character.progress = 2;
  character.advancement = [{ at: 1, elementId: 'Alpha' }, { at: 2, elementId: 'Beta' }];

  const ambiguous = deriveCharacter(character, trackedSystem(), index).problems.filter(
    (p) => p.code === 'ambiguous-track',
  );
  assert.deepEqual(ambiguous.map((p) => p.elementId), ['SHARED_GATED']);
});
