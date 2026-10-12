/**
 * What a homebrew element has to say, measured on the official corpus before the element editor was designed — ADR 0108.
 *
 * The types are the ones a character can be given whatever it is (a kind's `additions.types`, ADR 0064), read off the
 * shipped system and never spelled here: an element of one of them reaches a character with no build step, no class
 * track and no format change, which is what a first editor can promise. For each type the corpus is asked how many of
 * its elements the first slice could have written, and what stops the rest.
 *
 * The slice, as `packages/ui/src/homebrew.ts` writes it: a name, a description, setters (a name and a text value),
 * support tags, lines that add a whole number to a stat, and grants of another element, none of them gated on a level,
 * a requirement or equipment, and no bonus bucket. What it cannot write is counted by the first thing that rules an
 * element out, in this order: a `select` (a choice the character makes), an element-level requirement (a prerequisite),
 * a gated rule, a stat line whose value is not a number, a stat line in a bonus bucket or capped, a grant carrying
 * anything but its id and type, and a block (spellcasting or multiclass).
 *
 * Asserted, with no corpus: every addable type is declared by the system and listed by more than one kind. What is
 * reported and not asserted (ADR 0042): every count below. At c28ce6c the slice writes all of the conditions, 98% of
 * the languages, 95% of the spells (whose setters and tags are what a spell list and a slot-level select read: 1,079
 * carry a level and 1,078 support tags), 68% of the background features, 67% of the proficiencies, 59% of the racial
 * traits, 41% of the archetype features, 22% of the class features (535 stopped by a prerequisite) and 9% of the feats
 * (200 of 320 stopped by a choice). Over the whole corpus, of 15,115 rules: 6,995 grants, 5,079 stat lines (978 of them
 * an ungated, unbucketed number) and 3,041 selects; 6,010 elements carry support tags, which are not rules.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCharacterKind, type Element } from '@incudo/core';

import { loadShippedSystem } from './node-system.ts';
import { corpusSkip, corpusProvenance, realElements } from './real-data.ts';

/** The types any kind of the system lets a user add, in the order the system declares element types. */
async function addableTypes(): Promise<{ types: string[]; kinds: Map<string, number> }> {
  const system = await loadShippedSystem('dnd5e');
  const kinds = new Map<string, number>();
  for (const def of system.characterKinds) {
    for (const type of resolveCharacterKind(system, def.id).additions?.types ?? []) kinds.set(type, (kinds.get(type) ?? 0) + 1);
  }
  const types = system.elementTypes.map((t) => t.name).filter((name) => kinds.has(name));
  return { types, kinds };
}

/** The first thing the slice cannot write, or nothing when it can write the element whole. */
function blocker(element: Element): string | undefined {
  if (element.rules.some((r) => r.kind === 'select')) return 'select';
  if (element.requirements) return 'prerequisite';
  if (element.rules.some((r) => r.requirements || r.level !== undefined || ('equipped' in r && r.equipped))) return 'gated';
  const stats = element.rules.filter((r) => r.kind === 'stat');
  if (stats.some((r) => r.value.kind !== 'number' || !Number.isInteger(r.value.value))) return 'expression';
  if (stats.some((r) => r.bonus !== undefined || r.max !== undefined || r.alt !== undefined || r.inline)) return 'bucket';
  if (element.rules.some((r) => r.kind === 'grant' && (r.spellcasting || r.prepared || r.name || r.allowReplace))) return 'grant-detail';
  if (element.spellcasting?.length || element.multiclass) return 'block';
  return undefined;
}

test('the types a user may add are declared and shared by the kinds', async () => {
  const system = await loadShippedSystem('dnd5e');
  const { types, kinds } = await addableTypes();
  assert.ok(types.length > 0, 'some kind lets a user add elements');
  for (const [type, count] of kinds) {
    assert.ok(system.elementTypes.some((t) => t.name === type), `${type} is a declared element type`);
    assert.ok(count > 1, `${type} is addable on more than one kind`);
  }
});

test('what the first editor could write of the addable types', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  const { types } = await addableTypes();
  t.diagnostic(corpusProvenance());
  for (const type of types) {
    const of = elements.byType(type);
    const blocked = new Map<string, number>();
    let writable = 0;
    let described = 0;
    let withSetters = 0;
    let withTags = 0;
    const setterNames = new Map<string, number>();
    for (const element of of) {
      if (element.description) described++;
      if (Object.keys(element.setters).length) withSetters++;
      if (element.supports.length) withTags++;
      for (const name of Object.keys(element.setters)) setterNames.set(name, (setterNames.get(name) ?? 0) + 1);
      const why = blocker(element);
      if (why === undefined) writable++;
      else blocked.set(why, (blocked.get(why) ?? 0) + 1);
    }
    const pct = of.length ? Math.round((100 * writable) / of.length) : 0;
    const why = [...blocked].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
    const setters = [...setterNames].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
    t.diagnostic(
      `${type}: ${of.length} elements, ${writable} writable (${pct}%); described ${described}, with setters ${withSetters}, with tags ${withTags}` +
        (why ? `; stopped by ${why}` : '') +
        (setters ? `; setters ${setters}` : ''),
    );
  }

  let grants = 0;
  let selects = 0;
  let stats = 0;
  let plain = 0;
  let tagged = 0;
  for (const element of elements.all()) {
    if (element.supports.length) tagged++;
    for (const rule of element.rules) {
      if (rule.kind === 'grant') grants++;
      if (rule.kind === 'select') selects++;
      if (rule.kind === 'stat') {
        stats++;
        if (rule.value.kind === 'number' && !rule.requirements && rule.level === undefined && !rule.bonus) plain++;
      }
    }
  }
  t.diagnostic(
    `whole corpus: ${grants + selects + stats} rules, ${grants} grants, ${stats} stat lines (${plain} an ungated, unbucketed number), ${selects} selects; ${tagged} elements carry support tags`,
  );
});
