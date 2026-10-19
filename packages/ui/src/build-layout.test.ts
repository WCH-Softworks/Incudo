/**
 * Which tab a decision or a settled choice is on, and what the middle column edits — ADR 0124.
 *
 * No game in the fixture: a hero picks a Calling, which opens a Charm select (the kind prepares Charms, so they are its
 * spells) and a Knack select. A plain hero picks the Wanderer calling, which opens nothing of the kind. Each test names
 * the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem, type Rule } from '@incudo/core';

import {
  additionsOnTab,
  buildTabContent,
  buildTabs,
  nextBuildTab,
  settledEditView,
  shownTab,
  spellsWaitingNote,
} from './build-layout.ts';
import { parseBuildPreferences } from './build-preferences.ts';
import { searchCandidates } from './candidate-search.ts';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, rules: Rule[] = []): Element {
  return {
    id,
    type,
    name: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, ' '),
    source: 'Book',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const select = (name: string, type: string, number = 1): Rule => ({ kind: 'select', key: `select:${name}`, name, type, number }) as Rule;

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Calling' }, { name: 'Knack' }, { name: 'Charm' }],
    stats: [{ name: 'level', label: 'Level', default: 1 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', stat: 'level', min: 1, max: 10 },
        elementTypes: ['Calling', 'Knack', 'Charm'],
        preparation: { blockAttribute: 'prepare', limit: 'charms', elementType: 'Charm', listFilter: '', heldFilter: '' },
        additions: { types: ['Knack', 'Charm'] },
        buildSteps: [{ id: 'calling', label: 'Calling', types: ['Calling'], required: true }],
        sheet: { sections: [] },
      },
    ],
  } as GameSystem;
}

const index = new MapElementIndex();
index.addAll([
  element('MYSTIC', 'Calling', [select('Charm', 'Charm', 2), select('Knack', 'Knack')]),
  element('WANDERER', 'Calling', [select('Knack', 'Knack')]),
  element('SPARK', 'Charm'),
  element('GLOW', 'Charm'),
  element('HUSH', 'Charm'),
  element('SWIFT', 'Knack'),
  element('KEEN', 'Knack'),
]);

function hero(calling: string): CharacterBuilder {
  const builder = new CharacterBuilder(createCharacter('test', 'hero'), system(), index);
  builder.choose('build/calling', [calling]);
  return builder;
}

test('a choice of the kind’s spell type is on the Spells tab, and everything else on Build', () => {
  // Fails if the type is not read from the pool (the Charm select stays on Build), or if every select is moved (the
  // Knack select leaves Build).
  const state = hero('MYSTIC').getState();
  const { build, spells } = buildTabContent(state);
  assert.deepEqual(spells.decisions.map((d) => d.label), ['Charm']);
  assert.deepEqual(build.decisions.map((d) => d.label), ['Knack']);
  assert.deepEqual(buildTabs(state).map((t) => [t.id, t.required]), [['build', 1], ['spells', 1], ['details', undefined]]);
  assert.equal(spellsWaitingNote(1), 'One spell choice is waiting on the Spells tab.');
  assert.equal(spellsWaitingNote(0), undefined);
});

test('a settled spell choice stays on the Spells tab', () => {
  // Fails if a settled pick's type is read only from open pools (Spark and Glow move back to Build once the pool closes).
  const builder = hero('MYSTIC');
  builder.choose('MYSTIC/select:Charm', ['SPARK', 'GLOW']);
  const { build, spells } = buildTabContent(builder.getState());
  assert.deepEqual(spells.picks.map((p) => p.label), ['Charm']);
  assert.ok(build.picks.every((p) => p.label !== 'Charm'));
});

test('a character with no spell work has no Spells tab, and a remembered Spells tab falls back to Build', () => {
  // Fails if the tab is always offered (a Wanderer gets one), or if a remembered tab the character lacks is shown.
  const state = hero('WANDERER').getState();
  const tabs = buildTabs(state);
  assert.deepEqual(tabs.map((t) => t.id), ['build', 'details']);
  assert.equal(shownTab('spells', tabs), 'build');
  assert.equal(nextBuildTab('build', tabs), 'details');
  assert.equal(nextBuildTab('details', tabs), 'build');
  assert.equal(parseBuildPreferences(JSON.stringify({ tab: 'spells' })).tab, 'spells', 'the preference is remembered');
});

test('each tab lists what was added of its own types', () => {
  // Fails if the split ignores the kind's spell type (Hush listed on Build).
  const builder = hero('MYSTIC');
  builder.addElement('HUSH');
  builder.addElement('KEEN');
  const { additions, kind } = builder.getState();
  assert.deepEqual(additionsOnTab(additions, kind, 'spells').rows.map((r) => r.elementId), ['HUSH']);
  assert.deepEqual(additionsOnTab(additions, kind, 'build').rows.map((r) => r.elementId), ['KEEN']);
  assert.deepEqual(additionsOnTab(additions, kind, 'spells').types.map((t) => t.type), ['Charm']);
});

test('an edit of a settled slot names it, offers its options, and is gone once the slot is', () => {
  // Fails if the edit is not read from the state as it is now (it outlives the removed answer), or if the options are
  // not the slot's (the other slot's answer offered).
  const builder = hero('MYSTIC');
  builder.choose('MYSTIC/select:Charm', ['SPARK', 'GLOW']);
  const view = settledEditView(builder.getState(), { kind: 'pick', ruleKey: 'MYSTIC/select:Charm', slot: 1 });
  assert.ok(view && view.kind === 'pick');
  assert.equal(view.title, 'Change Charm');
  assert.equal(view.current, 'GLOW');
  assert.deepEqual([...view.options].sort(), ['GLOW', 'HUSH']);
  builder.choose('MYSTIC/select:Charm', ['SPARK']);
  assert.equal(settledEditView(builder.getState(), { kind: 'pick', ruleKey: 'MYSTIC/select:Charm', slot: 1 }), undefined);
  assert.equal(settledEditView(builder.getState(), { kind: 'values', stepId: 'calling' }), undefined, 'a step with no values');
});

test('the current answer leads the list while nothing is typed', () => {
  // Fails if `first` is ignored (Swift, sorted last, is not first), or if it outranks a query (Hush, the current answer,
  // ahead of Swift, which starts with what is typed).
  const options = [
    { id: 'KEEN', label: 'Keen' },
    { id: 'SWIFT', label: 'Swift' },
    { id: 'HUSH', label: 'Hush' },
  ];
  assert.deepEqual(searchCandidates(options, '', Infinity, 'SWIFT').matches.map((o) => o.id), ['SWIFT', 'HUSH', 'KEEN']);
  assert.deepEqual(searchCandidates(options, 's', Infinity, 'HUSH').matches.map((o) => o.id), ['SWIFT', 'HUSH']);
});
