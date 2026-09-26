/**
 * Features a user writes for one character — ADR 0063.
 *
 * The fixture has no game in it: a keeper holds an Ox that prints its "guard" and states its "beast:stride" by a
 * rule, and a Charm that adds to both. A feature the keeper's user wrote adds to or sets them. Each test names the
 * change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import {
  createCharacter,
  newCustomFeatureId,
  removeCustomFeature,
  setCustomFeature,
  type Character,
  type CustomFeature,
} from './character.ts';
import { customFeatureElementId, customFeatureStats } from './custom-features.ts';
import { MapElementIndex, type Element, type Rule, type Setter } from './model.ts';
import { resolveCharacterKind, type CustomFeaturesDef, type GameSystem, type StatDef } from './system.ts';

function element(id: string, type: string, rules: Rule[] = [], setters: Record<string, string> = {}): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const stat = (name: string, value: number): Rule => ({ kind: 'stat', key: `${name}:${value}`, name, value: { kind: 'number', value } });

const STATS: StatDef[] = [
  { name: 'rank', label: 'Rank', default: 0 },
  { name: 'guard', label: 'Guard', default: 10 },
  { name: 'stride', label: 'Stride', default: 0, startsFrom: 'beast:stride' },
  { name: 'wit', label: 'Wit', derive: { kind: 'ref', stat: 'guard' } },
  { name: 'hidden', default: 0 },
  { name: 'epithet', label: 'Epithet', default: 'none' },
];

function system(customFeatures: CustomFeaturesDef | null = { type: 'Knack' }): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Charm' }, { name: 'Knack' }],
    stats: STATS,
    characterKinds: [
      {
        id: 'keeper',
        name: 'Keeper',
        default: true,
        progression: { kind: 'rating', stat: 'rank', min: 0, max: 10 },
        elementTypes: ['Beast', 'Charm', 'Knack'],
        setterStats: [{ types: ['Beast'], setter: 'guard', stat: 'guard' }],
        customFeatures: customFeatures ?? undefined,
        buildSteps: [],
        // What a feature may name is what the sheet shows: not `hidden`, which is declared and not shown.
        sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['rank', 'guard', 'stride', 'wit', 'epithet'] }] },
      },
    ],
  };
}

const ox = element('OX', 'Beast', [stat('beast:stride', 40)], { guard: '15' });
const charm = element('CHARM', 'Charm', [stat('guard', 2), stat('stride', 10)]);
const index = new MapElementIndex();
for (const e of [ox, charm]) index.add(e);

function keeper(features: CustomFeature[], baseStats?: Record<string, number>): Character {
  let character = createCharacter('test', 'keeper', { progress: 0 });
  character.choices = [
    { ruleKey: 'build/beast', elementIds: ['OX'] },
    { ruleKey: 'build/charm', elementIds: ['CHARM'] },
  ];
  if (baseStats) character.baseStats = baseStats;
  for (const feature of features) character = setCustomFeature(character, feature);
  return character;
}

const feature = (id: string, name: string, stats: CustomFeature['stats']): CustomFeature => ({ id, name, stats });
const value = (derived: ReturnType<typeof deriveCharacter>, name: string) => derived.stats.get(name)?.value;
const codes = (derived: ReturnType<typeof deriveCharacter>) => derived.problems.map((p) => p.code);

test('a feature is held as an element of the kind\'s type, and its add lines add like content', () => {
  // Fails if the feature is not seeded (not held, stride reads 50) or its add lines are not its rules.
  const derived = deriveCharacter(keeper([feature('a', 'Fleet', [{ stat: 'stride', mode: 'add', value: 5 }])]), system(), index);
  const held = derived.elements.find((e) => e.id === customFeatureElementId('a'));
  assert.equal(held?.type, 'Knack');
  assert.equal(held?.name, 'Fleet');
  assert.equal(value(derived, 'stride'), 55);
});

test('a set replaces what the creature states and what it prints, and content still adds to it', () => {
  // Fails if the sets are not applied (stride 50, guard 17), if `startsFrom` is applied over one (stride 110), or if
  // the start does not say which feature set it.
  const godspeed = feature('g', 'Godspeed', [
    { stat: 'stride', mode: 'set', value: 60 },
    { stat: 'guard', mode: 'set', value: 20 },
  ]);
  const derived = deriveCharacter(keeper([godspeed]), system(), index);
  assert.equal(value(derived, 'stride'), 70);
  assert.equal(value(derived, 'guard'), 22);
  assert.deepEqual(derived.starts.get('stride'), {
    stat: 'stride',
    value: 60,
    from: customFeatureElementId('g'),
    replaced: false,
    feature: 'Godspeed',
  });
  assert.deepEqual(codes(derived), []);
});

test('a typed value replaces a set, and the derivation says so', () => {
  // Fails if the base is added to the set (stride 110) or replaces it in silence (no problem).
  const godspeed = feature('g', 'Godspeed', [{ stat: 'stride', mode: 'set', value: 60 }]);
  const derived = deriveCharacter(keeper([godspeed], { stride: 40 }), system(), index);
  assert.equal(value(derived, 'stride'), 50);
  assert.equal(derived.starts.get('stride')?.replaced, true);
  const replaced = derived.problems.filter((p) => p.code === 'custom-feature-replaced');
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0]!.elementId, customFeatureElementId('g'));
  assert.match(replaced[0]!.message, /Godspeed sets Stride to 60, and the 40 entered for it replaces that/);
  // A typed value over a creature's print is not a conflict anyone wrote twice.
  const plain = deriveCharacter(keeper([], { guard: 12 }), system(), index);
  assert.deepEqual(codes(plain), []);
});

test('two features setting one stat: the first is used and the second reported', () => {
  // Fails if the later one wins (stride 90) or the conflict is silent.
  const derived = deriveCharacter(
    keeper([
      feature('a', 'Godspeed', [{ stat: 'stride', mode: 'set', value: 60 }]),
      feature('b', 'Leaden', [{ stat: 'stride', mode: 'set', value: 80 }]),
    ]),
    system(),
    index,
  );
  assert.equal(value(derived, 'stride'), 70);
  const conflict = derived.problems.find((p) => p.code === 'custom-feature-conflict');
  assert.match(conflict!.message, /Leaden sets Stride, and so does Godspeed/);
});

test('a line naming a stat the kind does not offer, or setting one that derives, does nothing and is reported', () => {
  // Fails if a derived stat may be set (wit reads 60 + guard), a stat the sheet does not show or a text stat may be
  // named, or the progression's own stat may be set.
  const derived = deriveCharacter(
    keeper([
      feature('a', 'Odd', [
        { stat: 'wit', mode: 'set', value: 60 },
        { stat: 'wit', mode: 'add', value: 1 },
        { stat: 'hidden', mode: 'add', value: 3 },
        { stat: 'rank', mode: 'set', value: 9 },
        { stat: 'nothing', mode: 'add', value: 1 },
      ]),
    ]),
    system(),
    index,
  );
  assert.equal(value(derived, 'wit'), 18, 'the guard it derives from, plus the one line that may add');
  assert.equal(value(derived, 'hidden'), 0);
  assert.equal(value(derived, 'rank'), 0);
  assert.equal(derived.problems.filter((p) => p.code === 'custom-feature-stat').length, 4);
  assert.deepEqual(
    customFeatureStats(resolveCharacterKind(system(), 'keeper')).map((s) => [s.stat, s.group, s.settable]),
    [
      ['guard', 'Numbers', true],
      ['stride', 'Numbers', true],
      ['wit', 'Numbers', false],
    ],
  );
});

test('two stats sharing a label are told apart by their sheet section, in the picker and in what is reported', () => {
  // Fails if `fullLabel` is the bare label (the ability and its save would both read "Guard"), or if the engine's
  // sentence names the stat by its declared label alone.
  const shared = system();
  shared.stats = [...STATS, { name: 'guard:save', label: 'Guard', derive: { kind: 'ref', stat: 'guard' } }];
  shared.characterKinds[0]!.sheet = {
    sections: [
      { id: 'numbers', label: 'Numbers', stats: ['guard', 'stride'] },
      { id: 'saves', label: 'Saves', stats: ['guard:save'] },
    ],
  };
  assert.deepEqual(
    customFeatureStats(resolveCharacterKind(shared, 'keeper')).map((s) => s.fullLabel),
    ['Guard (Numbers)', 'Stride', 'Guard (Saves)'],
  );
  const derived = deriveCharacter(keeper([feature('a', 'Odd', [{ stat: 'guard:save', mode: 'set', value: 3 }])]), shared, index);
  assert.match(derived.problems.find((p) => p.code === 'custom-feature-stat')!.message, /Odd sets Guard \(Saves\), which is worked out/);
});

test('a kind that carries no custom features holds none, and says why', () => {
  // Fails if a feature is held regardless of the kind (stride 65).
  const derived = deriveCharacter(keeper([feature('a', 'Fleet', [{ stat: 'stride', mode: 'add', value: 15 }])]), system(null), index);
  assert.equal(value(derived, 'stride'), 50);
  assert.equal(derived.elementIds.has(customFeatureElementId('a')), false);
  assert.deepEqual(codes(derived), ['custom-feature-stat']);
  assert.deepEqual(customFeatureStats(resolveCharacterKind(system(null), 'keeper')), []);
});

test('recording a feature raises the character to format 4, and nothing lowers it', () => {
  // Fails if a feature is written at 2 or 3, where a reader would drop it without a word.
  const plain = createCharacter('test', 'keeper');
  assert.equal(plain.formatVersion, 2);
  const one = setCustomFeature(plain, feature(newCustomFeatureId(plain), 'Fleet', []));
  assert.equal(one.formatVersion, 4);
  const renamed = setCustomFeature(one, { ...one.customFeatures![0]!, name: 'Fleeter' });
  assert.equal(renamed.customFeatures!.length, 1, 'replaced by id, not added');
  assert.equal(renamed.customFeatures![0]!.name, 'Fleeter');
  const none = removeCustomFeature(renamed, renamed.customFeatures![0]!.id);
  assert.equal(none.customFeatures, undefined);
  assert.equal(none.formatVersion, 4);
});

test('a description is shown as the user wrote it, never as markup', () => {
  // Fails if the text is passed through as HTML.
  const derived = deriveCharacter(
    keeper([{ id: 'a', name: 'Fleet', description: 'Runs <fast> & far.\n\nAlways.', stats: [] }]),
    system(),
    index,
  );
  const held = derived.elements.find((e) => e.id === customFeatureElementId('a'));
  assert.equal(held?.description, '<p>Runs &lt;fast&gt; &amp; far.</p><p>Always.</p>');
});
