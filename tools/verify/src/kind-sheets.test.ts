/**
 * What each kind's sheet shows, and what it leaves out, measured before deciding what "kind-specific sheets" adds.
 *
 * Every kind already renders its sheet from `kind.sheet` through core's `renderSheetSection`. This reads what that gives
 * the way the Sheet pane gives it (a row is labelled by the kind's stat label, else by its key; a `perBlock` row by its
 * key; a row reads the stat's text or value, else "—"), and asks four questions.
 *
 * - **The definitions**, for every kind of every shipped system: which rows have no label, which stats a kind labels and
 *   no section shows, which sections render once per block.
 * - **The thirty samples**, as 5e player characters: which rows show a key rather than a label, which sections read
 *   nothing but 0, which held elements no section lists (by type), which listed elements content marks as not for the
 *   sheet (`<sheet display="false">`), and what the derivation already has of the two-page sheet's first page and no
 *   row shows: ability modifiers, saving throw and skill proficiencies.
 * - **Every creature**, as an NPC built on it: which setters it prints that no section of the NPC's prints.
 * - **Content's own sheet hints**, over the corpus: what `<sheet>` says, how often, on which types.
 * - **Cairn**, the one system that is not 5e: whether its only kind renders a sheet and whether its steps can fill one.
 *
 * All of it is reported as `ℹ` lines and none of it asserted (ADR 0042), except what holds of the shipped definitions
 * whatever the corpus is.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BundleElementIndex,
  collectDeclaredBlocks,
  deriveCharacter,
  renderSheetSection,
  resolveCharacterKind,
  sheetListedElements,
  sheetSectionIsEmpty,
  type DerivedCharacter,
  type Element,
  type GameSystem,
  type ResolvedCharacterKind,
  type SheetReader,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const SYSTEMS = ['dnd5e', 'cairn'];

interface Row {
  section: string;
  stat: string;
  label: string;
  labelled: boolean;
  value: string;
  number: number | undefined;
}

interface Sheet {
  rows: Row[];
  /** Sections drawn, by id. */
  drawn: string[];
  /** Sections whose every row reads 0 and that list and print nothing else. */
  zeros: string[];
  /** Held elements listed by some drawn section. */
  listed: Element[];
}

/** The sheet as the Sheet pane draws it, before this measurement changed anything. */
function sheetOf(derived: DerivedCharacter, kind: ResolvedCharacterKind): Sheet {
  const listed = sheetListedElements(derived.elements, kind);
  const blocks = collectDeclaredBlocks(derived.elements);
  const reader: SheetReader = { statValue: (key) => derived.stats.get(key.toLowerCase())?.value, elements: derived.elements };
  const labels = new Map(kind.stats.filter((s) => s.label !== undefined).map((s) => [s.name.toLowerCase(), s.label!]));
  const rows: Row[] = [];
  const drawn: string[] = [];
  const zeros: string[] = [];
  const shown = new Set<Element>();
  for (const section of kind.sheet.sections) {
    for (const rendering of renderSheetSection(section, blocks, reader)) {
      if (sheetSectionIsEmpty(rendering, listed)) continue;
      drawn.push(rendering.id);
      const own = listed.filter((e) => rendering.types.includes(e.type));
      for (const e of own) shown.add(e);
      const these = rendering.stats.map((stat): Row => {
        const resolved = derived.stats.get(stat.toLowerCase());
        const label = rendering.blockName ? undefined : labels.get(stat.toLowerCase());
        return {
          section: rendering.id,
          stat,
          label: label ?? stat,
          labelled: label !== undefined,
          value: resolved ? (resolved.text ?? String(resolved.value)) : '—',
          number: resolved?.value,
        };
      });
      rows.push(...these);
      if (these.length && these.every((r) => !r.number) && !own.length && !rendering.printed.length) zeros.push(rendering.id);
    }
  }
  return { rows, drawn, zeros, listed: [...shown] };
}

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>, limit = 40): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

test('what every shipped kind\'s sheet declares', async (t) => {
  for (const id of SYSTEMS) {
    const system = await loadShippedSystem(id);
    for (const def of system.characterKinds) {
      const kind = resolveCharacterKind(system, def.id);
      const labels = new Set(kind.stats.filter((s) => s.label !== undefined).map((s) => s.name.toLowerCase()));
      const onSheet = new Set(kind.sheet.sections.filter((s) => !s.perBlock).flatMap((s) => s.stats ?? []).map((s) => s.toLowerCase()));
      const unlabelled = [...onSheet].filter((s) => !labels.has(s));
      const perBlock = kind.sheet.sections.filter((s) => s.perBlock).map((s) => `${s.id} (${(s.stats ?? []).join(', ')})`);
      const offSheet = kind.stats.filter((s) => s.label !== undefined && !onSheet.has(s.name.toLowerCase())).map((s) => s.name);
      const listedTypes = new Set(kind.sheet.sections.flatMap((s) => s.types ?? []));
      const unlisted = kind.elementTypes.filter((type) => !listedTypes.has(type));
      t.diagnostic(
        `${id}/${kind.id}: ${kind.sheet.sections.length} sections, ${onSheet.size} rows; unlabelled rows: ${unlabelled.join(', ') || 'none'}; ` +
          `rows labelled by key, once per block: ${perBlock.join('; ') || 'none'}; labelled stats no section shows: ${offSheet.join(', ') || 'none'}; ` +
          `types the kind holds and no section lists: ${unlisted.join(', ') || 'none'}`,
      );
    }
  }
});

test('what the samples\' sheets show, and what their derivations have that no row shows', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const kind = resolveCharacterKind(system, 'pc');
  const elements = await realElements();

  const abilities = kind.sheet.sections.find((s) => s.id === 'abilities')?.stats ?? [];
  const keyRows = new Map<string, number>();
  const zeroSections = new Map<string, number>();
  const unlistedTypes = new Map<string, number>();
  const hiddenListed = new Map<string, number>();
  const hiddenByType = new Map<string, number>();
  const hintsListed = new Map<string, number>();
  const firstPage = new Map<string, number>();
  let samples = 0;
  let proficiencyElements = 0;
  let proficiencyStats = 0;
  let saveProficiencyStats = 0;
  let expertise = 0;
  let halves = 0;

  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const derived = deriveCharacter(run.imported.character, run.system, run.elements, { kind });
    const sheet = sheetOf(derived, kind);
    samples++;
    for (const row of sheet.rows) if (!row.labelled) tally(keyRows, `${row.section}: ${row.stat.replace(/^[^:]+:(spellcasting)/, '{name}:$1')}`);
    for (const id of sheet.zeros) tally(zeroSections, id);
    const listed = new Set(sheet.listed);
    for (const e of derived.elements) if (!listed.has(e)) tally(unlistedTypes, e.type);
    for (const e of sheet.listed) {
      if (e.sheet?.display === false) {
        tally(hiddenListed, sample.id);
        tally(hiddenByType, e.type);
      }
      for (const hint of ['alt', 'name', 'usage', 'action', 'description'] as const) if (e.sheet?.[hint] !== undefined) tally(hintsListed, hint);
    }

    // The two-page sheet's first page: modifiers, saves, skills, passive Perception. What the derivation has of it.
    const value = (key: string): number => derived.stats.get(key)?.value ?? 0;
    for (const ability of abilities) if (derived.stats.has(`${ability}:modifier`)) tally(firstPage, 'ability modifiers');
    const proficiency = value('proficiency');
    for (const [key, stat] of derived.stats) {
      if (!stat.value) continue;
      if (/^[a-z ]+:save:proficiency$/.test(key)) saveProficiencyStats++;
      else if (/^[a-z ]+:proficiency$/.test(key) && key !== 'companion:proficiency') {
        proficiencyStats++;
        if (stat.value === 2 * proficiency) expertise++;
      } else if (/^[a-z ]+:misc$/.test(key) && stat.value === Math.floor(proficiency / 2)) halves++;
    }
    proficiencyElements += derived.elements.filter((e) => e.type === 'Proficiency' && e.rules.some((r) => r.kind === 'stat' && /:proficiency$/.test(r.name))).length;
    for (const key of ['perception:passive', 'strength:save', 'perception', 'acrobatics']) if (derived.stats.has(key)) tally(firstPage, key);
  }
  t.diagnostic(`samples: ${samples}`);
  t.diagnostic(`rows shown by an internal key rather than a label: ${show(keyRows)}`);
  t.diagnostic(`sections drawn that read nothing but 0: ${show(zeroSections)}`);
  t.diagnostic(`held elements no section lists, by type (summed over the samples): ${show(unlistedTypes)}`);
  t.diagnostic(`listed elements content marks not for the sheet, per sample: ${show(hiddenListed)}; by type: ${show(hiddenByType)}`);
  t.diagnostic(`listed elements carrying another sheet hint: ${show(hintsListed)}`);
  t.diagnostic(
    `the first page, in the derivation: ability modifiers published ${firstPage.get('ability modifiers') ?? 0} times; ` +
      `skill proficiencies content states (non-zero): ${proficiencyStats}, ${expertise} of them doubled; ` +
      `save proficiencies: ${saveProficiencyStats}; skill bonuses of half the proficiency bonus: ${halves}; ` +
      `proficiency elements carrying such a rule: ${proficiencyElements}; published totals: ` +
      `${['strength:save', 'acrobatics', 'perception', 'perception:passive'].map((k) => `${k} ${firstPage.get(k) ?? 0}`).join(', ')}`,
  );
});

test('what a creature prints that its NPC\'s sheet does not', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const npc = resolveCharacterKind(system, 'npc');
  const elements = await realElements();
  const creatureTypes = new Set(npc.buildSteps.find((s) => s.id === 'creature')?.types ?? []);
  const creatures = [...elements.all()].filter((e) => creatureTypes.has(e.type));
  const printed = new Set(npc.sheet.sections.flatMap((s) => s.printed ?? []).map((p) => p.setter.toLowerCase()));
  const statSetters = new Set((npc.setterStats ?? []).map((s) => s.setter.toLowerCase()));
  const grantSetters = new Set((npc.setterGrants ?? []).map((s) => s.setter.toLowerCase()));
  const unshown = new Map<string, number>();
  const zeroSections = new Map<string, number>();
  for (const creature of creatures) {
    for (const [name, setter] of Object.entries(creature.setters)) {
      const lower = name.toLowerCase();
      if (!setter.value.trim() || printed.has(lower) || grantSetters.has(lower)) continue;
      tally(unshown, statSetters.has(lower) ? `${name} (read as a stat)` : name);
    }
    const derived = deriveCharacter(
      { ...newCharacterOfKind(system, 'npc'), choices: [{ ruleKey: 'build/creature', elementIds: [creature.id] }] },
      system,
      elements,
      { kind: npc },
    );
    for (const id of sheetOf(derived, npc).zeros) tally(zeroSections, id);
  }
  t.diagnostic(`creatures: ${creatures.length}`);
  t.diagnostic(`setters a creature prints that no NPC section prints, by creatures carrying one: ${show(unshown)}`);
  t.diagnostic(`sections drawn that read nothing but 0: ${show(zeroSections)}`);
  const blank = deriveCharacter(newCharacterOfKind(system, 'npc'), system, elements, { kind: npc });
  const sheet = sheetOf(blank, npc);
  t.diagnostic(`an NPC from nothing draws ${sheet.drawn.join(', ')}; rows reading 0: ${sheet.rows.filter((r) => r.number === 0).map((r) => r.stat).join(', ')}`);
});

test('what content says about the sheet itself', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const hints = new Map<string, number>();
  const hidden = new Map<string, number>();
  const shownAs = new Map<string, number>();
  for (const element of [...elements.all()]) {
    const sheet = element.sheet;
    if (!sheet) continue;
    tally(hints, 'any');
    for (const [key, value] of Object.entries(sheet)) if (value !== undefined) tally(hints, key === 'display' ? `display=${value}` : key);
    if (sheet.display === false) tally(hidden, element.type);
    if (sheet.display !== false && (sheet.alt ?? sheet.name) !== undefined) tally(shownAs, element.type);
  }
  t.diagnostic(`elements with a <sheet> hint, by what it says: ${show(hints)}`);
  t.diagnostic(`marked display="false", by type: ${show(hidden)}`);
  t.diagnostic(`shown under another name (alt or name), by type: ${show(shownAs)}`);
});

test('Cairn\'s only kind renders a sheet, and whether its steps can fill one', async (t) => {
  const system: GameSystem = await loadShippedSystem('cairn');
  const kind = resolveCharacterKind(system, system.characterKinds[0]!.id);
  const index = new BundleElementIndex([]);
  const builder = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, index);
  const state = builder.getState();
  const sheet = sheetOf(state.derived, kind);
  assert.ok(sheet.drawn.length > 0, 'a kind with no content still draws its sheet');
  t.diagnostic(`cairn/${kind.id}: draws ${sheet.drawn.join(', ')}; rows ${sheet.rows.map((r) => `${r.label} ${r.value}`).join(', ')}`);
  t.diagnostic(
    `steps: ${state.steps.map((s) => `${s.id} (${s.complete ? 'complete' : 'open'}${s.budget ? ', a budget' : ', no budget'})`).join(', ')}; ` +
      `open decisions: ${state.decisions.length}`,
  );
});
