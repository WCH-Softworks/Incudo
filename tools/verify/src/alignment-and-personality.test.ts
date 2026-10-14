/**
 * Alignment, deity and a background's suggested personality, on the official corpus.
 *
 * Measured first: the 5e player character's "Details" step listed Alignment and Deity and was neither required, a pick
 * nor a set, so it offered nothing, and no character could take an alignment. Aurora asks for both at level 1 (every
 * sample records an `Alignment` and a `Deity` select there, all thirty unanswered); content declares 9 alignments and 296
 * deities. Aurora also copies a chosen suggested trait, ideal, bond and flaw into the save's personality text
 * (`background-traits` and its siblings); Incudo reads them off the choices while the field is blank.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CharacterBuilder, newCharacterOfKind, sheetDocument } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

const PHB = 'Player’s Handbook';

test('a new character is offered an alignment and a deity, both skippable, and the sheet names them', { skip: corpusSkip }, async (t) => {
  // Fails with Alignment and Deity back in one step that is not a pick (neither is offered).
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const alignment = b.getState().decisions.find((d) => d.stepId === 'alignment');
  const deity = b.getState().decisions.find((d) => d.stepId === 'deity');
  assert.ok(alignment && deity, 'both are offered');
  assert.equal(alignment.blocking, false);
  assert.equal(deity.blocking, false);
  t.diagnostic(`alignments offered: ${alignment.candidates.length}, deities: ${deity.candidates.length}`);
  const neutralGood = alignment.candidates.find((id) => elements.get(id)?.name === 'Neutral Good');
  assert.ok(neutralGood);
  b.choose(alignment.id, [neutralGood]);
  const header = sheetDocument(b.getState()).sections.flatMap((s) => s.elements ?? []).map((e) => e.name);
  assert.ok(header.includes('Neutral Good'), 'the sheet lists it');
});

test('a Sage’s chosen personality trait stands in for the written one until something is typed', { skip: corpusSkip }, async () => {
  // Fails if 5e's field declares no `suggestedBy`, or the select's name does not match content's.
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const pick = (stepId: string, name: string): void => {
    const d = b.getState().decisions.find((x) => x.stepId === stepId && x.kind === 'pick')!;
    b.choose(d.id, [d.candidates.find((id) => elements.get(id)?.name === name && elements.get(id)?.source === PHB)!]);
  };
  pick('race', 'Human');
  pick('class', 'Wizard');
  pick('background', 'Sage');
  const trait = b.getState().decisions.find((d) => d.label === 'Personality Trait')!;
  const first = trait.candidates[0]!;
  b.choose(trait.id, [first]);
  const field = () => b.getState().freeform.groups.flatMap((g) => g.fields).find((f) => f.key === 'background-traits')!;
  assert.equal(field().suggested, elements.get(first)!.name);
  assert.equal(b.getState().character.freeform['background-traits'], undefined, 'nothing is stored');
  b.setFreeform('background-traits', 'My own words.');
  assert.equal(field().value, 'My own words.');
});
