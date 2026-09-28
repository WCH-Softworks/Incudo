/**
 * Where a legendary creature's legendary actions, lair actions and regional effects come from — ADR 0065.
 *
 * The types are the ones the system's legendary kind adds to the NPC's, read off the two kinds and never spelled
 * here, and a sheet heading is a type's plural label, so nothing below names a type, a creature or a book.
 *
 * What is reported and not asserted (ADR 0042: a moving corpus fails only what must hold against any corpus): how
 * many elements of those types the corpus declares, how many creature setters and grants name one, and how many
 * prose stat blocks carry a heading for one and print a cost. At c28ce6c every count is 0 except the prose: seven
 * stat blocks with a Legendary Actions heading, none with a lair or regional heading, and none printing a cost.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCharacterKind, type Element, type GameSystem } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusSkip, realElements } from './real-data.ts';

const skip = corpusSkip;

/** The types the legendary kind has and the NPC does not, as the system declares them. */
function legendaryTypes(system: GameSystem) {
  const npc = resolveCharacterKind(system, 'npc');
  const legendary = resolveCharacterKind(system, 'legendary');
  const own = legendary.elementTypes.filter((type) => !npc.elementTypes.includes(type));
  return own.map((name) => {
    const def = system.elementTypes.find((t) => t.name === name);
    return { name, heading: def?.plural ?? name };
  });
}

/** The text of every `<h…>` heading in an element's description, as a stat block prints it. */
function headings(element: Element): string[] {
  return [...(element.description ?? '').matchAll(/<h\d[^>]*>([^<]*)<\/h\d>/g)].map((m) => m[1]!.trim());
}

test('what the corpus holds for the types a legendary creature adds', { skip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const types = legendaryTypes(system);
  assert.ok(types.length > 0, 'the legendary kind adds types of its own to the NPC');
  const names = new Set(types.map((type) => type.name));

  // Declared as elements, and named by anything as something a holder has: a setter or a grant.
  const declared = new Map(types.map((type) => [type.name, elements.byType(type.name).length]));
  let namedBySetter = 0;
  let namedByGrant = 0;
  for (const element of elements.all()) {
    for (const setter of Object.values(element.setters)) {
      for (const id of String(setter.value ?? '').split(',')) {
        const named = elements.get(id.trim());
        if (named && names.has(named.type)) namedBySetter++;
      }
    }
    for (const rule of element.rules) {
      if (rule.kind !== 'grant') continue;
      const named = elements.get(rule.id);
      if ((named && names.has(named.type)) || (rule.type !== undefined && names.has(rule.type))) namedByGrant++;
    }
  }
  for (const type of types) t.diagnostic(`${type.name}: ${declared.get(type.name)} elements declared`);
  t.diagnostic(`named by a setter: ${namedBySetter}; granted: ${namedByGrant}`);

  // Written as prose: a description carrying the heading a stat block prints for the type, and whether that
  // section prints a cost ("Costs 2 Actions", the 2014 books' way of pricing one).
  for (const type of types) {
    const blocks = [...elements.all()].filter((element) => headings(element).includes(type.heading));
    const kinds = [...new Set(blocks.map((element) => element.type))].join(', ') || 'none';
    const priced = blocks.filter((element) => {
      const text = element.description ?? '';
      const from = text.indexOf(`>${type.heading}<`);
      const section = text.slice(from, text.indexOf('<h', from + 1) >= 0 ? text.indexOf('<h', from + 1) : undefined);
      return /Costs \d+ Actions?/i.test(section);
    });
    // How many uses a section prints ("Uses: 3", "Uses: 3 (4 in Lair)"), read only to be counted here.
    const uses = blocks.map((element) => /Uses: (\d+)( \([^)]*\))?/.exec(element.description ?? '')?.slice(1, 3).join('') ?? '?');
    const tally = [...new Set(uses)].map((u) => `${uses.filter((x) => x === u).length} × ${u}`).join(', ') || 'none';
    t.diagnostic(
      `"${type.heading}" as a heading in prose: ${blocks.length} (of type ${kinds}), ${priced.length} printing a cost; uses printed: ${tally}`,
    );
  }

  // What must hold against any corpus: the legendary creature's steps for these types offer exactly what is
  // declared of them, so a corpus that gains some has them offered, and one with none offers nothing.
  const kind = resolveCharacterKind(system, 'legendary');
  const steps = kind.buildSteps.filter((step) => step.types.some((type) => names.has(type)));
  assert.ok(steps.length > 0, 'the legendary kind has a step for its own types');
  const state = new CharacterBuilder(newCharacterOfKind(system, 'legendary'), system, elements).getState();
  for (const step of steps) {
    const offered = state.decisions.find((d) => d.stepId === step.id)?.candidates ?? [];
    const declaredOfStep = step.types.flatMap((type) => elements.byType(type)).filter((e) => e.requirements === undefined);
    for (const element of declaredOfStep) assert.ok(offered.includes(element.id), `${step.id} offers ${element.id}`);
    t.diagnostic(`step "${step.label}": ${offered.length} offered to a fresh legendary creature`);
  }
});
