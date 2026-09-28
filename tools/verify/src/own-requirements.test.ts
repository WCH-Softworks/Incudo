/**
 * An element's own requirements hold it as well as offer it, against the real corpus — ADR 0071.
 *
 * Two cases the ADR names. A 2014 Ranger who equips Tasha's Deft Explorer item holds Deft Explorer and not Natural
 * Explorer, whose own requirements say "unless the replacement marker is held"; carried rather than equipped, the item
 * does nothing and Natural Explorer is back, with its recorded answer. And a level 4 2024 Fighter's feat choice offers
 * the 2024 Ability Score Improvement feat, which requires Aurora's `[character:4]`: read as nothing before, so the
 * choice offered none of the book's general feats.
 *
 * Built by name: the 2014 Ranger, the 2024 Human and Fighter, and the Deft Explorer item by its id. What the item
 * replaces is found from content, as the element whose own requirements negate a marker the item grants.
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

test('a 2014 Ranger who equips Deft Explorer holds it and not Natural Explorer, and carried it is the reverse', { skip: corpusSkip }, async (t) => {
  // Fails if a granted element's own requirements are not read once it is held (Natural Explorer held beside Deft
  // Explorer), if an unequipped item's grants count (Natural Explorer gone while the item is only carried), or if the
  // answer to Natural Explorer's select still seeds while it is withdrawn.
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const kind = resolveCharacterKind(system, 'pc');
  const ranger = elements.byType('Class').find((c) => c.name === 'Ranger' && c.source === 'Player’s Handbook');
  const item = elements.get('ID_WOTC_TCOE_ITEM_OCF_RANGER_DEFT_EXPLORER');
  if (!ranger || !item) return void t.skip('the 2014 Ranger or the Deft Explorer item is not in this corpus');

  const itemGrants = item.rules.flatMap((r) => (r.kind === 'grant' ? [r.id] : []));
  const rangerGrants = new Set(ranger.rules.flatMap((r) => (r.kind === 'grant' ? [r.id] : [])));
  const replaced = [...elements.all()].filter(
    (e) => rangerGrants.has(e.id) && [...negatedIds(e.requirements)].some((id) => itemGrants.includes(id)),
  );
  assert.equal(replaced.length, 1, `one Ranger feature the item replaces, found ${replaced.map((e) => e.name).join(', ')}`);
  const natural = replaced[0]!;
  const deft = itemGrants.map((id) => elements.get(id)).find((e): e is Element => e?.type === 'Class Feature');
  assert.ok(deft, 'the item grants a class feature');
  t.diagnostic(`the item grants ${deft.name} and replaces ${natural.name}`);

  // An answer recorded under Natural Explorer's own select, as a character that took it before equipping the item has:
  // what the derivation offers there with the item carried, and nothing chosen yet.
  let character = setChoice(newCharacterOfKind(system, 'pc'), 'build/class', [ranger.id]);
  const carry = (c: typeof character, on: boolean) => setInventoryEntry(c, { instanceId: '1', elementId: item.id, equipped: on });
  const open = deriveCharacter(carry(character, false), system, elements, { kind }).pendingChoices.find((c) => c.from === natural.id);
  assert.ok(open?.candidates.length, `${natural.name} opens a select with something to choose`);
  const ruleKey = open.ruleKey;
  const answer = open.candidates[0]!;
  character = setChoice(character, ruleKey, [answer]);
  const equipped = carry(character, true);
  const carried = carry(character, false);

  const withItem = deriveCharacter(equipped, system, elements, { kind });
  assert.ok(withItem.elementIds.has(deft.id), `${deft.name} is held with the item equipped`);
  assert.equal(withItem.elementIds.has(natural.id), false, `${natural.name} is not held with the item equipped`);
  assert.equal(withItem.elementIds.has(answer), false, 'nor is what its select was answered with');
  assert.deepEqual(withItem.withdrawn, [{ elementId: natural.id, grantedBy: [ranger.id] }]);
  assert.equal(withItem.problems.filter((p) => p.elementId === natural.id).length, 0, 'a withdrawal is not a problem');
  assert.deepEqual(withItem.character.choices.find((c) => c.ruleKey === ruleKey)?.elementIds, [answer], 'the record stays');

  const onlyCarried = deriveCharacter(carried, system, elements, { kind });
  assert.ok(onlyCarried.elementIds.has(natural.id), `${natural.name} is held with the item carried`);
  assert.ok(onlyCarried.elementIds.has(answer), 'and its answer counts again');
  assert.equal(onlyCarried.elementIds.has(deft.id), false, `${deft.name} is not held with the item carried`);
  assert.deepEqual(onlyCarried.withdrawn, []);
});

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
