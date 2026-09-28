/**
 * An element's own requirements hold it as well as offer it — ADR 0071.
 *
 * No game in the fixture. A wanderer's Path grants an Old Gift, which carries `!MARK` on itself: "unless the character
 * has the mark". A Relic grants the mark and a New Gift, as a replacing item grants a marker and the new feature. The
 * Old Gift's own select was answered with a Token. A Wayfarer asks the held types (held-types.test.ts) for a Path.
 * Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, setAdded, setChoice, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { parseRequirements } from './requirements.ts';
import type { GameSystem } from './system.ts';

function element(id: string, type: string, rules: Rule[] = [], requirements?: string): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    requirements: parseRequirements(requirements),
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const grant = (id: string): Rule => ({ kind: 'grant', key: `g:${id}`, type: 'Gift', id });
const fury = (value: number): Rule => ({ kind: 'stat', key: `fury:${value}`, name: 'fury', value: { kind: 'number', value } });

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test System',
  version: '1.0.0',
  elementTypes: [{ name: 'Path' }, { name: 'Gift' }, { name: 'Relic' }, { name: 'Token' }, { name: 'Mark' }],
  stats: [{ name: 'fury', default: 0 }],
  characterKinds: [
    {
      id: 'wanderer',
      name: 'Wanderer',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Path', 'Gift', 'Relic', 'Token', 'Mark'],
      heldTypesStat: 'kinds',
      additions: { types: ['Gift'] },
      buildSteps: [],
      sheet: { sections: [] },
    },
  ],
};

const echo = element('ECHO', 'Gift', [fury(10)]);
const oldGift = element(
  'OLD_GIFT',
  'Gift',
  [fury(2), grant('ECHO'), { kind: 'select', key: 'select:Charm', type: 'Token', name: 'Charm', number: 1 }],
  '!MARK',
);
const token = element('TOKEN', 'Token', [fury(100)]);
const newGift = element('NEW_GIFT', 'Gift', [fury(1000)]);
const mark = element('MARK', 'Mark');
const path = element('PATH', 'Path', [grant('OLD_GIFT')]);
const relic = element('RELIC', 'Relic', [grant('MARK'), grant('NEW_GIFT')]);
// A second granter of the old gift, so `withdrawn` names every one.
const shrine = element('SHRINE', 'Relic', [grant('OLD_GIFT')]);
// Held only by a Path holder: asks the held types, which the first pass, with nothing held, reads as no Path.
const wayfarer = element('WAYFARER', 'Gift', [fury(3)], '[kinds:path]');
const beacon = element('BEACON', 'Relic', [grant('WAYFARER')]);
// Two granted elements that rule each other in and out, which never settles.
const ebb = element('EBB', 'Gift', [], '!FLOW');
const flow = element('FLOW', 'Gift', [], 'EBB');
const tide = element('TIDE', 'Relic', [grant('EBB'), grant('FLOW')]);
// "Unless the character already has this one", on itself, as content writes a feat that cannot be taken twice.
const lone = element('LONE', 'Gift', [fury(7)], '!LONE');
const hermit = element('HERMIT', 'Relic', [grant('LONE')]);

const index = new MapElementIndex();
index.addAll([echo, oldGift, token, newGift, mark, path, relic, shrine, wayfarer, beacon, ebb, flow, tide, lone, hermit]);

function wanderer(chosen: string[], answers: Record<string, string[]> = {}): Character {
  let character = createCharacter('test', 'wanderer');
  for (const [n, id] of chosen.entries()) character = setChoice(character, `build/pick${n}`, [id]);
  for (const [key, ids] of Object.entries(answers)) character = setChoice(character, key, ids);
  return character;
}

test('a granted element whose own requirement is false is withdrawn, with what granted it, and reaches nothing', () => {
  // Fails if the engine does not read a granted element's own requirements (OLD_GIFT, ECHO held; fury 1012 + 12).
  const derived = deriveCharacter(wanderer(['PATH', 'RELIC']), system, index);
  assert.equal(derived.elementIds.has('OLD_GIFT'), false);
  assert.equal(derived.elementIds.has('ECHO'), false, 'what the withdrawn element grants is not reached');
  assert.ok(derived.elementIds.has('NEW_GIFT'));
  assert.equal(derived.stats.get('fury')?.value, 1000, 'its rules apply to nothing');
  assert.deepEqual(derived.withdrawn, [{ elementId: 'OLD_GIFT', grantedBy: ['PATH'] }]);
  assert.deepEqual(derived.problems, [], 'a withdrawal is not a problem');
});

test('without the element its requirement negates, the granted element is held and nothing is withdrawn', () => {
  // Fails if a granted element is withdrawn whatever its requirements say (OLD_GIFT is not held).
  const derived = deriveCharacter(wanderer(['PATH']), system, index);
  assert.ok(derived.elementIds.has('OLD_GIFT'));
  assert.ok(derived.elementIds.has('ECHO'));
  assert.equal(derived.stats.get('fury')?.value, 12);
  assert.deepEqual(derived.withdrawn, []);
});

test('an element asked its own requirements counts itself as not held', () => {
  // Fails if the element itself is counted as held (LONE is withdrawn, or the derivation never settles).
  const derived = deriveCharacter(wanderer(['HERMIT']), system, index);
  assert.ok(derived.elementIds.has('LONE'));
  assert.equal(derived.stats.get('fury')?.value, 7);
  assert.deepEqual(derived.withdrawn, []);
  assert.deepEqual(derived.problems, []);
});

test('every granter of a withdrawn element is named', () => {
  // Fails if only the first grant edge is recorded.
  const derived = deriveCharacter(wanderer(['PATH', 'SHRINE', 'RELIC']), system, index);
  assert.deepEqual(derived.withdrawn.map((w) => ({ ...w, grantedBy: [...w.grantedBy].sort() })), [
    { elementId: 'OLD_GIFT', grantedBy: ['PATH', 'SHRINE'] },
  ]);
});

test('the same element chosen, or added, is held whatever its own requirements say', () => {
  // Fails if seeds are withdrawn too (OLD_GIFT goes, and fury loses its 2 and ECHO's 10).
  const chosen = deriveCharacter(wanderer(['PATH', 'RELIC', 'OLD_GIFT']), system, index);
  assert.ok(chosen.elementIds.has('OLD_GIFT'));
  assert.ok(chosen.elementIds.has('ECHO'));
  assert.deepEqual(chosen.withdrawn, []);

  const added = deriveCharacter(setAdded(wanderer(['PATH', 'RELIC']), 'OLD_GIFT', true), system, index);
  assert.ok(added.elementIds.has('OLD_GIFT'));
  assert.deepEqual(added.withdrawn, []);
});

test("a recorded answer under a withdrawn element's select is not held while it is withdrawn, and is again when it is not", () => {
  // Fails if a withdrawn element's recorded answers still seed the derivation (TOKEN held beside the relic).
  const answers = { 'OLD_GIFT/select:Charm': ['TOKEN'] };
  const withRelic = wanderer(['PATH', 'RELIC'], answers);
  const derived = deriveCharacter(withRelic, system, index);
  assert.equal(derived.elementIds.has('TOKEN'), false);
  assert.equal(derived.stats.get('fury')?.value, 1000);
  assert.deepEqual(
    derived.character.choices.find((c) => c.ruleKey === 'OLD_GIFT/select:Charm')?.elementIds,
    ['TOKEN'],
    'the record stays',
  );

  const without = deriveCharacter(wanderer(['PATH'], answers), system, index);
  assert.ok(without.elementIds.has('TOKEN'));
  assert.equal(without.stats.get('fury')?.value, 112);
});

test('an answer the withdrawn element shares with an open pool is still held', () => {
  // Fails if closing a pool drops an element another recorded choice also names.
  const derived = deriveCharacter(
    wanderer(['PATH', 'RELIC'], { 'OLD_GIFT/select:Charm': ['TOKEN'], 'build/extra': ['TOKEN'] }),
    system,
    index,
  );
  assert.ok(derived.elementIds.has('TOKEN'));
});

test('granted elements that rule each other in and out do not settle, and say so', () => {
  // Fails if the derivation reports settling when the withdrawals never do (no cycle-limit problem).
  const derived = deriveCharacter(wanderer(['TIDE']), system, index);
  assert.ok(derived.problems.some((p) => p.code === 'cycle-limit'));
});

test('a withdrawal is asked afresh each pass, so what the first pass withdraws a later one holds', () => {
  // Fails if a withdrawal is kept from one pass to the next: the first pass asks with nothing held, reads no Path among
  // the held types, and withdraws WAYFARER, which a Path holder has.
  const derived = deriveCharacter(wanderer(['PATH', 'BEACON']), system, index);
  assert.ok(derived.elementIds.has('WAYFARER'));
  assert.deepEqual(derived.withdrawn, []);

  // Without a Path it stays withdrawn: its requirement reads what is held.
  const pathless = deriveCharacter(wanderer(['BEACON']), system, index);
  assert.equal(pathless.elementIds.has('WAYFARER'), false);
  assert.deepEqual(pathless.withdrawn, [{ elementId: 'WAYFARER', grantedBy: ['BEACON'] }]);
});
