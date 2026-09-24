/**
 * The prepared-list view-model and its two writes — ADR 0046.
 *
 * No game in the fixture: a block called Orange that lets its player prepare Gadgets, from a catalogue
 * or from a ledger, with a note that says which tier a Gadget is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  MapElementIndex,
  parseSupports,
  type Character,
  type Element,
  type GameSystem,
  type Rule,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { planPrepare, planUnprepare, preparationOptions, preparationRows } from './preparation.ts';

function gadget(id: string, name: string, supports: string[], tier: string): Element {
  return {
    id,
    type: 'Gadget',
    name,
    source: 'Test Book',
    setters: { tier: { value: tier } },
    rules: [],
    supports,
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const stat = (name: string, value: number): Rule => ({
  kind: 'stat',
  key: `stat:${name}`,
  name,
  value: { kind: 'number', value },
});

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }, { name: 'Gadget' }],
    stats: [],
    characterKinds: [
      {
        id: 'pc',
        name: 'Character',
        default: true,
        progression: { kind: 'level', min: 1, max: 20 },
        elementTypes: ['Widget', 'Gadget'],
        blockFilters: [
          { key: 'gizmo:catalogue', tags: ['{list}', '{name}'] },
          { key: 'gizmo:charge', tagsFromStats: ['{name}:gizmo:charge:*'], fillFrom: 1 },
        ],
        preparation: {
          blockAttribute: 'prepare',
          limit: '{name}:gizmo:allow',
          elementType: 'Gadget',
          heldSelect: 'Ledger',
          listFilter: '$(gizmo:catalogue), $(gizmo:charge)',
          heldFilter: '$(gizmo:charge)',
        },
        candidateNotes: [{ types: ['Gadget'], setter: 'tier', label: 'Tier {value}' }],
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

const LEDGER: Rule = {
  kind: 'select',
  key: 'select:Ledger',
  type: 'Gadget',
  name: 'Ledger (Orange)',
  number: 3,
  spellcasting: 'Orange',
  supports: parseSupports('$(gizmo:catalogue), $(gizmo:charge)'),
};

const ALWAYS: Rule = { kind: 'grant', key: 'g', type: 'Gadget', id: 'FIXED', spellcasting: 'Orange', prepared: true };

function caster(rules: Rule[]): Element {
  return {
    id: 'CASTER',
    type: 'Widget',
    name: 'Caster',
    source: 'Test Book',
    setters: {},
    rules: [stat('orange:gizmo:allow', 2), stat('orange:gizmo:charge:2', 1), ...rules],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
    spellcasting: [{ name: 'Orange', prepare: 'true' }],
  };
}

function index(...elements: Element[]): MapElementIndex {
  const map = new MapElementIndex();
  map.addAll(elements);
  return map;
}

const ELEMENTS = [
  gadget('FIXED', 'Fixed', ['Orange'], '1'),
  gadget('B', 'Beta', ['Orange'], '2'),
  gadget('A', 'Alpha', ['Orange'], '1'),
  gadget('C', 'Gamma', ['Orange'], '3'),
  gadget('D', 'Delta', ['Purple'], '1'),
];

function builderFor(rules: Rule[], choices: Character['choices'] = [], prepared?: Character['prepared']) {
  const character = { ...createCharacter('test', 'pc', { progress: 3 }) };
  character.choices = [{ ruleKey: 'seed', elementIds: ['CASTER'] }, ...choices];
  if (prepared) character.prepared = prepared;
  const corpus = index(caster(rules), ...ELEMENTS);
  return { builder: new CharacterBuilder(character, system(), corpus), corpus };
}

test('a row says how many of how many, what is always prepared and what the player chose', () => {
  const { builder } = builderFor([ALWAYS], [], { orange: ['FIXED', 'B'] });
  const [row] = builder.getState().preparation;
  assert.deepEqual(
    { key: row?.key, name: row?.name, mode: row?.mode, limit: row?.limit, count: row?.count, remaining: row?.remaining, over: row?.over },
    { key: 'orange', name: 'Orange', mode: 'list', limit: 2, count: 1, remaining: 1, over: 0 },
  );
  assert.deepEqual(row?.always.map((i) => i.name), ['Fixed']);
  assert.deepEqual(row?.chosen.map((i) => `${i.name}/${i.note}/${i.source}`), ['Beta/Tier 2/Test Book']);
});

test('what can be added is what the block can prepare, by tier and then name', () => {
  const { builder } = builderFor([ALWAYS], [], { orange: ['B'] });
  // C is a tier the block has no charge for and D is on another catalogue; FIXED and B are on the list.
  assert.deepEqual(builder.preparationOptionsFor('orange').map((i) => i.name), ['Alpha']);
  const { builder: empty } = builderFor([ALWAYS]);
  assert.deepEqual(empty.preparationOptionsFor('orange').map((i) => i.name), ['Alpha', 'Beta']);
});

test('preparing writes the recorded list, and refuses what is not on offer without writing', () => {
  const { builder } = builderFor([ALWAYS]);
  assert.equal(builder.prepare('orange', 'A'), true);
  assert.deepEqual(builder.getState().character.prepared, { orange: ['A'] });
  // Already on it, always prepared, another catalogue, a tier with no charge, and no such element or block.
  for (const [key, id] of [['orange', 'A'], ['orange', 'FIXED'], ['orange', 'D'], ['orange', 'C'], ['orange', 'NOPE'], ['purple', 'A']] as const) {
    assert.equal(builder.prepare(key, id), false, `${key}/${id}`);
  }
  assert.deepEqual(builder.getState().character.prepared, { orange: ['A'] });
  assert.equal(builder.getState().preparation[0]?.count, 1);
});

test('going past the limit is allowed and reported, and taking one off clears it', () => {
  const { builder } = builderFor([]);
  builder.prepare('orange', 'A');
  builder.prepare('orange', 'B');
  assert.equal(builder.getState().preparation[0]?.over, 0);
  // A third that the block can prepare is what puts a list over; one it cannot prepare counts for nothing.
  const over = builderFor([], [], { orange: ['A', 'B', 'C'] }).builder;
  // C is a tier the block has no charge for, so it is unavailable and not counted: over stays 0.
  assert.equal(over.getState().preparation[0]?.over, 0);
  assert.deepEqual(over.getState().preparation[0]?.unavailable.map((i) => i.name), ['Gamma']);
  const tight = builderFor([], [], { orange: ['A', 'B', 'FIXED'] }).builder;
  assert.equal(tight.getState().preparation[0]?.over, 1);
  assert.equal(tight.getState().derived.problems.some((p) => p.code === 'over-prepared'), true);
  tight.unprepare('orange', 'FIXED');
  assert.equal(tight.getState().preparation[0]?.over, 0);
  assert.equal(tight.getState().derived.problems.some((p) => p.code === 'over-prepared'), false);
});

test('unpreparing what is not on the list changes nothing, and the last one removes the field', () => {
  const { builder } = builderFor([], [], { orange: ['A'] });
  const before = builder.getState().character;
  builder.unprepare('orange', 'B');
  assert.equal(builder.getState().character, before);
  builder.unprepare('orange', 'A');
  assert.equal('prepared' in builder.getState().character && builder.getState().character.prepared !== undefined, false);
});

test('a block with a ledger offers what it holds, and never what it does not have', () => {
  const { builder } = builderFor([LEDGER], [{ ruleKey: 'CASTER/select:Ledger', elementIds: ['A', 'C'] }]);
  const [row] = builder.getState().preparation;
  assert.equal(row?.mode, 'held');
  // A is held and passes; C is held at a tier with no charge; B is on the catalogue and not held.
  assert.deepEqual(builder.preparationOptionsFor('orange').map((i) => i.name), ['Alpha']);
  assert.equal(builder.prepare('orange', 'B'), false, 'on the catalogue is not the same as in the ledger');
  assert.equal(builder.prepare('orange', 'C'), false);
  assert.equal(builder.prepare('orange', 'A'), true);
});

test('a kind that declares no preparation has no rows and offers nothing', () => {
  const sys = system();
  delete sys.characterKinds[0]!.preparation;
  const character = { ...createCharacter('test', 'pc', { progress: 3 }) };
  character.choices = [{ ruleKey: 'seed', elementIds: ['CASTER'] }];
  const corpus = index(caster([]), ...ELEMENTS);
  const builder = new CharacterBuilder(character, sys, corpus);
  assert.deepEqual(builder.getState().preparation, []);
  assert.equal(builder.prepare('orange', 'A'), false);
  assert.deepEqual(builder.preparationOptionsFor('orange'), []);
});

test('the plans are pure: a refusal returns nothing and a write returns a new character', () => {
  const { builder, corpus } = builderFor([]);
  const { character, derived } = builder.getState();
  assert.equal(planPrepare(character, derived, corpus, 'orange', 'D'), undefined);
  const next = planPrepare(character, derived, corpus, 'orange', 'A');
  assert.deepEqual(next?.prepared, { orange: ['A'] });
  assert.equal(character.prepared, undefined, 'the character passed in is not modified');
  assert.equal(planUnprepare(character, 'orange', 'A'), character);
  assert.deepEqual(preparationOptions(derived, corpus, 'orange').map((i) => i.id), ['A', 'FIXED', 'B']);
  assert.equal(preparationRows(derived, corpus)[0]?.limit, 2);
});
