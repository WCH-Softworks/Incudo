/**
 * Elements a user writes in the app, through a homebrew source, against 5e's own kinds — ADR 0108.
 *
 * With no corpus: a homebrew feat that adds 10 to Speed and gives a homebrew language is written through the editor's
 * view-model, kept as a homebrew source, loaded by `loadSources` with no network, added to a player character, and
 * the save reopens with no source to the same speed and the language. Changing the feat in the source afterwards is a
 * change ADR 0082's refresh offers that character, and only that one element.
 *
 * With the corpus: a homebrew spell written with the setters and support tags of a loaded first-level wizard spell
 * (read off it, never spelled here) is offered by a level 1 Wizard's spellbook choice, beside the books' spells.
 *
 * Perturbations that fail it, each run: the homebrew branch removed from `composeForLoad` (the load asks the network),
 * the homebrew file's `.json` ref renamed (the load reads no file and nothing is offered), the loaded elements' origin
 * written as Aurora's, and the draft's tags dropped in `homebrewElementOf` (the spellbook does not offer the spell).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  composeSource,
  createHomebrewSource,
  EMPTY_HOMEBREW,
  loadSources,
  readHomebrew,
  SourceProfile,
  writeHomebrew,
  type HomebrewBundle,
} from '@incudo/content';
import { BundleElementIndex, deriveCharacter, MemoryStorage, readCharacterContainer, type ElementIndex, type GameSystem } from '@incudo/core';
import {
  CharacterBuilder,
  contentChanges,
  homebrewDraftOf,
  newCharacterOfKind,
  newHomebrewDraft,
  packCharacter,
  saveHomebrewDraft,
  type HomebrewDraft,
} from '@incudo/ui';

import { loadCorpus } from './corpus.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusSkip, requireCorpus } from './real-data.ts';

const noNetwork = { fetchText: async () => Promise.reject(new Error('a homebrew source asks no network')) };

/** Save drafts into a body, one at a time, as the editor does, each against what is loaded then. */
function written(system: GameSystem, index: ElementIndex, drafts: HomebrewDraft[], sourceName: string): HomebrewBundle {
  let bundle = EMPTY_HOMEBREW;
  for (const draft of drafts) {
    const saved = saveHomebrewDraft(bundle, draft, { system, index, sourceName });
    assert.ok('bundle' in saved, 'problems' in saved ? saved.problems.join(' ') : '');
    bundle = saved.bundle;
  }
  return bundle;
}

test('a homebrew feat reaches a player character, and its save opens with no source', async () => {
  const system = await loadShippedSystem('dnd5e');
  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  const source = await createHomebrewSource(profile, storage, { name: 'Our table', systemId: system.id });

  // The language first, so the feat can give it: a grant names something loaded.
  const language = written(system, new BundleElementIndex([]), [{ ...newHomebrewDraft('Language'), name: 'Hill Cant' }], source.name);
  await writeHomebrew(storage, source.id, language);
  let loaded = await loadSources(profile.enabled, { fetcher: noNetwork, storage });
  assert.deepEqual(loaded.errors, []);
  const cant = [...loaded.elements.all()].find((e) => e.name === 'Hill Cant')!;
  assert.equal(cant.origin.format, 'incudo');

  const read = await readHomebrew(storage, source.id);
  assert.equal(read.status, 'ready');
  const fleet: HomebrewDraft = {
    ...newHomebrewDraft('Feat'),
    name: 'Fleet',
    description: 'You are quick on your feet.',
    lines: [
      { kind: 'add', stat: 'speed', value: 10 },
      { kind: 'grant', id: cant.id },
    ],
  };
  const both = saveHomebrewDraft(read.status === 'ready' ? read.bundle : EMPTY_HOMEBREW, fleet, { system, index: loaded.elements, sourceName: source.name });
  assert.ok('element' in both);
  await writeHomebrew(storage, source.id, both.bundle);
  loaded = await loadSources(profile.enabled, { fetcher: noNetwork, storage });
  assert.equal(loaded.elementCount, 2);

  const builder = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, loaded.elements);
  const before = builder.getState().derived.stats.get('speed')?.value ?? 0;
  assert.ok(builder.addElement(both.element.id), 'the feat is offered and added');
  const state = builder.getState();
  assert.equal(state.derived.stats.get('speed')?.value, before + 10);
  assert.ok(state.derived.elementIds.has(cant.id), 'what the feat gives is held');

  const { container } = readCharacterContainer(packCharacter(state.character, system, loaded.elements, { generator: 'test' }).files);
  const embedded = new BundleElementIndex(container!.content.elements);
  assert.deepEqual([...embedded.all()].filter((e) => e.origin.format === 'incudo').map((e) => e.name).sort(), ['Fleet', 'Hill Cant']);
  const reopened = deriveCharacter(container!.character, system, embedded);
  assert.equal(reopened.stats.get('speed')?.value, before + 10);
  assert.ok(reopened.elementIds.has(cant.id));

  // Changed in the source later: the refresh offers that one element, and the character is untouched until asked.
  const opened = homebrewDraftOf(both.element);
  assert.ok('draft' in opened);
  const faster = saveHomebrewDraft(both.bundle, { ...opened.draft, lines: [{ kind: 'add', stat: 'speed', value: 15 }, opened.draft.lines[1]!] }, {
    system,
    index: loaded.elements,
    sourceName: source.name,
  });
  assert.ok('bundle' in faster);
  await writeHomebrew(storage, source.id, faster.bundle);
  loaded = await loadSources(profile.enabled, { fetcher: noNetwork, storage });
  assert.deepEqual(contentChanges(embedded, loaded.elements).changed.map((e) => e.name), ['Fleet']);
});

test('a homebrew spell written like a wizard spell is offered by a Wizard spellbook', { skip: corpusSkip }, async () => {
  const system = await loadShippedSystem('dnd5e');
  const corpus = await loadCorpus(requireCorpus());
  const elements = corpus.library.elements;
  const PHB = 'Player’s Handbook';
  const like = elements.byType('Spell').find((s) => s.name === 'Magic Missile' && s.source === PHB)!;
  assert.ok(like, 'a first-level wizard spell to copy the setters and tags of');

  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  const source = await createHomebrewSource(profile, storage, { name: 'Our table', systemId: system.id });
  const bundle = written(
    system,
    elements,
    [
      {
        ...newHomebrewDraft('Spell'),
        name: 'Arc of Sparks',
        description: 'Sparks leap from your hand.',
        setters: Object.entries(like.setters).map(([name, setter]) => ({ name, value: setter.value })),
        tags: [...like.supports],
      },
    ],
    source.name,
  );
  await writeHomebrew(storage, source.id, bundle);
  await corpus.library.loadSource(composeSource(source, { fetcher: noNetwork, storage }), source.url);
  const spell = [...elements.all()].find((e) => e.name === 'Arc of Sparks')!;
  assert.ok(spell);

  const builder = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const human = elements.byType('Race').find((e) => e.name === 'Human' && e.source === PHB)!;
  builder.choose('build/race', [human.id]);
  builder.choose('build/class', ['ID_WOTC_PHB_CLASS_WIZARD']);
  const spellbook = builder.getState().decisions.find((d) => d.label === 'Spellbook (Wizard)');
  assert.ok(spellbook, 'a level 1 wizard has a spellbook choice open');
  assert.ok(spellbook.candidates.includes(like.id), 'the book spell is offered');
  assert.ok(spellbook.candidates.includes(spell.id), 'and the homebrew spell beside it');
});
