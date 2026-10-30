/**
 * What a character loses most by never seeing is listed with the decisions it must answer, though nothing owes it an
 * answer — ADR 0131. A Half-Elf's variant (the Sword Coast Adventurer's Guide's, or a dragonmark) and the starting
 * equipment of the first class and the background, against the real corpus. And an optional choice nothing loaded can
 * answer is not offered: a Half-Elf offered only the Player's Handbook is asked no variant.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CharacterBuilder, decisionGroups, newCharacterOfKind } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const HALF_ELF = 'ID_RACE_HALFELF';
const VARIANT = 'Half-Elf Variant';

async function halfElf(publications?: string[]): Promise<CharacterBuilder> {
  const system = await loadShippedSystem('dnd5e');
  const builder = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, await realElements());
  if (publications) builder.setPublications(publications);
  builder.choose('build/race', [HALF_ELF]);
  return builder;
}

test("a Half-Elf's variant is listed with the required decisions, still skippable and not owed", { skip: corpusSkip }, async (t: Diagnostic) => {
  // Fails with 5e's `listedWithRequired` types taken off the player character, or ignored by the builder: the variant
  // drops under Optional.
  t.diagnostic(corpusProvenance());
  const state = (await halfElf()).getState();
  const variant = state.decisions.find((d) => d.label === VARIANT);
  assert.ok(variant, state.decisions.map((d) => d.label).join(' | '));
  assert.equal(variant.blocking, false);
  assert.equal(variant.withRequired, true);
  assert.ok(variant.candidates.length > 0);
  const groups = decisionGroups(state.decisions);
  assert.ok(groups.required.includes(variant), 'shown with the required decisions');
  assert.equal(groups.owed, groups.required.filter((d) => d.blocking).length, 'and not counted as owed');
});

test('a Half-Elf offered no book that has a variant is asked none', { skip: corpusSkip }, async () => {
  // Fails if an optional choice that offers nothing is still listed: "Half-Elf Variant" with no candidate, to skip.
  const state = (await halfElf(['Player’s Handbook'])).getState();
  assert.equal(state.decisions.find((d) => d.label === VARIANT), undefined, state.decisions.map((d) => d.label).join(' | '));
  // Its own required choices are untouched.
  assert.ok(state.decisions.some((d) => d.blocking));
});

test("the first class's and the background's starting equipment are listed with the required decisions", { skip: corpusSkip }, async () => {
  // Fails with `listedWithRequired` taken off 5e's equipment step: both drop under Optional.
  const builder = await halfElf();
  builder.choose('build/class', ['ID_WOTC_PHB_CLASS_FIGHTER']);
  builder.choose('build/background', ['ID_BACKGROUND_SOLDIER']);
  const equipment = builder.getState().decisions.filter((d) => d.kind === 'equipment');
  assert.equal(equipment.length, 2, builder.getState().decisions.map((d) => d.label).join(' | '));
  for (const decision of equipment) {
    assert.equal(decision.blocking, false);
    assert.equal(decision.withRequired, true);
  }
});
