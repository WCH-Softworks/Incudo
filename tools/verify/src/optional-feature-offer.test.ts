/**
 * What the optional class features step would offer each class, if it offered only what concerns the character —
 * measured before the step was narrowed.
 *
 * ADR 0072's step offers all 36 of Tasha's optional class features to every character, before a class is chosen too
 * (`optional-features.test.ts` has the census). None carries requirements of its own; each grant is gated on a class
 * level (`level:ranger >= 1`), and one on holding a subclass (`has` the Beast Master). So a rule that names no game could
 * narrow the offer: **an element is offered when one of its grants is gated, in a term not under a `not`, on something
 * the character has** — a stat it publishes above zero, or an element it holds.
 *
 * Reported per class element (both editions, by name and source), at level 1 and 20 of that class alone: how many items
 * the rule offers, and how many of those name a class stat other than the class's own (which would be the rule
 * offering another class's feature). Then a character with no class, a two-class character, and a Beast Master.
 *
 * Report-only (ADR 0042) on the commit before the step was narrowed. The rule is written here as well as in the product
 * so the measurement does not depend on it. Since ADR 0081 the last test asserts, through the builder and against any
 * corpus, that the step offers nothing before a class and only the class's own features after.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { requirementContextFor, type Element, type GrantRule, type RequirementContext, type RequirementExpr } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const CATEGORY = 'Optional Class Features';
const isFeature = (e: Element): boolean => e.setters['category']?.value === CATEGORY;
const grantsOf = (e: Element): GrantRule[] => e.rules.filter((r): r is GrantRule => r.kind === 'grant');

/** Whether a term of the expression, not under a `not`, names something the character has. */
function concerns(expr: RequirementExpr | undefined, ctx: RequirementContext): boolean {
  if (!expr) return false;
  switch (expr.kind) {
    case 'and':
    case 'or':
      return expr.children.some((child) => concerns(child, ctx));
    case 'has':
      return ctx.hasElement(expr.id);
    case 'atLeast':
      return ctx.statNumber(expr.stat) > 0;
    default:
      return false;
  }
}

/** The class stats a feature's grants are gated on. */
function classStats(e: Element): Set<string> {
  const out = new Set<string>();
  const walk = (expr: RequirementExpr | undefined): void => {
    if (!expr) return;
    if (expr.kind === 'and' || expr.kind === 'or') expr.children.forEach(walk);
    if (expr.kind === 'not') walk(expr.child);
    if (expr.kind === 'atLeast' && expr.stat.startsWith('level:')) out.add(expr.stat);
  };
  for (const g of grantsOf(e)) walk(g.requirements);
  return out;
}

test('optional class features a rule of "gated on what the character has" would offer', { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const features = elements.byType('Item').filter(isFeature);
  assert.ok(features.length > 0, 'features were read');
  const offered = (b: CharacterBuilder): Element[] => {
    const ctx = requirementContextFor(b.getState().derived);
    return features.filter((f) => grantsOf(f).some((g) => concerns(g.requirements, ctx)));
  };
  const builder = (progress: number, classId?: string): CharacterBuilder => {
    const c = newCharacterOfKind(system, 'pc');
    c.progress = progress;
    const b = new CharacterBuilder(c, system, elements);
    if (classId) b.choose('build/class', [classId]);
    return b;
  };

  t.diagnostic(`features: ${features.length}; with no class, offered ${offered(builder(1)).length}`);
  let foreign = 0;
  const lines: string[] = [];
  for (const cls of elements.byType('Class')) {
    const own = `level:${cls.name.toLowerCase()}`;
    const at = [1, 20].map((level) => offered(builder(level, cls.id)));
    const other = at.flat().filter((f) => !classStats(f).has(own));
    foreign += other.length;
    lines.push(`${cls.name} (${cls.source}): ${at[0]!.length} at 1, ${at[1]!.length} at 20${other.length ? `; not its own: ${other.map((f) => f.name).join(', ')}` : ''}`);
  }
  t.diagnostic(`class elements: ${lines.length}; offered features naming another class: ${foreign}`);
  for (const line of lines) t.diagnostic(`  ${line}`);

  // A Fighter 4 / Wizard 1, and a level 3 Beast Master, by name: the two cases a class alone does not settle.
  const fighter = elements.byType('Class').find((c) => c.name === 'Fighter' && /Player.s Handbook$/.test(c.source ?? ''));
  const wizard = elements.byType('Class').find((c) => c.name === 'Wizard' && /Player.s Handbook$/.test(c.source ?? ''));
  if (fighter && wizard) {
    const b = builder(5, fighter.id);
    b.applySplit('levels', [{ classId: fighter.id, levels: 4 }, { classId: wizard.id, levels: 1 }]);
    t.diagnostic(`Fighter 4 / Wizard 1: ${offered(b).map((f) => f.name).join('; ')}`);
  }
  const ranger = elements.byType('Class').find((c) => c.name === 'Ranger' && /Player.s Handbook$/.test(c.source ?? ''));
  const beastMaster = elements.byType('Archetype').find((a) => a.name === 'Beast Master' && /Player.s Handbook$/.test(a.source ?? ''));
  if (ranger && beastMaster) {
    const b = builder(3, ranger.id);
    const before = offered(b).some((f) => /Primal Companion/.test(f.name));
    const subclass = b.getState().decisions.find((d) => d.candidates.includes(beastMaster.id));
    if (subclass) b.choose(subclass.id, [beastMaster.id]);
    t.diagnostic(`Ranger 3: Primal Companion offered ${before ? 'before' : 'not before'} the subclass, ${offered(b).some((f) => /Primal Companion/.test(f.name)) ? 'and' : 'and not'} once Beast Master is chosen${subclass ? '' : ' (no decision offered it)'}`);
  }
});

// ADR 0081. Fails if 5e's step loses `gatedOnHeld` (every class is offered all of them, and so is a character with no
// class), or if the builder offers from anything but `equipOffer`.
test("the optional class features step offers nothing before a class, and a class only its own", { skip: corpusSkip }, async () => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const offer = (b: CharacterBuilder): string[] => b.getState().decisions.find((d) => d.stepId === 'optional-features')?.candidates ?? [];
  const fresh = (classId?: string): CharacterBuilder => {
    const c = newCharacterOfKind(system, 'pc');
    const b = new CharacterBuilder(c, system, elements);
    if (classId) b.choose('build/class', [classId]);
    return b;
  };
  assert.deepEqual(offer(fresh()), [], 'no class, no offer');
  let offered = 0;
  for (const cls of elements.byType('Class')) {
    const own = `level:${cls.name.toLowerCase()}`;
    const ids = offer(fresh(cls.id));
    offered += ids.length;
    for (const id of ids) assert.ok(classStats(elements.get(id)!).has(own), `${cls.name} (${cls.source}) is offered ${elements.get(id)!.name}`);
  }
  assert.ok(offered > 0, 'some class is offered some feature');
});
