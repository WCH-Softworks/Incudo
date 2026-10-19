/**
 * A prerequisite naming a spell is a warning on an offer, not a filter — ADR 0124.
 *
 * Measured first, and reported (`ℹ` lines; ADR 0042, a moving corpus fails only what must hold against any corpus): the
 * elements whose own requirements name an element of a type 5e's player character makes soft, by type and by how the
 * term is written. At `c28ce6c` it was ten, every one an Eldritch Invocation (three Player's Handbook, two Xanathar's,
 * five Unearthed Arcana), each naming Eldritch Blast, never under a `not`. Before this, a warlock without that cantrip was
 * never offered them; content prints the prerequisite as prose ("eldritch blast cantrip") beside the rule.
 *
 * Asserted against any corpus: a 2014 Warlock 2 who has not taken Eldritch Blast is offered Agonizing Blast, with a note
 * naming the cantrip; once it is taken the note is gone; and every note on the invocation decision names only elements
 * of a soft type the character does not hold.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCharacterKind, type RequirementExpr } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

const PHB = 'Player’s Handbook';

/** Every `has` term with whether it sits under an odd number of `not`s. */
function terms(expr: RequirementExpr | undefined, negated = false, into: Array<[string, boolean]> = []): Array<[string, boolean]> {
  if (!expr) return into;
  if (expr.kind === 'has') into.push([expr.id, negated]);
  else if (expr.kind === 'and' || expr.kind === 'or') for (const child of expr.children) terms(child, negated, into);
  else if (expr.kind === 'not') terms(expr.child, !negated, into);
  return into;
}

test('which requirements name an element of a soft type (report)', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const soft = new Set(resolveCharacterKind(system, 'pc').softRequirements?.types ?? []);
  assert.ok(soft.size > 0, "5e's player character makes some type soft");
  const byType = new Map<string, number>();
  const named = new Map<string, number>();
  let negated = 0;
  for (const element of elements.all()) {
    const found = terms(element.requirements).filter(([id]) => soft.has(elements.get(id)?.type ?? ''));
    if (!found.length) continue;
    byType.set(element.type, (byType.get(element.type) ?? 0) + 1);
    for (const [id, under] of found) {
      if (under) negated++;
      const name = elements.get(id)!.name;
      named.set(name, (named.get(name) ?? 0) + 1);
    }
  }
  t.diagnostic(`elements: ${[...byType].map(([type, n]) => `${n} ${type}`).join(', ') || 'none'}`);
  t.diagnostic(`naming: ${[...named].map(([name, n]) => `${n} ${name}`).join(', ') || 'none'}; under a not: ${negated}`);
});

test('a 2014 Warlock without Eldritch Blast is offered Agonizing Blast with a warning', { skip: corpusSkip }, async (t) => {
  // Fails if the engine filters on a soft term (Agonizing Blast not offered), if the note is not worded from the
  // derivation (no note, or one that stays once the cantrip is taken), or if a note names something that is not soft.
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const kind = resolveCharacterKind(system, 'pc');
  const agonizing = elements.byType('Class Feature').find((e) => e.name === 'Agonizing Blast' && e.source === PHB);
  const blast = elements.byType('Spell').find((e) => e.name === 'Eldritch Blast' && e.source === PHB);
  if (!agonizing || !blast) return void t.skip('the 2014 Agonizing Blast or Eldritch Blast is not in this corpus');

  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  for (const [step, name] of [['race', 'Human'], ['class', 'Warlock']] as const) {
    const decision = b.getState().decisions.find((d) => d.stepId === step);
    const id = decision?.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === PHB);
    assert.ok(decision && id, `a 2014 ${name} is offered`);
    b.choose(decision.id, [id]);
  }
  b.setProgress(2);
  const invocations = b.getState().decisions.find((d) => d.candidates.includes(agonizing.id));
  assert.ok(invocations, 'a level 2 decision offers Agonizing Blast to a warlock without Eldritch Blast');
  const notes = b.softNotesFor(invocations.id);
  assert.equal(notes.get(agonizing.id), 'Needs Eldritch Blast, which this character does not have');
  t.diagnostic(`${invocations.label}: ${notes.size} of ${invocations.candidates.length} offered with a warning`);
  for (const [id] of notes) {
    const missing = terms(elements.get(id)!.requirements).filter(([term, under]) => !under && !b.getState().derived.elementIds.has(term));
    assert.ok(
      missing.some(([term]) => kind.softRequirements!.types.includes(elements.get(term)?.type ?? '')),
      `${elements.get(id)!.name} is warned for a soft term`,
    );
  }

  const cantrips = b.getState().decisions.find((d) => d.candidates.includes(blast.id));
  assert.ok(cantrips, 'Eldritch Blast is offered as a cantrip');
  b.choose(cantrips.id, [...cantrips.chosen, blast.id]);
  const after = b.getState().decisions.find((d) => d.candidates.includes(agonizing.id));
  assert.ok(after, 'still offered once the cantrip is taken');
  assert.equal(b.softNotesFor(after.id).has(agonizing.id), false, 'and no longer warned');
});
