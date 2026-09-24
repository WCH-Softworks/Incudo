/**
 * The `Ritual` operand of a select's filter, over the official corpus — ADR 0047.
 *
 * Every select in the corpus that filters on `Ritual` is seeded through a fresh character and asked what it
 * offers. The expected list is worked out here from the spells themselves (`isRitual` true, level 1, and the
 * class tag where the filter names one), by a reading that shares no code with the engine's, so a filter that
 * resolved to everything or to nothing fails it. `aurora verify` cannot see this: it compares what a character
 * chose and never what it was offered.
 *
 * Nothing here names a count of selects or of rituals: the corpus moves (ADR 0042). What must hold against any
 * corpus is that each list is exactly the spells the filter's words describe, that the class lists are not
 * empty, and that breaking the declaration empties them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCharacter,
  deriveCharacter,
  validateGameSystem,
  type Element,
  type ElementIndex,
  type GameSystem,
  type SelectRule,
  type SupportsExpr,
} from '@incudo/core';

import { loadSchemas } from './node-system.ts';
import { corpusSkip, realElements, requireCorpus } from './real-data.ts';

async function shippedSystem(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

/** The literal words of a filter that is an AND of plain tags, or `undefined` when it is anything else. */
function andedWords(expr: SupportsExpr | undefined): string[] | undefined {
  if (!expr) return undefined;
  if (expr.kind === 'tag') return [expr.tag];
  if (expr.kind !== 'and') return undefined;
  const words: string[] = [];
  for (const child of expr.children) {
    if (child.kind !== 'tag') return undefined;
    words.push(child.tag);
  }
  return words;
}

const isTrue = (spell: Element): boolean => spell.setters['isRitual']?.value?.trim().toLowerCase() === 'true';

/** What the filter's words describe, read from the spells and nothing else. */
function expectedFor(words: string[], spells: Element[]): string[] {
  const classes = words.filter((w) => w !== 'Ritual' && !/^\d+$/.test(w));
  const level = words.find((w) => /^\d+$/.test(w));
  return spells
    .filter((spell) => isTrue(spell))
    .filter((spell) => level === undefined || spell.setters['level']?.value?.trim() === level)
    .filter((spell) => classes.every((c) => spell.supports.some((tag) => tag.toLowerCase() === c.toLowerCase())))
    .map((spell) => spell.id)
    .sort();
}

interface RitualSelect {
  owner: Element;
  rule: SelectRule;
  words: string[];
}

function ritualSelects(index: ElementIndex): RitualSelect[] {
  const found: RitualSelect[] = [];
  for (const owner of index.all()) {
    for (const rule of owner.rules) {
      if (rule.kind !== 'select') continue;
      const words = andedWords(rule.supports);
      if (words?.includes('Ritual')) found.push({ owner, rule, words });
    }
  }
  return found;
}

function offered(system: GameSystem, index: ElementIndex, owner: Element, rule: SelectRule): string[] | undefined {
  const character = createCharacter('dnd5e', 'pc', { progress: 1 });
  character.choices = [{ ruleKey: 'seed', elementIds: [owner.id] }];
  const derived = deriveCharacter(character, system, index);
  const pending = derived.pendingChoices.find((p) => p.ruleKey === `${owner.id}/select:${rule.name}`);
  return pending === undefined ? undefined : [...pending.candidates].sort();
}

test('every Ritual select offers exactly the level-appropriate rituals its words describe', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await shippedSystem();
  const index = await realElements();
  const spells = index.byType('Spell');
  const selects = ritualSelects(index);
  assert.ok(selects.length > 0, 'the corpus has selects that filter on Ritual');

  let checked = 0;
  for (const { owner, rule, words } of selects) {
    const got = offered(system, index, owner, rule);
    // A rule whose own requirements the seeded character does not meet is not open, and is not this test's question.
    if (got === undefined) continue;
    checked += 1;
    assert.deepEqual(got, expectedFor(words, spells), `${owner.id} / ${rule.name} (${words.join(', ')})`);
    assert.ok(got.length > 0, `${owner.id} / ${rule.name} offers something`);
  }
  assert.ok(checked > 0, 'at least one Ritual select was open for a fresh character, or nothing here was measured');
});

test('the class lists of the Ritual Caster feat are each a class, and none is another class list', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await shippedSystem();
  const index = await realElements();
  const spells = index.byType('Spell');
  const perClass = ritualSelects(index).filter((s) => s.words.length === 3 && s.words.includes('1'));
  assert.ok(perClass.length > 0, 'the class-specific Ritual Caster selects exist');
  for (const { owner, rule, words } of perClass) {
    const cls = words.find((w) => w !== 'Ritual' && w !== '1')!;
    const got = offered(system, index, owner, rule)!;
    assert.ok(got.length > 0, `${cls}'s list is not empty`);
    for (const id of got) {
      const spell = index.get(id)!;
      assert.ok(spell.supports.some((t) => t.toLowerCase() === cls.toLowerCase()), `${id} is on ${cls}'s list`);
      assert.ok(isTrue(spell), `${id} is a ritual`);
    }
    // A spell that is a ritual of another class only must not appear.
    const other = spells.find((s) => isTrue(s) && !s.supports.some((t) => t.toLowerCase() === cls.toLowerCase()));
    assert.ok(other === undefined || !got.includes(other.id), `${cls}'s list holds a spell of no such list`);
  }
});

test('removing the declaration empties every Ritual select, so the lists are the declaration\'s doing', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await shippedSystem();
  const broken: GameSystem = {
    ...system,
    characterKinds: system.characterKinds.map((kind) => ({ ...kind, setterTags: [] })),
  };
  const index = await realElements();
  let measured = 0;
  for (const { owner, rule } of ritualSelects(index)) {
    const got = offered(broken, index, owner, rule);
    if (got === undefined) continue;
    measured += 1;
    assert.deepEqual(got, [], `${owner.id} / ${rule.name} offers nothing without setterTags`);
  }
  assert.ok(measured > 0);
});
