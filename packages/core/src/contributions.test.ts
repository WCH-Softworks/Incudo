/**
 * A character kind may contribute a stat, and may say when — ADR 0022.
 *
 * The fixture has no game in it. "carapace", "sprint" and "bonded" are this fixture's words the
 * way "armor" and "attunement" are 5e's; core knows none of them, and these tests exist partly
 * to prove that by using different ones.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, type Character, type InventoryEntry } from './character.ts';
import { MapElementIndex, type Element, type Rule, type Setter } from './model.ts';
import type { ContributionDef, GameSystem, InventoryDef } from './system.ts';

function thing(
  id: string,
  name: string,
  setters: Record<string, string> = {},
  rules: Rule[] = [],
): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return {
    id,
    type: 'Thing',
    name,
    source: 'test',
    setters: out,
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const inventory: InventoryDef = {
  slotSetter: 'worn',
  occupiedTag: 'any',
  emptyTag: 'none',
  tagSetters: ['weight class'],
  slots: [{ id: 'torso', stats: ['carapace'] }, { id: 'pocket' }],
  attunement: {
    setter: 'bonded',
    requires: 'yes',
    countStat: 'bonds:current',
    maxStat: 'bonds:max',
  },
};

function system(contributions: ContributionDef[]): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Thing' }],
    stats: [
      { name: 'sprint', default: 0 },
      { name: 'carapace', kind: 'string' },
      { name: 'bonds:current', default: 0 },
      { name: 'bonds:max', default: 0 },
    ],
    characterKinds: [
      {
        id: 'crawler',
        name: 'Crawler',
        default: true,
        progression: { kind: 'level', min: 1, max: 20 },
        elementTypes: ['Thing'],
        contributions,
        inventory,
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

function bag(...entries: InventoryEntry[]): Character {
  return { ...createCharacter('test', 'crawler'), inventory: entries };
}

function indexWith(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll(elements);
  return index;
}

const SHELL = thing('SHELL', 'Chitin Shell', { worn: 'torso', 'weight class': 'thick' }, [
  { kind: 'stat', key: 'r', name: 'sprint', value: { kind: 'number', value: 20 } },
]);

test('an unconditional contribution lands, and content adds to it', () => {
  const index = indexWith(
    thing('BOOTS', 'Fast Boots', {}, [
      { kind: 'stat', key: 'r', name: 'sprint', value: { kind: 'number', value: 5 } },
    ]),
  );
  const character = { ...createCharacter('test', 'crawler'), choices: [{ ruleKey: 's', elementIds: ['BOOTS'] }] };

  const kindOnly = deriveCharacter(bag(), system([
    { stat: 'sprint', value: { kind: 'number', value: 30 } },
  ]), index);
  assert.equal(kindOnly.stats.get('sprint')?.value, 30);

  const withContent = deriveCharacter(character, system([
    { stat: 'sprint', value: { kind: 'number', value: 30 } },
  ]), index);
  assert.equal(withContent.stats.get('sprint')?.value, 35);
});

test('a contribution fires only while its requirements hold, and reads the slots', () => {
  const index = indexWith(SHELL);
  const contributions: ContributionDef[] = [
    { stat: 'sprint', value: { kind: 'number', value: 30 }, requirements: '[carapace:none]' },
    { stat: 'sprint', value: { kind: 'number', value: 10 }, requirements: '[carapace:thick]' },
  ];

  const bare = deriveCharacter(bag(), system(contributions), index);
  assert.equal(bare.stats.get('sprint')?.value, 30);

  // Shelled: the first condition goes false and the second true, so the contribution that
  // applies changes rather than both applying or neither. The shell's own 20 is on top.
  const shelled = deriveCharacter(
    bag({ instanceId: 'a', elementId: 'SHELL', equipped: true }),
    system(contributions),
    index,
  );
  assert.equal(shelled.stats.get('sprint')?.value, 30);
  assert.deepEqual(
    shelled.stats.get('sprint')?.contributions.map((c) => [c.from, c.value]).sort(),
    [['SHELL', 20], ['kind', 10]],
  );
});

test('a contribution joins content in the same bonus bucket rather than stacking on it', () => {
  // The mechanism 5e's Dexterity cap needs: the kind writes 2 and a feat writes 3, and the
  // answer is 3. Summing these afterwards would read 5, which is why contributions are added
  // to the buckets rather than applied after them.
  const feat = thing('FEAT', 'Broad Shoulders', {}, [
    { kind: 'stat', key: 'r', name: 'sprint', value: { kind: 'number', value: 3 }, bonus: 'base' },
  ]);
  const contributions: ContributionDef[] = [
    { stat: 'sprint', value: { kind: 'number', value: 2 }, bonus: 'base' },
  ];

  const without = deriveCharacter(bag(), system(contributions), indexWith(feat));
  assert.equal(without.stats.get('sprint')?.value, 2);

  const with_ = deriveCharacter(
    { ...createCharacter('test', 'crawler'), choices: [{ ruleKey: 's', elementIds: ['FEAT'] }] },
    system(contributions),
    indexWith(feat),
  );
  assert.equal(with_.stats.get('sprint')?.value, 3);
});

test('a contribution can be read by a derivation, because it lands before one', () => {
  const derived = system([{ stat: 'sprint', value: { kind: 'number', value: 30 } }]);
  derived.stats.push({ name: 'sprint:doubled', derive: { kind: 'binary', op: '*', left: { kind: 'ref', stat: 'sprint' }, right: { kind: 'number', value: 2 } } });
  const d = deriveCharacter(bag(), derived, indexWith());
  assert.equal(d.stats.get('sprint:doubled')?.value, 60);
});

test('a requirements expression that will not parse contributes nothing, rather than everything', () => {
  // The system is invalid by this point — `validateGameSystem` refuses it — so this is the
  // engine's second line of defence. Reading a broken condition as *satisfied* would put a
  // number on the sheet nobody asked for, which is the worse of the two failures.
  const d = deriveCharacter(
    bag(),
    system([{ stat: 'sprint', value: { kind: 'number', value: 30 }, requirements: '[carapace:none' }]),
    indexWith(),
  );
  assert.equal(d.stats.get('sprint')?.value, 0);
});

// --- the attunement limit — ADR 0023 decision 3 ------------------------------

const RELIC = thing('RELIC', 'Humming Relic', { worn: 'pocket', bonded: 'yes' });
const ROPE = thing('ROPE', 'Rope', { worn: 'pocket' });

function bonded(count: number): Character {
  return bag(
    ...Array.from({ length: count }, (_, i) => ({
      instanceId: `r${i}`,
      elementId: 'RELIC',
      equipped: true,
      attuned: true,
    })),
  );
}

const LIMIT: ContributionDef[] = [{ stat: 'bonds:max', value: { kind: 'number', value: 3 }, bonus: 'base' }];

test('the count of attuned items is contributed to the stat the kind names', () => {
  const index = indexWith(RELIC, ROPE);
  assert.equal(deriveCharacter(bonded(0), system(LIMIT), index).stats.get('bonds:current')?.value, 0);
  assert.equal(deriveCharacter(bonded(2), system(LIMIT), index).stats.get('bonds:current')?.value, 2);

  // A flag ticked on something that needs no attunement is not an attunement. Counting it
  // would make a mundane rope eat one of three slots.
  const withRope = bag(
    { instanceId: 'a', elementId: 'RELIC', equipped: true, attuned: true },
    { instanceId: 'b', elementId: 'ROPE', equipped: true, attuned: true },
  );
  assert.equal(deriveCharacter(withRope, system(LIMIT), index).stats.get('bonds:current')?.value, 1);

  // Carried, not worn: the gate only ever looks at equipped entries.
  const carried = bag({ instanceId: 'a', elementId: 'RELIC', equipped: false, attuned: true });
  assert.equal(deriveCharacter(carried, system(LIMIT), index).stats.get('bonds:current')?.value, 0);
});

test('being over the limit is reported, and the derivation still completes', () => {
  const index = indexWith(RELIC);
  const at = deriveCharacter(bonded(3), system(LIMIT), index);
  assert.deepEqual(at.problems.filter((p) => p.code === 'over-attuned'), []);

  const over = deriveCharacter(bonded(4), system(LIMIT), index);
  const problem = over.problems.find((p) => p.code === 'over-attuned');
  assert.ok(problem, 'four bonds against a limit of three should be reported');
  assert.equal(problem.level, 'error');
  assert.match(problem.message, /4 items.*allows 3/);
  // Reported, never a refusal: the character is mid-edit and the stats are still there.
  assert.equal(over.stats.get('bonds:current')?.value, 4);
  assert.equal(over.stats.get('bonds:max')?.value, 3);
});

test('the limit is the derived one, so content raising it moves the report', () => {
  const savant = thing('SAVANT', 'Savant', {}, [
    { kind: 'stat', key: 'r', name: 'bonds:max', value: { kind: 'number', value: 5 }, bonus: 'base' },
  ]);
  const character = { ...bonded(4), choices: [{ ruleKey: 's', elementIds: ['SAVANT'] }] };
  const d = deriveCharacter(character, system(LIMIT), indexWith(RELIC, savant));
  // Largest-wins in the `base` bucket: the feature's 5 replaces the kind's 3 rather than
  // adding to it, which is the reading ADR 0023 chose and no sample save can confirm.
  assert.equal(d.stats.get('bonds:max')?.value, 5);
  assert.deepEqual(d.problems.filter((p) => p.code === 'over-attuned'), []);
});

test('a kind that names no limit stat is never reported, however many things it bonds', () => {
  const quiet = system(LIMIT);
  quiet.characterKinds[0]!.inventory = {
    ...inventory,
    attunement: { setter: 'bonded', requires: 'yes' },
  };
  const d = deriveCharacter(bonded(9), quiet, indexWith(RELIC));
  assert.deepEqual(d.problems.filter((p) => p.code === 'over-attuned'), []);
  assert.equal(d.stats.get('bonds:current')?.value, 0, 'and nothing is published either');
});
