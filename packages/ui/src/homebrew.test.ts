/**
 * The homebrew element editor's view-model — ADR 0108.
 *
 * No game in the fixture: a hero's kind lets Knacks and Marks be added, and its sheet shows Might and Speed; a beast's
 * lets Knacks be added and shows Speed and Bite. Each test names the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, deriveCharacter, MapElementIndex, setAdded, type Element, type GameSystem } from '@incudo/core';
import { EMPTY_HOMEBREW, type HomebrewElement } from '@incudo/content';
import {
  homebrewDescriptionHtml,
  homebrewDescriptionText,
  homebrewDraftOf,
  homebrewDraftProblems,
  homebrewGrantOptions,
  homebrewRows,
  homebrewSetterSuggestions,
  homebrewStats,
  homebrewTagSuggestions,
  homebrewTagsFromText,
  homebrewTagsText,
  homebrewTypes,
  mintHomebrewId,
  newHomebrewDraft,
  removeHomebrewElement,
  saveHomebrewDraft,
  type HomebrewDraft,
} from './homebrew.ts';

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [
    { name: 'Origin', plural: 'Origins' },
    { name: 'Mark', plural: 'Marks' },
    { name: 'Knack', plural: 'Knacks' },
    { name: 'Boon' },
  ],
  stats: [
    { name: 'might', label: 'Might', default: 10 },
    { name: 'speed', label: 'Speed', default: 30 },
    { name: 'bite', label: 'Bite', default: 0 },
  ],
  characterKinds: [
    {
      id: 'hero',
      name: 'Hero',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Origin', 'Mark', 'Knack', 'Boon'],
      additions: { types: ['Knack', 'Mark'], description: 'Anything.' },
      customFeatures: { type: 'Knack' },
      buildSteps: [{ id: 'origin', label: 'Origin', types: ['Origin'], required: true }],
      sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['might', 'speed'] }] },
    },
    {
      id: 'beast',
      name: 'Beast',
      progression: { kind: 'none' },
      elementTypes: ['Knack'],
      additions: { types: ['Knack'], description: 'Anything.' },
      customFeatures: { type: 'Knack' },
      buildSteps: [],
      sheet: { sections: [{ id: 'block', label: 'Block', stats: ['speed', 'bite'] }] },
    },
  ],
};

function loaded(id: string, type: string, name: string, extra: Partial<Element> = {}): Element {
  return { id, type, name, source: 'Book', setters: {}, rules: [], supports: [], origin: { sourceId: 'book', format: 'incudo' }, ...extra };
}

const index = new MapElementIndex();
index.addAll([
  loaded('ID_KNACK_KEEN', 'Knack', 'Keen', { setters: { tier: { value: '1' } }, supports: ['Sharp'] }),
  loaded('ID_KNACK_DEEP', 'Knack', 'Deep', { setters: { tier: { value: '2' }, school: { value: 'Old' } }, supports: ['Sharp', 'Old'] }),
  loaded('ID_HOMEBREW_KNACK_FAST', 'Knack', 'Taken already'),
  loaded('ID_MARK_GLOW', 'Mark', 'Glow'),
]);
const context = { system, index, sourceName: 'My table' };

function draft(patch: Partial<HomebrewDraft> = {}): HomebrewDraft {
  return { ...newHomebrewDraft('Knack'), name: 'Fast', ...patch };
}

// Fails if the types are every declared type (Origin and Boon offered), or lose the system's order.
test('the types are the ones any kind lets a user add, in the order the system declares them', () => {
  assert.deepEqual(homebrewTypes(system), [
    { type: 'Mark', plural: 'Marks' },
    { type: 'Knack', plural: 'Knacks' },
  ]);
});

// Fails if the stats are one kind's (Bite missing) or listed twice (Speed, on both kinds).
test('a line may add to what a written feature may name on any kind, once each', () => {
  assert.deepEqual(homebrewStats(system).map((s) => s.stat), ['might', 'speed', 'bite']);
});

// Fails if the id is minted from a random value, or the collision check ignores loaded content or case.
test('an id is minted from the type and name once, and never reuses one taken', () => {
  assert.equal(mintHomebrewId('Knack', 'Élan vital!', () => false), 'ID_HOMEBREW_KNACK_ELAN_VITAL');
  const saved = saveHomebrewDraft(EMPTY_HOMEBREW, draft(), context);
  assert.ok('element' in saved);
  assert.equal(saved.element.id, 'ID_HOMEBREW_KNACK_FAST_2');
  const again = saveHomebrewDraft(saved.bundle, draft(), context);
  assert.ok('element' in again);
  assert.equal(again.element.id, 'ID_HOMEBREW_KNACK_FAST_3');
});

// Fails if a rename mints a new id (a character holding the element would lose it), or a save appends a second copy.
test('saving an opened element keeps its id and replaces it in place', () => {
  const first = saveHomebrewDraft(EMPTY_HOMEBREW, draft({ name: 'Swift' }), context);
  assert.ok('element' in first);
  const opened = homebrewDraftOf(first.element);
  assert.ok('draft' in opened);
  const renamed = saveHomebrewDraft(first.bundle, { ...opened.draft, name: 'Swifter' }, context);
  assert.ok('element' in renamed);
  assert.equal(renamed.element.id, first.element.id);
  assert.deepEqual(renamed.bundle.elements.map((e) => e.name), ['Swifter']);
  assert.deepEqual(removeHomebrewElement(renamed.bundle, first.element.id).elements, []);
});

// Fails if a line writes anything but a plain number rule or a grant of the target's type, or the stat keeps the case
// typed, or setters and tags are not trimmed and deduplicated.
test('a draft writes the element the engine reads', () => {
  const saved = saveHomebrewDraft(
    EMPTY_HOMEBREW,
    draft({
      description: 'Runs.\nFast.\n\nVery <fast> & far.',
      setters: [{ name: ' tier ', value: ' 3 ' }],
      tags: ['Sharp', ' Sharp', ''],
      lines: [
        { kind: 'add', stat: 'Speed', value: 10 },
        { kind: 'grant', id: 'ID_MARK_GLOW' },
      ],
    }),
    context,
  );
  assert.ok('element' in saved);
  const expected: HomebrewElement = {
    id: 'ID_HOMEBREW_KNACK_FAST_2',
    type: 'Knack',
    name: 'Fast',
    source: 'My table',
    setters: { tier: { value: '3' } },
    rules: [
      { kind: 'stat', key: 'line-0', name: 'speed', value: { kind: 'number', value: 10 } },
      { kind: 'grant', key: 'line-1', type: 'Mark', id: 'ID_MARK_GLOW' },
    ],
    supports: ['Sharp'],
    description: '<p>Runs.<br />Fast.</p>\n<p>Very &lt;fast&gt; &amp; far.</p>',
  };
  assert.deepEqual(saved.element, expected);
  // And it derives: a hero given it reads Speed 40 and holds what it gives.
  const withIt = new MapElementIndex();
  withIt.addAll([...index.all(), { ...saved.element, origin: { sourceId: 'homebrew:my-table', format: 'incudo' } }]);
  const hero = setAdded(createCharacter('test', 'hero'), saved.element.id, true);
  const derived = deriveCharacter(hero, system, withIt);
  assert.equal(derived.stats.get('speed')?.value, 40);
  assert.ok(derived.elements.some((e) => e.id === 'ID_MARK_GLOW'));
});

// Fails if any of the checks is removed.
test('a draft that cannot be written is refused with sentences', () => {
  const problems = (patch: Partial<HomebrewDraft>) => homebrewDraftProblems(draft(patch), context);
  assert.deepEqual(problems({}), []);
  assert.deepEqual(problems({ name: ' ' }), ['Give it a name.']);
  assert.deepEqual(problems({ type: 'Origin' }), ['Origin is not a type you can write here.']);
  assert.deepEqual(problems({ setters: [{ name: '', value: '1' }] }), ['A setter has no name.']);
  assert.deepEqual(problems({ setters: [{ name: 'tier', value: '1' }, { name: 'Tier', value: '2' }] }), ['The setter Tier is written twice.']);
  assert.deepEqual(problems({ lines: [{ kind: 'add', stat: 'luck', value: 1 }] }), ['luck is not a number a line can add to.']);
  assert.deepEqual(problems({ lines: [{ kind: 'add', stat: 'might', value: 1.5 }] }), ['Might takes a whole number.']);
  assert.deepEqual(problems({ lines: [{ kind: 'grant', id: 'ID_NOWHERE' }] }), ['What a line gives is not in any loaded source.']);
  assert.deepEqual(problems({ id: 'ID_KNACK_KEEN', lines: [{ kind: 'grant', id: 'ID_KNACK_KEEN' }] }), ['An entry cannot give itself.']);
  assert.ok('problems' in saveHomebrewDraft(EMPTY_HOMEBREW, draft({ name: '' }), context));
});

// Fails if an element saying more than the editor writes is opened (its gate, bucket or HTML would be lost on save).
test('an element the editor did not write is listed and not opened', () => {
  const plain: HomebrewElement = { id: 'X', type: 'Knack', name: 'Plain', source: 'My table', setters: {}, rules: [], supports: [] };
  assert.ok('draft' in homebrewDraftOf(plain));
  const locked = (patch: Partial<HomebrewElement>) => 'reason' in homebrewDraftOf({ ...plain, ...patch });
  assert.ok(locked({ rules: [{ kind: 'stat', key: 'a', name: 'speed', value: { kind: 'number', value: 5 }, level: 3 }] }));
  assert.ok(locked({ rules: [{ kind: 'stat', key: 'a', name: 'speed', value: { kind: 'number', value: 5 }, bonus: 'base' }] }));
  assert.ok(locked({ rules: [{ kind: 'stat', key: 'a', name: 'speed', value: { kind: 'ref', stat: 'might' } }] }));
  assert.ok(locked({ rules: [{ kind: 'select', key: 's', type: 'Mark', name: 'Pick', number: 1 }] }));
  assert.ok(locked({ description: '<p>A <b>bold</b> claim.</p>' }));
  assert.ok(locked({ requirements: { kind: 'atLeast', stat: 'might', value: 12 } }));
  const rows = homebrewRows({ formatVersion: 1, elements: [{ ...plain, description: '<table/>' }] }, context);
  assert.equal(rows[0]!.locked, 'It says more than this editor writes, so it is left as it is.');
});

// Fails if the text round trip loses a paragraph, a line break or an escaped character.
test('a description written as plain text reads back as written', () => {
  const text = 'One & two.\nThree <four>.\n\nFive "six".';
  assert.equal(homebrewDescriptionText(homebrewDescriptionHtml(text)), text);
  assert.equal(homebrewDescriptionText(''), '');
});

// Fails if lines are not worded with the stat's label and the element's name, or rows not sorted by name.
test('the list names each element and what its lines do', () => {
  let bundle = EMPTY_HOMEBREW;
  for (const d of [
    draft({ name: 'Zeal', lines: [{ kind: 'add', stat: 'bite', value: -2 }] }),
    draft({ name: 'Alert', lines: [{ kind: 'add', stat: 'might', value: 1 }, { kind: 'grant', id: 'ID_MARK_GLOW' }] }),
  ]) {
    const saved = saveHomebrewDraft(bundle, d, context);
    assert.ok('bundle' in saved);
    bundle = saved.bundle;
  }
  assert.deepEqual(
    homebrewRows(bundle, context).map((r) => [r.name, r.summary]),
    [
      ['Alert', 'Adds 1 to Might; Gives Glow (Mark)'],
      ['Zeal', 'Takes 2 from Bite'],
    ],
  );
});

// Fails if the tag line is not split on commas, or keeps blanks and repeats.
test('tags are one line of text split on commas', () => {
  assert.deepEqual(homebrewTagsFromText(' Sharp, Old,,Sharp , '), ['Sharp', 'Old']);
  assert.equal(homebrewTagsText(['Sharp', 'Old']), 'Sharp, Old');
});

// Fails if suggestions are a fixed list, or not read per type, or not ordered by use.
test('setter names and tags are suggested from what loaded elements of the type carry', () => {
  assert.deepEqual(homebrewSetterSuggestions(index, 'Knack'), ['tier', 'school']);
  assert.deepEqual(homebrewTagSuggestions(index, 'Knack'), ['Sharp', 'Old']);
  assert.deepEqual(homebrewSetterSuggestions(index, 'Mark'), []);
  assert.deepEqual(homebrewGrantOptions(context, 'gl').map((o) => o.id), ['ID_MARK_GLOW']);
  assert.deepEqual(homebrewGrantOptions(context, ' '), []);
});
