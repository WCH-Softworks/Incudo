/**
 * How often an offered candidate would give something the character already has, measured before deciding what a picker
 * marks.
 *
 * A pool never offers what the character holds; a candidate it offers may still grant, in turn, something held — a
 * background's Perception for an Elf who has it from Keen Senses. `candidateOverlaps` (`packages/ui`) walks a candidate's
 * grants through content; this runs it over every decision of the thirty samples, every type counted, and reports what
 * the overlaps are made of (`ℹ` lines, nothing asserted: ADR 0042, a moving corpus fails only what must hold against any
 * corpus). A settled slot is measured as it would be changed: against the character with that slot's answer taken out,
 * or everything the answer itself gives would read as redundant.
 *
 * Two readings are compared: grants' requirements read against the character (what the picker does), and every grant
 * followed. They differ where a grant's condition is false for this character (Keen Senses' Perception under Tasha's
 * customised origin) and where it names something only the candidate brings, which reads false and can only leave a
 * mark out.
 *
 * What is asserted, against any corpus: a fresh 2014 Elf is told which backgrounds would give it Perception again; every
 * mark names something the Elf holds, of a type the kind declares; and no background granting Perception outright goes
 * unmarked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter, setChoice, type Character, type ElementId, type ElementIndex } from '@incudo/core';
import { CharacterBuilder, candidateOverlaps, newCharacterOfKind } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

function tally(values: string[], limit = 14): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([v, n]) => `${n} ${v}`);
  if (sorted.length > limit) shown.push(`${sorted.length - limit} more`);
  return shown.join(', ') || 'none';
}

/** The level a decision's candidate would be taken at: its chooser's own track level, else the character's. */
function levelOf(ruleKey: string, derived: ReturnType<typeof deriveCharacter>): number {
  const owner = ruleKey.slice(0, ruleKey.indexOf('/'));
  return derived.gateLevels.get(owner) ?? derived.progress.value;
}

test('how often an offered candidate gives what the character already has', { skip: savesSkip }, async (t) => {
  const elements = await realElements();
  t.diagnostic(corpusProvenance());
  let slots = 0;
  let marked = 0;
  let markedCandidates = 0;
  let unconditional = 0;
  const overlapTypes: string[] = [];
  const candidateTypes: string[] = [];
  const declaredOverlaps: string[] = [];
  const onlyUnconditional: string[] = [];
  const examples: string[] = [];
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const builder = new CharacterBuilder(run.imported.character, run.system, run.elements);
    const state = builder.getState();
    const index: ElementIndex = run.elements;
    const measure = (character: Character, candidates: ElementId[], ruleKey: string, label: string): void => {
      const held = deriveCharacter(character, run.system, index, { kind: state.kind });
      const level = levelOf(ruleKey, held);
      const all = candidateOverlaps(candidates, held, state.kind, index, { level, types: allTypes(index) });
      const loose = candidateOverlaps(candidates, held, state.kind, index, { level, types: allTypes(index), requirements: false });
      const declared = candidateOverlaps(candidates, held, state.kind, index, { level });
      slots++;
      if (declared.size) marked++;
      markedCandidates += declared.size;
      for (const [candidate, ids] of all) {
        candidateTypes.push(index.get(candidate)?.type ?? '?');
        for (const id of ids) overlapTypes.push(index.get(id)?.type ?? '?');
      }
      for (const ids of declared.values()) for (const id of ids) declaredOverlaps.push(index.get(id)?.name ?? id);
      for (const [candidate, ids] of loose) {
        const strict = new Set(all.get(candidate) ?? []);
        for (const id of ids) {
          if (strict.has(id)) continue;
          unconditional++;
          onlyUnconditional.push(index.get(id)?.type ?? '?');
        }
      }
      if (declared.size && examples.length < 8) {
        const [candidate, ids] = [...declared][0]!;
        examples.push(`${label}: ${index.get(candidate)?.name} gives ${ids.map((id) => index.get(id)?.name).join(', ')} (${declared.size} of ${candidates.length} marked)`);
      }
    };
    for (const decision of state.decisions) {
      if (decision.kind !== 'select' && decision.kind !== 'pick') continue;
      measure(state.character, decision.candidates, decision.id, decision.label);
    }
    for (const pick of state.picks) {
      pick.chosen.forEach((answer, slot) => {
        const rest = pick.chosen.filter((_, i) => i !== slot);
        const without = setChoice(state.character, pick.ruleKey, rest);
        const options = pick.candidates.filter((id) => id === answer || !rest.includes(id));
        measure(without, options, pick.ruleKey, pick.label);
      });
    }
  }
  t.diagnostic(`decisions measured (open, and each settled slot as it would be changed): ${slots}`);
  t.diagnostic(`with at least one candidate marked under the declared types: ${marked}; candidates marked: ${markedCandidates}`);
  t.diagnostic(`every type, what candidates would give again: ${tally(overlapTypes)}`);
  t.diagnostic(`every type, which candidates give it: ${tally(candidateTypes)}`);
  t.diagnostic(`declared types, what is named: ${tally(declaredOverlaps)}`);
  t.diagnostic(`given again only when grants' requirements are not read: ${unconditional} (${tally(onlyUnconditional)})`);
  for (const example of examples) t.diagnostic(`  ${example}`);
});

let typesCache: string[] | undefined;
function allTypes(index: ElementIndex): string[] {
  typesCache ??= [...new Set([...index.all()].map((element) => element.type))];
  return typesCache;
}

test('a fresh 2014 Elf is told which backgrounds would give it Perception again', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  const system = await loadShippedSystem('dnd5e');
  const builder = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  builder.choose('build/race', ['ID_RACE_ELF']);
  // What a picker costs to open: the race list changed (a derivation, then the walk) and the open background list.
  let started = performance.now();
  const races = builder.overlapsFor('build/race', 0);
  t.diagnostic(`race list, changing the Elf: ${races.size} marked, ${(performance.now() - started).toFixed(0)} ms`);
  started = performance.now();
  builder.overlapsFor('build/background');
  t.diagnostic(`background list: ${(performance.now() - started).toFixed(0)} ms`);
  const state = builder.getState();
  assert.ok(state.derived.elementIds.has('ID_PROFICIENCY_SKILL_PERCEPTION'), 'the Elf holds Perception');
  const background = state.decisions.find((decision) => decision.id === 'build/background');
  assert.ok(background, 'Background is open');
  const marks = builder.overlapsFor(background.id);
  assert.ok(marks.size > 0, 'some background gives Perception');
  t.diagnostic(`backgrounds marked: ${marks.size} of ${background.candidates.length}`);
  const declared = new Set(state.kind.candidateOverlaps!.types);
  for (const [candidate, ids] of marks) {
    for (const id of ids) {
      assert.ok(state.derived.elementIds.has(id), `${candidate} names ${id}, which the Elf holds`);
      assert.ok(declared.has(elements.get(id)!.type), `${candidate} names ${id}, of a declared type`);
    }
  }
  assert.ok([...marks.values()].some((ids) => ids.includes('ID_PROFICIENCY_SKILL_PERCEPTION')), 'a background is marked with Perception');
  const unmarked = background.candidates.filter((id) => !marks.has(id));
  for (const id of unmarked) {
    const grants = elements.get(id)!.rules.filter((rule) => rule.kind === 'grant' && !rule.requirements).map((rule) => (rule as { id: string }).id);
    assert.ok(!grants.includes('ID_PROFICIENCY_SKILL_PERCEPTION'), `${id} grants Perception unconditionally and is not marked`);
  }
});
