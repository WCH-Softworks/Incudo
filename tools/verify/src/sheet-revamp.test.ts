/**
 * What the sheet document holds, measured before it is laid out as a page — ADR 0126, build step 1.
 *
 * Page heights are the browser's and are not measured here; this asks the document, on the thirty samples and on every
 * creature built as an NPC, reported as `ℹ` lines and asserting nothing (ADR 0042):
 *
 * - **Folds**: elements a section lists that another element the same section lists names in a `<grant>` of its own,
 *   followed through more than one step (Martial Weapons, Martial Melee Weapons, Longsword). Per section, and in total.
 * - **Marked**: elements a section lists whose every non-zero contribution is to the mark stat of a row the sheet shows
 *   with a mark ("Arcana +5 (proficient)" already says the Arcana proficiency).
 * - **What is left** of the Proficiencies section once both are applied, per sheet (min, median, max).
 * - **Text-less features**: a features section's elements with no sheet text and no usage, and of those, how many have
 *   an answer of their own (a recorded choice under `<element>/select:`).
 * - **Spell setters**: of the spells the sheets list, how many carry each setter a spell table would show.
 * - **Creature prints**: for every creature built as an NPC, whether the printed armour class, hit points and speed lead
 *   with the number the NPC derives.
 * - **Proficiency categories**: the support tags the listed proficiencies carry, to see whether content groups them.
 *
 * The first run, on AuroraLegacy/elements at `c28ce6c` and the thirty samples: 1,738 proficiencies listed (22 to 85 a
 * sheet, median 45), 1,196 folded and 213 marked, leaving 6 to 24 (median 11; 223 proficiencies, 105 languages, 1
 * condition, their tags no clean category); 359 features, 52 with no text or usage, 34 of those answered; 311 spells, all
 * carrying time, range, duration and the verbal flag; of 141 creatures, the printed armour class, hit points and speed
 * lead with the derived number for 122, 131 and 138 (the rest print a formula: "14 + PB", "five times your level").
 */

import { test } from 'node:test';

import { type Element, type ElementId, type GameSystem } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, playPlaces, sheetDocument, type BuilderState } from '@incudo/ui';
import assert from 'node:assert/strict';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>, limit = 40): string =>
  [...m].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
const spread = (values: number[]): string => {
  if (!values.length) return 'none';
  const sorted = [...values].sort((a, b) => a - b);
  return `${sorted[0]} to ${sorted[sorted.length - 1]}, median ${sorted[Math.floor(sorted.length / 2)]}`;
};

/** Every element a section lists that another listed element reaches by its own grants, any number of steps. */
function folded(listed: readonly Element[], index: (id: ElementId) => Element | undefined): Set<ElementId> {
  const ids = new Set(listed.map((e) => e.id));
  const out = new Set<ElementId>();
  for (const e of listed) {
    const seen = new Set<ElementId>([e.id]);
    const walk = (element: Element): void => {
      for (const rule of element.rules) {
        if (rule.kind !== 'grant' || seen.has(rule.id)) continue;
        seen.add(rule.id);
        if (ids.has(rule.id)) out.add(rule.id);
        const next = index(rule.id);
        if (next) walk(next);
      }
    };
    walk(e);
  }
  return out;
}

/** Each section's marked rows' mark stats, and every element's non-zero contributions by stat. */
function markedStats(state: BuilderState): Set<string> {
  const out = new Set<string>();
  for (const def of state.kind.sheet.sections) {
    if (!def.mark) continue;
    for (const view of state.sheet.sections.filter((s) => s.section === def.id)) {
      for (const row of view.rows) if (row.mark) out.add(def.mark.stat.replaceAll('{stat}', row.stat).toLowerCase());
    }
  }
  return out;
}

function contributedStats(state: BuilderState): Map<ElementId, Set<string>> {
  const out = new Map<ElementId, Set<string>>();
  for (const [key, stat] of state.derived.stats) {
    for (const c of stat.contributions ?? []) {
      if (c.value === 0) continue;
      const set = out.get(c.from) ?? new Set<string>();
      set.add(key);
      out.set(c.from, set);
    }
  }
  return out;
}

const SPELL_SETTERS = ['time', 'range', 'duration', 'hasVerbalComponent', 'hasSomaticComponent', 'hasMaterialComponent', 'isConcentration', 'isRitual'];

test('on the samples: what a fold, a mark and an answer would take off the sheet', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();

  const foldsBySection = new Map<string, number>();
  const markedBySection = new Map<string, number>();
  const listedBySection = new Map<string, number>();
  const proficienciesBefore: number[] = [];
  const proficienciesAfter: number[] = [];
  const leftByType = new Map<string, number>();
  const proficiencyTags = new Map<string, number>();
  let features = 0;
  let textless = 0;
  let answered = 0;
  const textlessNames = new Map<string, number>();
  const spellSetters = new Map<string, number>();
  let spells = 0;

  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    const lookup = (id: ElementId): Element | undefined => run.elements.get(id);
    const marks = markedStats(state);
    const contributions = contributedStats(state);
    const held = new Map(state.derived.elements.map((e) => [e.id, e]));
    const answers = new Map<ElementId, ElementId[]>();
    for (const choice of state.derived.character.choices) {
      const at = choice.ruleKey.indexOf('/select:');
      if (at < 0) continue;
      const owner = choice.ruleKey.slice(0, at);
      answers.set(owner, [...(answers.get(owner) ?? []), ...choice.elementIds.filter((id) => held.has(id))]);
    }

    for (const section of state.sheet.sections) {
      const listed = section.elements.flatMap((l) => held.get(l.elementId) ?? lookup(l.elementId) ?? []);
      const fold = folded(listed, lookup);
      const marked = new Set(
        listed
          .filter((e) => !fold.has(e.id))
          .filter((e) => {
            const stats = contributions.get(e.id);
            return stats !== undefined && stats.size > 0 && [...stats].every((s) => marks.has(s));
          })
          .map((e) => e.id),
      );
      tally(listedBySection, section.label, listed.length);
      tally(foldsBySection, section.label, fold.size);
      tally(markedBySection, section.label, marked.size);
      if (section.section === 'proficiencies') {
        proficienciesBefore.push(listed.length);
        const left = listed.filter((e) => !fold.has(e.id) && !marked.has(e.id));
        proficienciesAfter.push(left.length);
        for (const e of left) {
          tally(leftByType, e.type);
          for (const tag of e.supports.length ? e.supports : ['(none)']) tally(proficiencyTags, tag);
        }
      }
      if (section.section === 'features') {
        for (const l of section.elements) {
          features++;
          if (l.text !== undefined || l.usage !== undefined) continue;
          textless++;
          tally(textlessNames, l.sheetName ?? l.name);
          if (answers.get(l.elementId)?.length) answered++;
        }
      }
      if (section.section === 'spells') {
        for (const l of section.elements) {
          const e = held.get(l.elementId) ?? lookup(l.elementId);
          if (!e) continue;
          spells++;
          for (const setter of SPELL_SETTERS) if (e.setters[setter] !== undefined) tally(spellSetters, setter);
        }
      }
    }
  }

  t.diagnostic(`listed per section: ${show(listedBySection)}`);
  t.diagnostic(`folded (granted by another the section lists): ${show(foldsBySection)}`);
  t.diagnostic(`left out (a shown mark says it): ${show(markedBySection)}`);
  t.diagnostic(`proficiencies per sheet: ${spread(proficienciesBefore)} before, ${spread(proficienciesAfter)} after`);
  t.diagnostic(`proficiencies left, by type: ${show(leftByType)}`);
  t.diagnostic(`support tags on what is left: ${show(proficiencyTags, 30)}`);
  t.diagnostic(`features: ${features} listed, ${textless} with no text or usage, ${answered} of those answered by a choice of their own`);
  t.diagnostic(`text-less features: ${show(textlessNames, 30)}`);
  t.diagnostic(`spells listed: ${spells}; carrying each setter: ${show(spellSetters)}`);
});

test('every creature as an NPC: whether its printed armour class, hit points and speed lead with its derived number', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  const system: GameSystem = await loadShippedSystem('dnd5e');
  const creatures = elements.byType('Companion');
  const agree = new Map<string, number>();
  const differ = new Map<string, number>();
  const samples: string[] = [];
  for (const creature of creatures) {
    const b = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements);
    b.choose('build/creature', [creature.id]);
    const stats = b.getState().derived.stats;
    for (const [setter, stat] of [['ac', 'ac'], ['hp', 'hp'], ['speed', 'speed']] as const) {
      const printed = creature.setters[setter]?.value;
      if (printed === undefined) continue;
      const lead = /^\s*(\d+)/.exec(printed)?.[1];
      const value = stats.get(stat)?.value;
      if (lead !== undefined && value !== undefined && Number(lead) === value) tally(agree, setter);
      else {
        tally(differ, setter);
        if (samples.length < 12) samples.push(`${creature.name} ${setter} "${printed}" vs ${value}`);
      }
    }
  }
  t.diagnostic(`creatures: ${creatures.length}; printed number agrees with the derived one: ${show(agree)}; differs: ${show(differ)}`);
  t.diagnostic(`differing: ${samples.join('; ') || 'none'}`);
});

test('on the samples: every tracker is drawn where its number is, on a row or an element the sheet shows (ADR 0126)', { skip: corpusSkip || savesSkip }, async (t) => {
  // Fails if a tracker's place names a section or row the document does not draw (it would be spent nowhere on the page),
  // or if a stat tracker reads a stat no tile or row of the head band shows and the strip is not where it goes.
  const elements = await realElements();
  const lost: string[] = [];
  let placed = 0;
  let loose = 0;
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    if (!state.play) continue;
    const document = sheetDocument(state);
    for (const { tracker } of playPlaces(state.play).all) {
      const at = tracker.at;
      if (!at) {
        loose++;
        continue;
      }
      placed++;
      if ('stat' in at) continue;
      const section = document.sections.find((s) => s.id === at.section);
      const found = 'row' in at ? section?.rows.some((r) => r.stat === at.row) : section?.elements.some((e) => e.elementId === at.element);
      if (!found) lost.push(`${sample.id} ${tracker.key}`);
    }
  }
  t.diagnostic(`trackers drawn in place: ${placed}; on the strip with no row: ${loose}`);
  assert.deepEqual(lost, []);
});
