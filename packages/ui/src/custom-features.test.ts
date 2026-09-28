/**
 * Features the user writes for a character, as the builder edits and shows them — ADR 0063.
 *
 * No game in the fixture: a keeper holds an Ox whose own rule states its "beast:stride" and which prints its
 * "guard"; the keeper's stride starts from the rule and its guard from the print. Each test names the change that
 * fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BundleElementIndex,
  collectCharacterContent,
  createCharacter,
  deriveCharacter,
  MapElementIndex,
  resolveCharacterKind,
  type Element,
  type GameSystem,
  type Rule,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { customLineOnStat, newCustomStatLine } from './custom-features.ts';

function element(id: string, type: string, setters: Record<string, string> = {}, rules: Rule[] = []): Element {
  const out: Element['setters'] = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

function system(customFeatures: boolean, types?: string[]): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Knack', plural: 'Knacks' }, { name: 'Deed', plural: 'Deeds' }],
    stats: [
      { name: 'stride', label: 'Stride', default: 0, startsFrom: 'beast:stride' },
      { name: 'guard', label: 'Guard', default: 10 },
      { name: 'wit', label: 'Wit', derive: { kind: 'ref', stat: 'guard' } },
    ],
    characterKinds: [
      {
        id: 'keeper',
        name: 'Keeper',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Beast', 'Knack', 'Deed'],
        setterStats: [{ types: ['Beast'], setter: 'guard', stat: 'guard' }],
        ...(customFeatures ? { customFeatures: { type: 'Knack', ...(types ? { types } : {}) } } : {}),
        buildSteps: [
          { id: 'beast', label: 'Beast', types: ['Beast'], required: true },
          {
            id: 'entry',
            label: 'Entry',
            types: [],
            required: true,
            budget: { stat: 'entry points', targets: ['stride'], methods: ['entry'] },
          },
        ],
        sheet: {
          sections: [
            { id: 'numbers', label: 'Numbers', stats: ['stride', 'guard', 'wit'] },
            { id: 'knacks', label: 'Knacks', types: ['Knack'] },
            { id: 'deeds', label: 'Deeds', types: ['Deed'] },
          ],
        },
      },
    ],
    generationMethods: [{ id: 'entry', label: 'Enter', min: 0 }],
  };
}

const index = new MapElementIndex();
index.addAll([element('OX', 'Beast', { guard: '15' }, [{ kind: 'stat', key: 's', name: 'beast:stride', value: { kind: 'number', value: 40 } }])]);

function onOx(custom = true, types?: string[]): CharacterBuilder {
  const b = new CharacterBuilder(createCharacter('test', 'keeper'), system(custom, types), index);
  b.choose('build/beast', ['OX']);
  return b;
}

test('a written feature is held, named, and changes what its lines say', () => {
  // Fails if `addCustomFeature` or `updateCustomFeature` does not write the character, or the state is not published.
  const b = onOx();
  assert.equal(b.getState().derived.stats.get('stride')?.value, 40);
  const id = b.addCustomFeature('Godspeed')!;
  b.updateCustomFeature(id, { description: 'Blessed by a god of roads.', stats: [{ stat: 'stride', mode: 'set', value: 60 }] });
  const state = b.getState();
  assert.equal(state.derived.stats.get('stride')?.value, 60);
  assert.equal(state.character.formatVersion, 4);
  assert.ok(state.derived.elements.some((e) => e.name === 'Godspeed' && e.type === 'Knack'));
  assert.deepEqual(state.customFeatures.features, [
    {
      id,
      elementId: `custom:${id}`,
      name: 'Godspeed',
      description: 'Blessed by a god of roads.',
      type: 'Knack',
      typeLabel: 'Knacks',
      lines: [{ stat: 'stride', mode: 'set', value: 60, label: 'Stride', status: 'applied' }],
    },
  ]);
  assert.deepEqual(
    state.customFeatures.stats.map((s) => [s.stat, s.settable]),
    [
      ['stride', true],
      ['guard', true],
      ['wit', false],
    ],
  );
  // The entry step's faded value is the feature's, so the DM sees what a typed value would replace.
  const row = state.steps.find((s) => s.id === 'entry')!.budget!.rows.find((r) => r.stat === 'stride')!;
  assert.equal(row.printed, 60);
});

test('a typed value replaces the feature, and both the line and the problems say so; clearing it gives it back', () => {
  // Fails if the line's status does not read the start's `replaced` (it says "applied" while the sheet shows 45),
  // or the derivation does not report it.
  const b = onOx();
  const id = b.addCustomFeature('Godspeed')!;
  b.updateCustomFeature(id, { stats: [{ stat: 'stride', mode: 'set', value: 60 }] });
  b.setBudgetStat('entry', 'stride', 45);
  let state = b.getState();
  assert.equal(state.derived.stats.get('stride')?.value, 45);
  const line = state.customFeatures.features[0]!.lines[0]!;
  assert.equal(line.status, 'replaced');
  assert.equal(line.note, 'The 45 entered for Stride replaces this. Clear that entry to use 60.');
  assert.ok(state.derived.problems.some((p) => p.code === 'custom-feature-replaced'));
  // Where the number is typed, too: the entry step's row names the feature it replaces.
  const rowOf = () => b.getState().steps.find((s) => s.id === 'entry')!.budget!.rows.find((r) => r.stat === 'stride')!;
  assert.equal(rowOf().featureNote, 'The 45 entered here replaces the 60 that Godspeed sets. Clear it to use Godspeed.');
  b.setBudgetStat('entry', 'stride', undefined);
  state = b.getState();
  assert.equal(state.derived.stats.get('stride')?.value, 60);
  assert.equal(state.customFeatures.features[0]!.lines[0]!.status, 'applied');
  assert.equal(rowOf().featureNote, 'Godspeed sets this to 60.');
  assert.equal(rowOf().printedBy, 'Godspeed');
});

test('a line another feature overrules, or that sets a worked-out stat, says why', () => {
  // Fails if the status of a set is not read from which feature the start came from.
  const b = onOx();
  const first = b.addCustomFeature('Godspeed')!;
  const second = b.addCustomFeature('Leaden')!;
  b.updateCustomFeature(first, { stats: [{ stat: 'stride', mode: 'set', value: 60 }] });
  b.updateCustomFeature(second, {
    stats: [
      { stat: 'stride', mode: 'set', value: 20 },
      { stat: 'wit', mode: 'set', value: 3 },
      { stat: 'wit', mode: 'add', value: 1 },
    ],
  });
  const lines = b.getState().customFeatures.features[1]!.lines;
  assert.deepEqual(
    lines.map((l) => [l.status, l.note]),
    [
      ['overruled', 'Godspeed also sets Stride and comes first, so this line is not used.'],
      ['add-only', 'Wit is worked out from other numbers, so it can only be added to. The line changes nothing.'],
      ['applied', undefined],
    ],
  );
  assert.equal(b.getState().derived.stats.get('wit')?.value, 16);
});

test('renaming keeps the feature where it is, and removing it takes it off the character', () => {
  // Fails if an update appends rather than replaces (the first of two sets would move), or remove leaves it held.
  const b = onOx();
  const first = b.addCustomFeature('Godspeed')!;
  b.addCustomFeature('Leaden');
  b.updateCustomFeature(first, { name: 'Swift', description: '' });
  assert.deepEqual(b.getState().character.customFeatures!.map((f) => f.name), ['Swift', 'Leaden']);
  assert.equal('description' in b.getState().character.customFeatures![0]!, false, 'an empty description is not recorded');
  b.removeCustomFeature(first);
  assert.deepEqual(b.getState().character.customFeatures!.map((f) => f.name), ['Leaden']);
  assert.equal(b.getState().derived.elementIds.has(`custom:${first}`), false);
});

test('a kind that carries none refuses a feature and says it is not available', () => {
  // Fails if the builder writes a feature the kind cannot hold.
  const b = onOx(false);
  assert.equal(b.getState().customFeatures.available, false);
  assert.equal(b.addCustomFeature('Godspeed'), undefined);
  assert.equal(b.getState().character.customFeatures, undefined);
});

test('a new line sets the first stat that may be set, starting at its current number; moving it follows the stat', () => {
  // Fails if a new set starts at 0 (the creature's 40 would be replaced by nothing typed), or a set moved onto a
  // stat that can only be added to stays a set.
  const state = onOx().getState();
  const { stats } = state.customFeatures;
  assert.deepEqual(newCustomStatLine(stats, state.derived), { stat: 'stride', mode: 'set', value: 40 });
  assert.deepEqual(newCustomStatLine(stats, state.derived, 'guard'), { stat: 'guard', mode: 'set', value: 15 });
  assert.deepEqual(newCustomStatLine(stats, state.derived, 'wit'), { stat: 'wit', mode: 'add', value: 0 });
  assert.equal(newCustomStatLine([], state.derived), undefined);
  const set = { stat: 'stride', mode: 'set' as const, value: 60 };
  assert.deepEqual(customLineOnStat(set, 'guard', stats, state.derived), { stat: 'guard', mode: 'set', value: 15 });
  assert.deepEqual(customLineOnStat(set, 'wit', stats, state.derived), { stat: 'wit', mode: 'add', value: 0 });
  assert.deepEqual(customLineOnStat({ ...set, mode: 'add', value: 5 }, 'wit', stats, state.derived), {
    stat: 'wit',
    mode: 'add',
    value: 5,
  });
});

test('the feature travels in the character, not in the embedded content, and derives the same with no source', () => {
  // Fails if the derivation needs content to hold the feature (the reopened stride reads the creature's 40).
  const b = onOx();
  const id = b.addCustomFeature('Godspeed')!;
  b.updateCustomFeature(id, { stats: [{ stat: 'stride', mode: 'set', value: 60 }, { stat: 'guard', mode: 'add', value: 2 }] });
  const { character } = b.getState();
  const kind = resolveCharacterKind(system(true), 'keeper');
  const content = collectCharacterContent(character, index, { kind });
  assert.equal(content.elements.some((e) => e.id.startsWith('custom:')), false);
  assert.deepEqual(content.unresolved, []);
  const reopened = deriveCharacter(structuredClone(character), system(true), new BundleElementIndex(content.elements));
  assert.equal(reopened.stats.get('stride')?.value, 60);
  assert.equal(reopened.stats.get('guard')?.value, 17);
});

// ADR 0065: where a feature is listed.

test('a feature may be listed under any type the kind lists, named as the sheet heads it, and the default is not recorded', () => {
  // Fails if the state names types by their element name rather than the sheet's plural, if the builder records the
  // default type (every feature would move its character to format 6), or if a chosen type is not written.
  const b = onOx(true, ['Knack', 'Deed']);
  assert.deepEqual(b.getState().customFeatures.types, [
    { type: 'Knack', label: 'Knacks' },
    { type: 'Deed', label: 'Deeds' },
  ]);
  const id = b.addCustomFeature('Trample')!;
  b.updateCustomFeature(id, { type: 'Knack' });
  assert.equal(b.getState().character.customFeatures![0]!.type, undefined);
  assert.equal(b.getState().character.formatVersion, 4);

  b.updateCustomFeature(id, { type: 'Deed', stats: [{ stat: 'stride', mode: 'add', value: 5 }] });
  let state = b.getState();
  assert.equal(state.character.customFeatures![0]!.type, 'Deed');
  assert.equal(state.character.formatVersion, 6);
  assert.equal(state.customFeatures.features[0]!.type, 'Deed');
  assert.equal(state.customFeatures.features[0]!.typeLabel, 'Deeds');
  assert.equal(state.derived.elements.find((e) => e.id === `custom:${id}`)?.type, 'Deed');
  assert.equal(state.derived.stats.get('stride')?.value, 45);

  // A later change that names no type keeps the one recorded; choosing the default again forgets it.
  b.updateCustomFeature(id, { name: 'Trample!' });
  assert.equal(b.getState().character.customFeatures![0]!.type, 'Deed');
  b.updateCustomFeature(id, { type: 'Knack' });
  state = b.getState();
  assert.equal(state.character.customFeatures![0]!.type, undefined);
  assert.equal(state.derived.elements.find((e) => e.id === `custom:${id}`)?.type, 'Knack');
});

test('a type the kind does not list is refused, and one recorded anyway says the feature is not on the character', () => {
  // Fails if the builder writes a type the kind does not list, or if the view says nothing about a feature the
  // derivation does not hold (its lines would read as applied, overruled or replaced), or if it names the list by
  // the recorded type rather than as the sheet heads it (checked: `typeLabel` as the raw type fails here).
  const b = onOx();
  assert.deepEqual(b.getState().customFeatures.types, [{ type: 'Knack', label: 'Knacks' }]);
  const id = b.addCustomFeature('Trample')!;
  b.updateCustomFeature(id, { type: 'Deed' });
  assert.equal(b.getState().character.customFeatures![0]!.type, undefined);

  const character = createCharacter('test', 'keeper');
  character.choices = [{ ruleKey: 'build/beast', elementIds: ['OX'] }];
  character.formatVersion = 6;
  character.customFeatures = [{ id: 'd', name: 'Trample', type: 'Deed', stats: [{ stat: 'stride', mode: 'set', value: 60 }] }];
  const view = new CharacterBuilder(character, system(true), index).getState();
  const feature = view.customFeatures.features[0]!;
  // Named as the sheet heads the list, never by the type's own name: the system calls a Deed's list "Deeds".
  assert.equal(feature.typeLabel, 'Deeds (not available)');
  assert.match(feature.typeNote ?? '', /has no "Deeds"/);
  assert.ok(!`${feature.typeLabel} ${feature.typeNote}`.includes('"Deed"'), "the type's own name is not shown");
  assert.deepEqual(feature.lines.map((l) => l.status), ['not-held']);
  assert.equal(view.derived.stats.get('stride')?.value, 40);
});
