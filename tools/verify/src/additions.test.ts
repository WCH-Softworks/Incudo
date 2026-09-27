/**
 * Every element of every type 5e lets be added, put on a player character and on an NPC — ADR 0064.
 *
 * Found by the kind's own declaration and the corpus's types, never by name or count. What must hold against any
 * corpus is asserted: each element is offered whatever its prerequisites, is held once added, is flagged exactly when
 * its own requirements fail (asked as before it was added), and a character holding every element of a type saves
 * and reopens with no source to the same derivation. How many there are, how many carry prerequisites and how many a
 * fresh character does not meet move with the corpus and are reported as ℹ lines (ADR 0042).
 *
 * Perturbations that fail this file, each checked: removing a kind's `additions` from systems/dnd5e/system.json
 * (nothing is offered or held), leaving additions out of `collectCharacterContent` (the reopened character loses
 * them), and filtering the offer by requirements (most feats go missing). The engine's own rules are held in
 * `packages/core/src/additions.test.ts` and the builder's in `packages/ui/src/additions.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  deriveCharacter,
  evaluateRequirements,
  readCharacterContainer,
  requirementContextFor,
  resolveCharacterKind,
  setAdded,
  validateGameSystem,
  type Character,
  type GameSystem,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter } from '@incudo/ui';

import { loadSchemas } from './node-system.ts';
import { corpusSkip, realElements } from './real-data.ts';
import { summarize } from './derived-summary.ts';

const skip = corpusSkip;

async function fiveE(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

const NAMES: Record<string, string> = { pc: 'a player character', npc: 'an NPC' };

for (const kindId of ['pc', 'npc']) {
  const who = NAMES[kindId]!;
  test(`every element of every type ${who} may be given is offered, held, and flagged exactly when its prerequisites fail`, { skip }, async (t) => {
    const system = await fiveE();
    const elements = await realElements();
    const kind = resolveCharacterKind(system, kindId);
    const types = kind.additions?.types ?? [];
    assert.ok(types.length > 0, `the ${kindId} declares what may be added`);

    const fresh = newCharacterOfKind(system, kindId);
    const builder = new CharacterBuilder(fresh, system, elements);
    const freshDerived = builder.getState().derived;

    for (const type of types) {
      const all = elements.byType(type);
      assert.ok(all.length > 0, `the corpus has ${type} elements`);
      const options = builder.additionOptionsFor(type);
      const offered = new Map(options.map((o) => [o.elementId, o]));
      const expected = all.filter((e) => !freshDerived.elementIds.has(e.id)).map((e) => e.id);
      assert.deepEqual([...offered.keys()].sort(), [...new Set(expected)].sort(), `every ${type} is offered, whatever it requires`);

      let withRequirements = 0;
      let flagged = 0;
      let offerDisagrees = 0;
      const wrong: string[] = [];
      for (const element of all) {
        if (freshDerived.elementIds.has(element.id)) continue;
        if (element.requirements) withRequirements++;
        const derived = deriveCharacter(setAdded(fresh, element.id, true), system, elements, { kind });
        if (!derived.elementIds.has(element.id)) wrong.push(`${element.id} is not held`);
        if (derived.problems.some((p) => p.code === 'addition-not-allowed')) wrong.push(`${element.id} is refused`);
        const context = requirementContextFor(derived);
        const unmet = !evaluateRequirements(element.requirements, {
          ...context,
          hasElement: (id) => id !== element.id && context.hasElement(id),
        });
        const reported = derived.problems.some((p) => p.code === 'requirement-unmet' && p.elementId === element.id);
        if (reported !== unmet) wrong.push(`${element.id} is ${reported ? '' : 'not '}flagged`);
        if (reported) flagged++;
        if (reported === offered.get(element.id)?.prerequisitesMet) offerDisagrees++;
      }
      assert.deepEqual(wrong, [], `${type}: each is held and flagged exactly when its requirements fail`);
      t.diagnostic(
        `${kindId} ${type}: ${all.length} in the corpus, ${withRequirements} with requirements, ${flagged} flagged on a new one` +
          (offerDisagrees ? `; ${offerDisagrees} where the offer's answer differs once the element is held` : ''),
      );
    }
  });

  test(`${who} holding every element of a type saves and reopens with no source to the same derivation`, { skip }, async (t) => {
    const system = await fiveE();
    const elements = await realElements();
    const kind = resolveCharacterKind(system, kindId);
    const fresh = newCharacterOfKind(system, kindId);
    let embedded = 0;
    const types = kind.additions?.types ?? [];
    assert.ok(types.length > 0, `the ${kindId} declares what may be added`);
    for (const type of types) {
      let character: Character = fresh;
      for (const element of elements.byType(type)) character = setAdded(character, element.id, true);
      assert.equal(character.formatVersion, 5);
      const { container, problems } = readCharacterContainer(packCharacter(character, system, elements, { generator: 'test' }).files);
      assert.deepEqual(problems.filter((p) => p.level === 'error'), [], `${type}: the save reads`);
      assert.deepEqual(container!.character.additions, character.additions, `${type}: the additions are saved in order`);
      const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements), { kind });
      const original = deriveCharacter(character, system, elements, { kind });
      assert.deepEqual(summarize(reopened), summarize(original), `${type}: derives the same with no source`);
      embedded += container!.content.elements.length;
    }
    t.diagnostic(`${kindId}: ${embedded} elements embedded across one save per type`);
  });
}

test('what is added to a player character answers none of its race, class or background', { skip }, async () => {
  // Fails if an addition is recorded where a top-level pick looks for its answer, by what a record holds.
  const system = await fiveE();
  const elements = await realElements();
  const builder = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const openPicks = () => builder.getState().decisions.filter((d) => d.kind === 'pick' && d.blocking).map((d) => d.stepId);
  const before = openPicks();
  assert.ok(before.length > 0);
  const types = builder.getState().additions.types;
  assert.ok(types.length > 0, 'the player character declares what may be added');
  for (const type of types) {
    const first = builder.additionOptionsFor(type.type)[0];
    if (first) assert.ok(builder.addElement(first.elementId), `${type.type} can be added`);
  }
  assert.equal(builder.getState().character.additions?.length, types.length);
  assert.deepEqual(openPicks(), before);
  assert.deepEqual(builder.getState().picks.filter((p) => before.includes(p.stepId)), []);
});
