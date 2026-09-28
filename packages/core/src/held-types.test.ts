/**
 * A kind may publish the types of what a character holds, as the tags of a stat it names — ADR 0071.
 *
 * No game in the fixture: a wanderer holds a Path and a Relic, and a requirement asks "holds a Path" as Aurora's
 * `[type:class]` asks "holds a Class". Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter, requirementContextFor } from './engine.ts';
import { createCharacter, setChoice } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { evaluateRequirements, parseRequirements } from './requirements.ts';
import { resolveCharacterKind, type GameSystem } from './system.ts';

function element(id: string, type: string, rules: Rule[] = []): Element {
  return { id, type, name: id, source: 'test', setters: {}, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test System',
  version: '1.0.0',
  elementTypes: [{ name: 'Path' }, { name: 'Relic' }, { name: 'Gift' }],
  stats: [{ name: 'fury', default: 0 }],
  characterKinds: [
    {
      id: 'wanderer',
      name: 'Wanderer',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Path', 'Relic', 'Gift'],
      heldTypesStat: 'Kinds',
      buildSteps: [],
      sheet: { sections: [] },
    },
  ],
};

// A relic whose rule counts only for a Path holder, the way a rule's own requirements are read.
const relic = element('RELIC', 'Relic', [
  { kind: 'stat', key: 'r', name: 'fury', value: { kind: 'number', value: 3 }, requirements: parseRequirements('[kinds:path]') },
]);
const index = new MapElementIndex();
index.addAll([element('PATH', 'Path'), relic]);

function wanderer(chosen: string[]) {
  let character = createCharacter('test', 'wanderer');
  for (const [n, id] of chosen.entries()) character = setChoice(character, `build/pick${n}`, [id]);
  return character;
}

test('the named stat publishes the type of every held element, lowercased, and a requirement reads it by membership', () => {
  // Fails if the held types are not published as the stat's tags (the relic's rule does not count; fury 0).
  const derived = deriveCharacter(wanderer(['PATH', 'RELIC']), system, index);
  assert.equal(derived.stats.get('fury')?.value, 3);
  const ctx = requirementContextFor(derived);
  assert.deepEqual([...(ctx.statTags?.('KINDS') ?? [])].sort(), ['path', 'relic']);
  assert.equal(evaluateRequirements(parseRequirements('[kinds:path]'), ctx), true);
  assert.equal(evaluateRequirements(parseRequirements('[kinds:gift]'), ctx), false, 'a type nothing held has');

  // What is held, not what could be: without the Path the rule does not count.
  assert.equal(deriveCharacter(wanderer(['RELIC']), system, index).stats.get('fury')?.value, 0);
});

test('a kind that names no held-types stat reads such a check as before, a string nothing publishes', () => {
  // Fails if core answers a stat the kind did not name, by default or by 5e's word (`type`).
  const bare: GameSystem = { ...system, characterKinds: [{ ...system.characterKinds[0]!, heldTypesStat: undefined }] };
  const derived = deriveCharacter(wanderer(['PATH', 'RELIC']), bare, index, { kind: resolveCharacterKind(bare, 'wanderer') });
  assert.equal(derived.stats.get('fury')?.value, 0);
  const ctx = requirementContextFor(derived);
  for (const stat of ['kinds', 'type']) {
    assert.equal(ctx.statTags?.(stat), undefined);
    assert.equal(evaluateRequirements(parseRequirements(`[${stat}:path]`), ctx), false);
  }
});
