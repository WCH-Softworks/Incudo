/**
 * A written feature's line that marks a row, as the builder edits and shows it — ADR 0094.
 *
 * No game in the fixture: a keeper's climb and swim read their own "…:skill", which starts where an Ox's rule puts it,
 * and the Feats section marks a row by how many edges its skill holds. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type StatExpr as Expr, type GameSystem } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import {
  customLineModeAllowed,
  customLineModes,
  customLineOnStat,
  customLineWithMode,
  customFeaturesHint,
  customMarkChoices,
} from './custom-features.ts';

const ref = (stat: string): Expr => ({ kind: 'ref', stat });

const SYSTEM: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Beast' }, { name: 'Knack', plural: 'Knacks' }],
  stats: [
    { name: 'edge', label: 'Edge', default: 2 },
    { name: 'guard', label: 'Guard', default: 10 },
    { name: 'climb:skill', default: 0, startsFrom: 'beast:climb:skill' },
    { name: 'climb', label: 'Climb', derive: ref('climb:skill') },
  ],
  characterKinds: [
    {
      id: 'keeper',
      name: 'Keeper',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Beast', 'Knack'],
      customFeatures: { type: 'Knack' },
      buildSteps: [{ id: 'beast', label: 'Beast', types: ['Beast'], required: true }],
      sheet: {
        sections: [
          { id: 'numbers', label: 'Numbers', stats: ['edge', 'guard'] },
          {
            id: 'feats',
            label: 'Feats',
            stats: ['climb'],
            mark: { stat: '{stat}:skill', per: 'edge', labels: ['trained', 'master'], none: 'untrained' },
          },
          { id: 'knacks', label: 'Knacks', types: ['Knack'] },
        ],
      },
    },
  ],
};

const index = new MapElementIndex();
const ox: Element = {
  id: 'OX',
  type: 'Beast',
  name: 'Ox',
  source: 'test',
  setters: {},
  rules: [],
  supports: [],
  origin: { sourceId: 'test', format: 'incudo' },
};
index.addAll([ox]);

function onOx(): CharacterBuilder {
  const b = new CharacterBuilder(createCharacter('test', 'keeper'), SYSTEM, index);
  b.choose('build/beast', ['OX']);
  return b;
}

test('a line may be marked only on a row that may be marked, and offers the mark by name, none first', () => {
  // Fails if marking is offered on a row with no mark (Guard offers "marked"), or the choices lose their order.
  const { stats } = onOx().getState().customFeatures;
  assert.deepEqual(customLineModes(stats, 'climb').map((m) => m.label), ['adds', 'sets it to', 'marked']);
  assert.deepEqual(customLineModes(stats, 'guard').map((m) => m.mode), ['add', 'set']);
  assert.deepEqual(customMarkChoices(stats, 'climb'), ['untrained', 'trained', 'master']);
  assert.equal(customLineModeAllowed(stats, 'climb', 'set'), false, 'climb is worked out');
  assert.equal(customLineModeAllowed(stats, 'climb', 'mark'), true);
});

test('switching a line to marked starts at the first mark, and back to adding starts at 0', () => {
  // Fails if a mark keeps the number it was added with (an add of 5 would be a count of 5), if an add keeps the count,
  // or if a row that may not be marked is switched anyway.
  const { stats } = onOx().getState().customFeatures;
  const marked = customLineWithMode({ stat: 'climb', mode: 'add', value: 5 }, 'mark', stats);
  assert.deepEqual(marked, { stat: 'climb', mode: 'mark', value: 1 });
  assert.deepEqual(customLineWithMode({ ...marked, value: 2 }, 'add', stats), { stat: 'climb', mode: 'add', value: 0 });
  const guard = { stat: 'guard', mode: 'add' as const, value: 3 };
  assert.equal(customLineWithMode(guard, 'mark', stats), guard);
});

test('a marked line moved to a row that may not be marked becomes an add of 0', () => {
  // Fails if the count is carried to Guard as a mark nothing can read.
  const state = onOx().getState();
  const line = customLineOnStat({ stat: 'climb', mode: 'mark', value: 2 }, 'guard', state.customFeatures.stats, state.derived);
  assert.deepEqual(line, { stat: 'guard', mode: 'add', value: 0 });
});

test("each marked line says what it is doing: applied, overruled by an earlier one, or a mark the row has no name for", () => {
  // Fails if a mark's status reads its own row's start (an overruled line reads as applied), or if a count past the
  // choices reads as applied.
  const b = onOx();
  const grip = b.addCustomFeature('Grip')!;
  b.updateCustomFeature(grip, { stats: [{ stat: 'climb', mode: 'mark', value: 1 }] });
  const talons = b.addCustomFeature('Talons')!;
  b.updateCustomFeature(talons, { stats: [{ stat: 'climb', mode: 'mark', value: 2 }, { stat: 'climb', mode: 'mark', value: 7 }] });
  const state = b.getState();
  assert.equal(state.derived.stats.get('climb')?.value, 2);
  const [first, second] = state.customFeatures.features;
  assert.equal(first!.lines[0]!.status, 'applied');
  assert.equal(second!.lines[0]!.status, 'overruled');
  assert.equal(second!.lines[0]!.note, 'Grip also marks Climb and comes first, so this line is not used.');
  assert.equal(second!.lines[1]!.status, 'not-markable');
  assert.equal(state.character.formatVersion, 9);
});

test('the hint says only what a line on this kind can do', () => {
  // Fails if the hint is one sentence for every kind: a player character's lines only add, and were told they set.
  const { stats } = onOx().getState().customFeatures;
  assert.match(customFeaturesHint(stats), /adds to a number, sets it, or, where the sheet marks a number, chooses its mark;/);
  assert.match(customFeaturesHint(stats), /A number typed in the entry steps replaces/);
  const addOnly = stats.filter((s) => !s.settable && !s.mark);
  assert.match(customFeaturesHint(addOnly), /Each line adds to a number; a feature can also/);
  assert.doesNotMatch(customFeaturesHint(addOnly), /entry steps/);
  assert.match(customFeaturesHint(stats.filter((s) => s.settable)), /Each line adds to a number or sets it;/);
});
