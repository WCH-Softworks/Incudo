/**
 * Open decisions in the order the character meets them, on the official corpus.
 *
 * Measured first, before the order changed: a 2014 Elf Sage taken straight to Fighter 6 listed Martial Archetype (level
 * 3) ahead of its level 1 Fighting Style and skills and both improvements (4 and 6) before its skills; a Wizard 6
 * listed its first cantrips and spellbook last, after its level 4 improvement; and the ability scores and hit points
 * came after everything, appended after the list was sorted. Now each decision is listed by the level it opens at, and
 * within a level by its step's rank, which keeps creation in the system's own order. Found by name and book, never by id.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CharacterBuilder, newCharacterOfKind, type OpenDecision } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

const PHB = 'Player’s Handbook';

async function sixthLevel(className: string) {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const pick = (stepId: string, name: string): void => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === PHB);
    assert.ok(decision && id, `the ${stepId} step offers ${name}`);
    b.choose(decision.id, [id]);
  };
  pick('race', 'Elf');
  pick('class', className);
  pick('background', 'Sage');
  b.setProgress(6);
  return b.getState().decisions;
}

const at = (decisions: OpenDecision[], label: string): number => {
  const i = decisions.findIndex((d) => d.label === label);
  assert.ok(i >= 0, `"${label}" is open`);
  return i;
};

const report = (t: { diagnostic: (s: string) => void }, decisions: OpenDecision[]): void => {
  for (const d of decisions) t.diagnostic(`${d.opensAt ?? '-'}  ${d.label}`);
};

test('a Fighter taken to 6 meets its first-level choices before its later ones', { skip: corpusSkip }, async (t) => {
  // Fails with the order by step rank alone (Martial Archetype second among the class's), with the budget and hit points
  // appended unsorted (Ability Scores last), or with no `opensAt` on a select (the improvements tie with level 1).
  t.diagnostic(corpusProvenance());
  const decisions = await sixthLevel('Fighter');
  report(t, decisions);
  assert.equal(decisions[0]!.label, 'Ability Scores', 'the scores come first');
  const style = at(decisions, 'Fighting Style');
  const skills = at(decisions, 'Skill Proficiency (Fighter)');
  const archetype = at(decisions, 'Martial Archetype');
  const fourth = at(decisions, 'Improvement Option (Fighter 4)');
  const sixth = at(decisions, 'Improvement Option (Fighter 6)');
  assert.ok(style < archetype && skills < archetype, 'level 1 before level 3');
  assert.ok(archetype < fourth && fourth < sixth, 'level 3, then 4, then 6');
  assert.equal(decisions.findIndex((d) => (d.opensAt ?? 0) > 1), archetype, 'nothing at level 1 after the first later choice');
});

test('a Wizard taken to 6 meets its first cantrips and spellbook before its tradition and improvement', { skip: corpusSkip }, async (t) => {
  // Fails with the order by step rank alone (the spells last), or with a select that names no level opening from the
  // start (Arcane Tradition, on a marker the class grants at level 2, among the level 1 choices).
  t.diagnostic(corpusProvenance());
  const decisions = await sixthLevel('Wizard');
  report(t, decisions);
  const cantrips = at(decisions, 'Cantrip (Wizard)');
  const book = at(decisions, 'Spellbook (Wizard)');
  const tradition = at(decisions, 'Arcane Tradition');
  const fourth = at(decisions, 'Improvement Option (Wizard 4)');
  assert.equal(decisions[tradition]!.opensAt, 2);
  assert.ok(cantrips < tradition && book < tradition, 'level 1 before level 2');
  assert.ok(tradition < fourth, 'level 2 before level 4');
  // Within the start, the system's own step order: the race's subrace before the class's skills, before its spells.
  assert.ok(at(decisions, 'Elven Subrace') < at(decisions, 'Skill Proficiency (Wizard)'));
  assert.ok(at(decisions, 'Skill Proficiency (Wizard)') < cantrips);
});
