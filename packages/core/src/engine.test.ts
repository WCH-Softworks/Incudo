import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import type { GameSystem, TrackStatDef } from './system.ts';
import { evaluateExpr, type StatExpr } from './expression.ts';

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

// --- tables and track stats (ADR 0018) --------------------------------------

/** Two tracks, one of which grants a marker the kind keys a contribution off. */
function markedIndex(): MapElementIndex {
  return indexWith(
    element('Alpha', 'Widget', [{ kind: 'grant', key: 'g1', type: 'Gadget', id: 'MARK_WHOLE' }]),
    element('Beta', 'Widget', [{ kind: 'grant', key: 'g1', type: 'Gadget', id: 'MARK_HALF' }]),
    element('Gamma', 'Widget', []),
    element('MARK_WHOLE', 'Gadget'),
    element('MARK_HALF', 'Gadget'),
  );
}

const HALF_OF_TRACK: StatExpr = {
  kind: 'call',
  fn: 'floor',
  args: [
    {
      kind: 'binary',
      op: '/',
      left: { kind: 'ref', stat: 'track:progress' },
      right: { kind: 'number', value: 2 },
    },
  ],
};

function markedSystem(trackStats: TrackStatDef[]): GameSystem {
  const base = trackedSystem();
  base.characterKinds[0]!.trackStats = trackStats;
  return base;
}

function twoTracks(alpha: number, beta: number): Character {
  const character = createCharacter('test', 'levelled');
  character.progress = alpha + beta;
  character.advancement = [
    ...Array.from({ length: alpha }, (_, i) => ({ at: i + 1, elementId: 'Alpha' })),
    ...Array.from({ length: beta }, (_, i) => ({ at: alpha + i + 1, elementId: 'Beta' })),
  ];
  return character;
}

test('a table reads a declared row, and clamps rather than falling off either end', () => {
  const table: StatExpr = {
    kind: 'table',
    index: { kind: 'ref', stat: 'vigour' },
    values: [10, 20, 30],
  };
  const at = (vigour: number): number =>
    evaluateExpr(table, { statNumber: () => vigour, statString: () => undefined });

  assert.equal(at(0), 10);
  assert.equal(at(2), 30);
  assert.equal(at(1.9), 20, 'the index is floored');
  assert.equal(at(-4), 10, 'below the row reads its first entry');
  assert.equal(at(99), 30, 'above it reads its last');
});

test('a track contributes a stat computed from its own progression', () => {
  const system = markedSystem([
    { stat: 'reach', when: 'MARK_WHOLE', value: { kind: 'ref', stat: 'track:progress' } },
    { stat: 'reach', when: 'MARK_HALF', value: HALF_OF_TRACK },
  ]);
  // Alpha 5 whole plus Beta 7 halved and rounded down: 5 + 3.
  const derived = deriveCharacter(twoTracks(5, 7), system, markedIndex());
  assert.equal(derived.stats.get('reach')?.value, 8);
});

test('a track with no matching entry contributes nothing, which is how an exclusion is written', () => {
  const system = markedSystem([
    { stat: 'reach', when: 'MARK_WHOLE', value: { kind: 'ref', stat: 'track:progress' } },
  ]);
  const derived = deriveCharacter(twoTracks(5, 7), system, markedIndex());
  assert.equal(derived.stats.get('reach')?.value, 5, 'Beta is not mentioned, so Beta adds none');
});

test('one element reached from two tracks counts for both', () => {
  // The case that made the first-wins track map wrong for counting: both tracks grant the
  // same marker, and taking one of them halves the answer.
  const index = indexWith(
    element('Alpha', 'Widget', [{ kind: 'grant', key: 'g1', type: 'Gadget', id: 'MARK_WHOLE' }]),
    element('Beta', 'Widget', [{ kind: 'grant', key: 'g1', type: 'Gadget', id: 'MARK_WHOLE' }]),
    element('MARK_WHOLE', 'Gadget'),
  );
  const system = markedSystem([
    { stat: 'reach', when: 'MARK_WHOLE', value: { kind: 'ref', stat: 'track:progress' } },
  ]);
  assert.equal(deriveCharacter(twoTracks(5, 5), system, index).stats.get('reach')?.value, 10);
});

test('{name} in the stat makes it per-track rather than an aggregate', () => {
  const system = markedSystem([
    { stat: '{name}:marked', when: 'MARK_HALF', value: { kind: 'number', value: 1 } },
  ]);
  const derived = deriveCharacter(twoTracks(3, 4), system, markedIndex());
  assert.equal(derived.stats.get('beta:marked')?.value, 1);
  assert.equal(derived.stats.get('alpha:marked'), undefined, 'Alpha has no such marker');
});

test('an entry with no `when` contributes for every track', () => {
  const system = markedSystem([{ stat: 'tracks', value: { kind: 'number', value: 1 } }]);
  assert.equal(deriveCharacter(twoTracks(3, 4), system, markedIndex()).stats.get('tracks')?.value, 2);
});

test('track contributions land before derivations, so a table can index one', () => {
  const system = markedSystem([
    { stat: 'reach', when: 'MARK_HALF', value: HALF_OF_TRACK },
  ]);
  system.characterKinds[0]!.stats = [
    ...(system.characterKinds[0]!.stats ?? []),
    {
      name: 'span',
      derive: { kind: 'table', index: { kind: 'ref', stat: 'reach' }, values: [0, 7, 14, 21] },
    },
  ];
  // Beta 7 halved is 3, and row 3 of the table is 21.
  assert.equal(deriveCharacter(twoTracks(1, 7), system, markedIndex()).stats.get('span')?.value, 21);
});

test('a kind that declares no trackStats behaves exactly as it did', () => {
  const derived = deriveCharacter(twoTracks(3, 4), trackedSystem(), markedIndex());
  assert.equal(derived.stats.get('reach'), undefined);
  assert.equal(derived.stats.get('level:alpha')?.value, 3, 'ADR 0015 track stats still publish');
});

// --- recorded rolls (ADR 0019) ----------------------------------------------

function rolledSystem(): GameSystem {
  const base = trackedSystem();
  base.characterKinds[0]!.stats = [
    ...(base.characterKinds[0]!.stats ?? []),
    {
      name: 'stamina',
      default: 0,
      derive: { kind: 'rolls', pattern: 'stamina:step:{n}' },
    },
  ];
  return base;
}

function rolled(progress: number, rolls: Record<string, number>): Character {
  const character = createCharacter('test', 'levelled');
  character.progress = progress;
  character.rolls = rolls;
  return character;
}

test('a derivation reads the recorded rolls, which nothing used to', () => {
  const character = rolled(3, { 'stamina:step:1': 6, 'stamina:step:2': 4, 'stamina:step:3': 5 });
  const derived = deriveCharacter(character, rolledSystem(), indexWith());
  assert.equal(derived.stats.get('stamina')?.value, 15);
});

test('the sum is bounded by the progression, so dropping a level stops counting it', () => {
  // And the record itself is untouched: ADR 0007 says a recorded result never silently
  // disappears, so levelling back up finds the same numbers rather than rerolling.
  const rolls = { 'stamina:step:1': 6, 'stamina:step:2': 4, 'stamina:step:3': 5 };
  const character = rolled(2, rolls);
  const derived = deriveCharacter(character, rolledSystem(), indexWith());
  assert.equal(derived.stats.get('stamina')?.value, 10);
  assert.equal(character.rolls['stamina:step:3'], 5, 'still recorded');
});

test('a missing roll counts as nothing rather than breaking the derivation', () => {
  const character = rolled(3, { 'stamina:step:1': 6 });
  assert.equal(
    deriveCharacter(character, rolledSystem(), indexWith()).stats.get('stamina')?.value,
    6,
  );
});

test('contributions still add on top of a rolled derivation', () => {
  const index = indexWith(
    element('Tough', 'Widget', [
      { kind: 'stat', key: 's', name: 'stamina', value: { kind: 'number', value: 12 } },
    ]),
  );
  const character = rolled(1, { 'stamina:step:1': 6 });
  character.choices = [{ ruleKey: 'k', elementIds: ['Tough'] }];
  assert.equal(
    deriveCharacter(character, rolledSystem(), index).stats.get('stamina')?.value,
    18,
  );
});

test('a kind with no progression sums nothing, because there are no steps to sum over', () => {
  const noProgression = rolledSystem();
  noProgression.characterKinds[0]!.progression = { kind: 'none' };
  const character = rolled(3, { 'stamina:step:1': 6 });
  assert.equal(
    deriveCharacter(character, noProgression, indexWith()).stats.get('stamina')?.value,
    0,
  );
});

// --- select pools ----------------------------------------------------------

/**
 * Aurora writes a growing allowance as several same-named `<select>` rules, one per level
 * that widens it. They are one pool, and the engine used to read them as separate quotas —
 * which made every imported spellcaster report errors it had not earned.
 */
function pooledCaster(): Element {
  return element('CASTER', 'Widget', [
    { kind: 'select', key: 'select:Cantrip', type: 'Gadget', name: 'Cantrip', number: 2, level: 1 },
    { kind: 'select', key: 'select:Cantrip', type: 'Gadget', name: 'Cantrip', number: 1, level: 4 },
    { kind: 'select', key: 'select:Cantrip', type: 'Gadget', name: 'Cantrip', number: 1, level: 10 },
  ]);
}

function withCantrips(progress: number, ...chosen: string[]): Character {
  const character = { ...createCharacter('test', 'levelled'), progress };
  character.choices = [
    { ruleKey: 'seed', elementIds: ['CASTER'] },
    { ruleKey: 'CASTER/select:Cantrip', elementIds: chosen },
  ];
  return character;
}

const CANTRIPS = () =>
  indexWith(
    pooledCaster(),
    element('A', 'Gadget'),
    element('B', 'Gadget'),
    element('C', 'Gadget'),
    element('D', 'Gadget'),
    element('E', 'Gadget'),
  );

test('same-named selects on one element are one pool, and its allowance is their sum', () => {
  // 2 at level 1, 1 more at 4, 1 more at 10. A level 10 character owes four picks.
  const derived = deriveCharacter(withCantrips(10), system(), CANTRIPS());
  assert.equal(derived.pendingChoices.length, 1, 'one decision, not three');
  const [choice] = derived.pendingChoices;
  assert.equal(choice!.ruleKey, 'CASTER/select:Cantrip');
  assert.equal(choice!.number, 4);
  assert.equal(choice!.remaining, 4);
});

test('a pool that is full reports nothing — the bug every imported caster hit', () => {
  const derived = deriveCharacter(withCantrips(10, 'A', 'B', 'C', 'D'), system(), CANTRIPS());
  assert.deepEqual(derived.problems, []);
  assert.deepEqual(derived.pendingChoices, []);
});

test('over-selected fires on the pool, not on one rule of it', () => {
  const derived = deriveCharacter(withCantrips(10, 'A', 'B', 'C', 'D', 'E'), system(), CANTRIPS());
  const over = derived.problems.filter((p) => p.code === 'over-selected');
  assert.equal(over.length, 1);
  assert.match(over[0]!.message, /allows 4 choice\(s\) but 5 are recorded/);
});

test('only the rules a character has reached count toward the allowance', () => {
  // Level 4: the level 10 rule is gated off, so the pool is 3 and not 4.
  const derived = deriveCharacter(withCantrips(4), system(), CANTRIPS());
  assert.equal(derived.pendingChoices[0]!.number, 3);
});

test('a partly-filled pool reports the level of the rule the next pick lands in', () => {
  // Three picked fills the level 1 rule (2) and the level 4 rule (1); the next is level 10.
  const derived = deriveCharacter(withCantrips(10, 'A', 'B', 'C'), system(), CANTRIPS());
  const [choice] = derived.pendingChoices;
  assert.equal(choice!.remaining, 1);
  assert.equal(choice!.level, 10, 'ADR 0017: which level opened what is still outstanding');
});

test('a pool is optional only when every rule in it is', () => {
  const index = indexWith(
    element('CASTER', 'Widget', [
      { kind: 'select', key: 'select:P', type: 'Gadget', name: 'P', number: 1, level: 1 },
      { kind: 'select', key: 'select:P', type: 'Gadget', name: 'P', number: 1, level: 2, optional: true },
    ]),
    element('A', 'Gadget'),
  );
  const character = { ...createCharacter('test', 'levelled'), progress: 2 };
  character.choices = [{ ruleKey: 'seed', elementIds: ['CASTER'] }];
  assert.equal(deriveCharacter(character, system(), index).pendingChoices[0]!.optional, false);
});

test('a pool offers the candidates of every rule that still has room', () => {
  // The wizard's spellbook shape: the first rule accepts one kind of thing and the ones
  // that widen it later accept another, so no single rule's list covers what is left.
  const index = indexWith(
    element('CASTER', 'Widget', [
      { kind: 'select', key: 'select:P', type: 'Widget', name: 'P', number: 1, level: 1 },
      { kind: 'select', key: 'select:P', type: 'Gadget', name: 'P', number: 1, level: 2 },
    ]),
    element('W', 'Widget'),
    element('G', 'Gadget'),
  );
  const character = { ...createCharacter('test', 'levelled'), progress: 2 };
  character.choices = [{ ruleKey: 'seed', elementIds: ['CASTER'] }];

  const empty = deriveCharacter(character, system(), index).pendingChoices[0]!;
  assert.deepEqual([...empty.candidates].sort(), ['CASTER', 'G', 'W']);

  // One picked closes the first rule, so only the second's candidates remain.
  character.choices = [
    { ruleKey: 'seed', elementIds: ['CASTER'] },
    { ruleKey: 'CASTER/select:P', elementIds: ['W'] },
  ];
  const partial = deriveCharacter(character, system(), index).pendingChoices[0]!;
  assert.deepEqual([...partial.candidates].sort(), ['G']);
});
