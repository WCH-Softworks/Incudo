/**
 * Aurora's `[character:N]` read as the character's level, against the real corpus — ADR 0071.
 *
 * A level 4 2024 Fighter's feat choice offers the 2024 Ability Score Improvement feat, which requires `[character:4]`:
 * read as a stat nothing published, so the choice offered none of the book's general feats that require it.
 *
 * Built by name: the 2024 Human and Fighter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveCharacter,
  resolveCharacterKind,
  setChoice,
  setInventoryEntry,
  type Element,
  type RequirementExpr,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

const PHB24 = 'Player’s Handbook (2024)';

/** The ids an expression holds under a `not`. */
function negatedIds(expr: RequirementExpr | undefined, negated = false, into = new Set<string>()): Set<string> {
  if (!expr) return into;
  if (expr.kind === 'not') return negatedIds(expr.child, !negated, into);
  if (expr.kind === 'and' || expr.kind === 'or') for (const child of expr.children) negatedIds(child, negated, into);
  if (expr.kind === 'has' && negated) into.add(expr.id);
  return into;
}

test('a level 4 2024 Fighter is offered the 2024 Ability Score Improvement feat', { skip: corpusSkip }, async (t) => {
  // Fails if `[character:N]` is not read as the character's level (the feat choice offers none of the book's general
  // feats that require it, the Ability Score Improvement feat among them).
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const improvement = elements.byType('Feat').find((f) => f.name === 'Ability Score Improvement' && f.source === PHB24);
  if (!improvement) return void t.skip('no 2024 Ability Score Improvement feat in this corpus');

  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  for (const [step, name] of [['race', 'Human'], ['class', 'Fighter']] as const) {
    const decision = b.getState().decisions.find((d) => d.stepId === step);
    const id = decision?.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === PHB24);
    assert.ok(decision && id, `a 2024 ${name} is offered`);
    b.choose(decision.id, [id]);
  }
  b.setProgress(4);
  const general = elements.byType('Feat').filter((f) => f.source === PHB24 && f.supports.includes('General'));
  const choice = b.getState().decisions.find((d) => d.candidates.includes(improvement.id));
  assert.ok(choice, 'a level 4 decision offers the 2024 Ability Score Improvement feat');
  const offered = general.filter((f) => choice.candidates.includes(f.id));
  t.diagnostic(`${choice.label}: offers ${offered.length} of the ${general.length} 2024 general feats`);

  // And at level 3, where `[character:4]` reads false, nothing offers it.
  b.setProgress(3);
  assert.equal(b.getState().decisions.some((d) => d.candidates.includes(improvement.id)), false, 'not offered at level 3');
});
