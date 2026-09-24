/**
 * Which publications a character is offered, over the official corpus and the sample saves — ADR 0049.
 *
 * What must hold against any corpus (ADR 0042): the 5e definition names a publication type that content
 * fills; a character offered one book is offered nothing from any other, and still everything that names no
 * book; and switching books off moves no derived number on any sample, which is the ADR's third decision.
 * The sizes are printed, never pinned: the corpus moves.
 *
 * `aurora verify` cannot see any of this. It compares what a character chose, and a list narrows only what is
 * offered.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  LayeredElementIndex,
  createCharacter,
  validateGameSystem,
  type ElementId,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { importAuroraCharacter, parseAuroraSave } from '@incudo/aurora-import';
import { CharacterBuilder, publicationList, publicationTypes, type BuilderState } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { loadSchemas } from './node-system.ts';
import { corpusSkip, realElements, requireCorpus, requireSaves, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

async function shippedSystem(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

/** Everything the builder offers right now: every open decision's candidates and every settled pick's. */
function offered(state: BuilderState): Set<ElementId> {
  const ids = new Set<ElementId>();
  for (const decision of state.decisions) for (const id of decision.candidates ?? []) ids.add(id);
  for (const pick of state.picks) for (const id of pick.candidates) if (!pick.chosen.includes(id)) ids.add(id);
  return ids;
}

/** The loaded publications a character can be refused, lowercased, which is how the join reads them. */
function books(index: ElementIndex, system: GameSystem): Set<string> {
  const required = requiredBooks(index, system);
  return new Set(
    publicationTypes(system)
      .flatMap((type) => index.byType(type).map((element) => element.name.trim().toLowerCase()))
      .filter((name) => !required.has(name)),
  );
}

/** The publications every character is offered whatever it records. */
function requiredBooks(index: ElementIndex, system: GameSystem): Set<string> {
  const list = publicationList(index, system, createCharacter('dnd5e', 'pc', { progress: 1 }));
  return new Set(list.rows.filter((row) => row.required).map((row) => row.name.trim().toLowerCase()));
}

test('a character offered one book is offered nothing from another, and everything that names no book', { skip: corpusSkip }, async (t) => {
  requireCorpus();
  const system = await shippedSystem();
  const index = await realElements();
  const known = books(index, system);
  assert.ok(known.size > 0, 'the 5e definition names a publication type and content fills it');
  const required = requiredBooks(index, system);

  const list = publicationList(index, system, createCharacter('dnd5e', 'pc', { progress: 1 }));
  const handbook = list.rows.find((row) => row.name === 'Player’s Handbook');
  assert.ok(handbook && handbook.elements > 0, 'the 2014 Player’s Handbook is loaded and holds content');

  // A wizard, so a spellbook pool is open beside the race, background and class lists.
  const builder = new CharacterBuilder(createCharacter('dnd5e', 'pc', { progress: 1 }), system, index);
  const wizard = index.byType('Class').find((c) => c.name === 'Wizard' && c.source === 'Player’s Handbook');
  assert.ok(wizard, 'the 2014 Wizard is loaded');
  builder.choose('build/class', [wizard.id]);

  const everything = builder.getState();
  const before = offered(everything);
  builder.setPublications([handbook.name]);
  const narrowed = builder.getState();
  const after = offered(narrowed);

  const sourceOf = (id: ElementId): string => index.get(id)!.source.trim().toLowerCase();
  const fromAnotherBook = [...after].filter((id) => known.has(sourceOf(id)) && sourceOf(id) !== 'player’s handbook');
  assert.deepEqual(fromAnotherBook, [], 'nothing from another book is offered');

  const noBook = (ids: Set<ElementId>): ElementId[] => [...ids].filter((id) => !known.has(sourceOf(id))).sort();
  assert.deepEqual(noBook(after), noBook(before), 'what names no book is offered either way');
  assert.ok(after.size < before.size, 'the list narrowed what is offered');

  // A required book is offered anyway. In the official corpus it holds every skill, so without it the
  // wizard's two skills would offer nothing.
  const fromRequired = [...after].filter((id) => required.has(sourceOf(id)));
  if (required.size) assert.ok(fromRequired.length > 0, 'a required book is still offered');
  const skills = narrowed.decisions.find((d) => d.label.startsWith('Skill Proficiency'));
  assert.ok(skills && (skills.candidates?.length ?? 0) > 0, 'the wizard is still offered skills');

  // Nothing the character is changed: the class is still held and derives as it did.
  assert.deepEqual(summarize(narrowed.derived), summarize(everything.derived), 'the derivation is untouched');

  const spellbook = (state: BuilderState): number =>
    state.decisions.find((d) => d.label.startsWith('Spellbook'))?.candidates?.length ?? 0;
  const race = (state: BuilderState): number => state.decisions.find((d) => d.id === 'build/race')?.candidates?.length ?? 0;
  t.diagnostic(
    `publications loaded: ${list.rows.length}, of which ${list.rows.filter((r) => r.elements > 0).length} hold content and ${required.size} ${required.size === 1 ? 'is' : 'are'} required: ${[...list.rows].filter((r) => r.required).map((r) => r.name).join(', ')}`,
  );
  t.diagnostic(`offered to a level 1 wizard: ${before.size} with every book, ${after.size} with the 2014 Player’s Handbook`);
  t.diagnostic(`races ${race(everything)} → ${race(narrowed)}, spellbook ${spellbook(everything)} → ${spellbook(narrowed)}`);
});

test('offering a sample no book at all moves no derived number and offers nothing from a book', { skip: savesSkip }, async (t) => {
  requireSaves();
  const system = await shippedSystem();
  const corpus = await realElements();
  const known = books(corpus, system);

  let checked = 0;
  for (const sample of readManifest().samples) {
    const save = parseAuroraSave(await readFile(samplePath(sample), 'utf8'));
    const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
    const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);

    const builder = new CharacterBuilder(imported.character, system, elements);
    const before = builder.getState();
    builder.setPublications([]);
    const after = builder.getState();

    assert.deepEqual(summarize(after.derived), summarize(before.derived), `${sample.id}: the derivation is untouched`);
    const fromABook = [...offered(after)].filter((id) => known.has(elements.get(id)!.source.trim().toLowerCase()));
    assert.deepEqual(fromABook, [], `${sample.id}: nothing from a book is offered`);
    checked++;
  }
  assert.ok(checked > 0, 'at least one sample was checked');
  t.diagnostic(`samples whose derivation is identical with no book offered: ${checked}`);
});
