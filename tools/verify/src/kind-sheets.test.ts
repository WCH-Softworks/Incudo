/**
 * What each kind's sheet shows, and what it leaves out — ADR 0074.
 *
 * Every kind renders its sheet from `kind.sheet`. This reads the sheet as the Sheet pane draws it, through
 * `packages/ui`'s `sheetView` (the character's) and `companionsView` (a held creature's), and asks:
 *
 * - **The definitions**, for every kind of every shipped system: which rows have no label, which stats a kind labels and
 *   no section shows, which element types the kind holds and no section lists.
 * - **The thirty samples**, as 5e player characters: which rows are called by a key, which sections read nothing but 0,
 *   which held elements no section lists (by type), which listed elements content marks as not for the sheet
 *   (`<sheet display="false">`), and whether the saves, skills and spell slots shown are the ones the character has.
 * - **Every creature**, as an NPC built on it: which setters it prints that no section of the NPC's prints.
 * - **Content's own sheet hints**, over the corpus: what `<sheet>` says, how often, on which types.
 * - **Cairn**, the one system that is not 5e: whether its only kind draws a sheet its steps can fill.
 *
 * The first run of this file, on the commit before ADR 0074, drew the sheet the old pane's way and found: the Spell
 * Slots section read nothing but 0 on 23 of 30 samples (all 13 single-class casters among them), every casting block's
 * two rows were called by their keys, no save, skill, passive Perception or modifier was shown although the derivation
 * held 153 skill and 60 save proficiencies, race, class and background were listed nowhere, no creature's size, type,
 * alignment or printed armour class and hit points were shown, and Cairn's scores could not be set.
 *
 * Reported as `ℹ` lines. What is asserted holds against any corpus (ADR 0042): every row of every shipped kind has a
 * label; no sample's sheet calls a row by its key or draws a section of zeros; a sample's saves and skills are the ones
 * Aurora's own list of its elements and the book make them, wherever nothing else adds to one; its spell slots are the
 * pool where it has one and each block's own table where it casts from it; every creature's NPC prints its first line
 * and shows each score's modifier beside it; a Cairn character's entered scores are its sheet's.
 *
 * Perturbations, each run and failing here: a block stat's label removed (a row called by its key); the pool section
 * shown as before (a single-class caster's zeros); every block's own table shown (a multiclass caster shows its
 * classes' tables beside the pool); pact magic not kept beside a pool; Stealth's `:misc` term dropped (a level 20
 * Champion's Remarkable Athlete; Performance's is not caught, because the one bard holding Jack of All Trades is
 * proficient in it); Wisdom's save proficiency term dropped; the NPC's printed first line, or its printed hit points,
 * removed; `beside` removed from the NPC's or a held creature's scores; a held creature's first line removed; either of
 * Cairn's two budgets removed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BundleElementIndex,
  deriveCharacter,
  resolveCharacterKind,
  type DerivedCharacter,
  type Element,
  type GameSystem,
  type ResolvedCharacterKind,
} from '@incudo/core';
import { CharacterBuilder, companionsView, newCharacterOfKind, sheetView, type SheetView } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const SYSTEMS = ['dnd5e', 'cairn'];

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>, limit = 40): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

/** Rows a sheet calls by their key: a label nothing declared. */
function keyedRows(sheet: SheetView): string[] {
  return sheet.sections.flatMap((s) => s.rows.filter((r) => r.label === r.stat).map((r) => `${s.id}: ${r.stat}`));
}

/** Sections drawn whose every row reads 0 and that list and print nothing else. */
function zeroSections(sheet: SheetView): string[] {
  return sheet.sections
    .filter((s) => s.rows.length && s.rows.every((r) => /^[+]?0$/.test(r.value)) && !s.elements.length && !s.printed.length)
    .map((s) => s.id);
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

test('what every shipped kind\'s sheet declares, and every row of it has a label', async (t) => {
  const unlabelled: string[] = [];
  for (const id of SYSTEMS) {
    const system = await loadShippedSystem(id);
    for (const def of system.characterKinds) {
      const kind = resolveCharacterKind(system, def.id);
      const labels = new Set(kind.stats.filter((s) => s.label !== undefined).map((s) => s.name.toLowerCase()));
      const blockLabels = new Set(kind.blockStats.filter((s) => s.label !== undefined).map((s) => s.stat.toLowerCase()));
      const rows = kind.sheet.sections.flatMap((s) => (s.stats ?? []).map((stat) => ({ stat: stat.toLowerCase(), perBlock: s.perBlock === true })));
      for (const row of rows) if (!(row.perBlock ? blockLabels : labels).has(row.stat)) unlabelled.push(`${id}/${kind.id}: ${row.stat}`);
      const scope = [...kind.stats, ...(kind.companions?.stats ?? [])].filter((s) => s.label !== undefined).map((s) => s.name.toLowerCase());
      for (const section of kind.companions?.sheet ?? []) {
        for (const stat of section.stats ?? []) if (!scope.includes(stat.toLowerCase())) unlabelled.push(`${id}/${kind.id} companions: ${stat}`);
      }
      const onSheet = new Set(rows.filter((r) => !r.perBlock).map((r) => r.stat));
      const offSheet = kind.stats.filter((s) => s.label !== undefined && !onSheet.has(s.name.toLowerCase())).map((s) => s.name);
      const listedTypes = new Set(kind.sheet.sections.flatMap((s) => s.types ?? []));
      const unlisted = kind.elementTypes.filter((type) => !listedTypes.has(type));
      t.diagnostic(
        `${id}/${kind.id}: ${kind.sheet.sections.length} sections, ${rows.length} rows; labelled stats no section shows: ${offSheet.join(', ') || 'none'}; ` +
          `types the kind holds and no section lists: ${unlisted.join(', ') || 'none'}`,
      );
    }
  }
  // Fails if a shipped kind shows a row it gives no name: the row would be called by its key on screen.
  assert.deepEqual(unlabelled, []);
});

/** Skill names as the sample saves' proficiency ids spell them, underscores ignored: one expertise id writes `SLEIGHT_OF_HAND`. */
const skillId = (skill: string): string => skill.replace(/ /g, '').toUpperCase();

test('the samples\' sheets: labelled rows, no sections of zeros, and the saves, skills and slots they have', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const kind = resolveCharacterKind(system, 'pc');
  const elements = await realElements();
  const skills = kind.sheet.sections.find((s) => s.id === 'skills')?.stats ?? [];
  const saves = kind.sheet.sections.find((s) => s.id === 'saves')?.stats ?? [];
  assert.equal(skills.length, 18, 'the player character shows every skill');
  assert.equal(saves.length, 6, 'and every saving throw');

  const keyed: string[] = [];
  const zeros: string[] = [];
  const unlistedTypes = new Map<string, number>();
  const hiddenByType = new Map<string, number>();
  const hints = new Map<string, number>();
  const disagree: string[] = [];
  const slotMismatch: string[] = [];
  let agree = 0;
  let others = 0;
  let casters = 0;

  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const derived = deriveCharacter(run.imported.character, run.system, run.elements, { kind });
    const sheet = sheetView(derived, kind);
    keyed.push(...keyedRows(sheet).map((r) => `${sample.id} ${r}`));
    zeros.push(...zeroSections(sheet).map((s) => `${sample.id} ${s}`));

    const listed = new Set(sheet.sections.flatMap((s) => s.elements.map((e) => e.elementId)));
    for (const e of derived.elements) if (!listed.has(e.id)) tally(unlistedTypes, e.type);
    for (const e of derived.elements) {
      if (!listed.has(e.id)) continue;
      if (e.sheet?.display === false) tally(hiddenByType, e.type);
      for (const hint of ['alt', 'usage', 'action'] as const) if (e.sheet?.[hint] !== undefined) tally(hints, hint);
    }

    // Saves and skills, worked from Aurora's own list of the character's elements and the book: the ability modifier,
    // plus the proficiency bonus when the list holds the proficiency, twice it when it holds the expertise. Only where
    // nothing the character holds adds to the row by another rule (Jack of All Trades, an item), which is reported.
    const value = (key: string): number => derived.stats.get(key)?.value ?? 0;
    const row = (section: string, stat: string) => sheet.sections.find((s) => s.id === section)?.rows.find((r) => r.stat === stat)?.value;
    const writesTo = (stat: string): boolean =>
      derived.elements.some((e) => e.rules.some((r) => r.kind === 'stat' && r.name.toLowerCase() === stat));
    const held = new Set(run.save.sum.map((id) => id.replace(/_/g, '')));
    const pb = value('proficiency');
    const check = (section: string, stat: string, ability: string, proficient: boolean, expert: boolean): void => {
      const misc = section === 'saves' ? `${ability}:save:misc` : `${stat}:misc`;
      if (writesTo(stat)) return void others++;
      if (writesTo(misc)) {
        // Something else adds to it (Jack of All Trades, an item): the row is its three terms as the derivation has them.
        others++;
        const terms = signed(value(`${ability}:modifier`) + value(misc.replace(/misc$/, 'proficiency')) + value(misc));
        if (row(section, stat) !== terms) disagree.push(`${sample.id} ${stat} ${row(section, stat)} (its terms ${terms})`);
        return;
      }
      const expected = signed(value(`${ability}:modifier`) + (proficient ? pb * (expert ? 2 : 1) : 0));
      if (row(section, stat) === expected) agree++;
      else disagree.push(`${sample.id} ${stat} ${row(section, stat)} (book ${expected})`);
    };
    for (const stat of saves) {
      const ability = stat.split(':')[0]!;
      check('saves', stat, ability, held.has(`IDPROFICIENCYSAVINGTHROW${ability.toUpperCase()}`), false);
    }
    const abilityOf = new Map(
      kind.stats.filter((s) => skills.includes(s.name)).map((s) => [s.name, JSON.stringify(s.derive).match(/"stat":"([a-z]+):modifier"/)![1]!]),
    );
    for (const stat of skills) {
      const id = skillId(stat);
      check('skills', stat, abilityOf.get(stat)!, held.has(`IDPROFICIENCYSKILL${id}`), held.has(`IDINTERNALPROFICIENCYSKILLEXPERTISE${id}`));
    }

    // Spell slots: the shared pool where the character has a shared caster level, else each block's own table; and a
    // block that casts alone beside a pool keeps its own. Read from the stats the derivation publishes, not the sheet's.
    const shownSlots = sheet.sections
      .filter((s) => s.id === 'slots' || s.id.startsWith('block-slots:'))
      .flatMap((s) => s.rows.map((r) => `${s.id === 'slots' ? 'pool' : s.id.slice('block-slots:'.length)} ${r.label} ${r.value}`))
      .sort();
    const pool = value('multiclass:spellcasting:level') > 0;
    const expected: string[] = [];
    for (const [key, stat] of derived.stats) {
      const own = /^(.+):spellcasting:slots:(\d)$/.exec(key);
      const shared = /^spellcasting:slots:(\d)$/.exec(key);
      if (!stat.value) continue;
      const label = (n: string) => kind.stats.find((s) => s.name === `spellcasting:slots:${n}`)!.label;
      if (shared && pool) expected.push(`pool ${label(shared[1]!)} ${stat.value}`);
      if (own && (!pool || value(`${own[1]}:spellcasting:solo`) > 0)) expected.push(`${own[1]} ${label(own[2]!)} ${stat.value}`);
    }
    if (expected.length) casters++;
    if (JSON.stringify(shownSlots) !== JSON.stringify(expected.sort())) slotMismatch.push(`${sample.id}: shown [${shownSlots.join('; ')}], has [${expected.join('; ')}]`);
  }

  t.diagnostic(`held elements no section lists, by type (summed over the samples): ${show(unlistedTypes)}`);
  t.diagnostic(`listed elements content marks not for the sheet, by type: ${show(hiddenByType)}; listed elements with another sheet hint: ${show(hints)}`);
  t.diagnostic(`saves and skills worked from Aurora's list and the book: ${agree} agree, ${disagree.length} differ; ${others} rows something else adds to, not worked`);
  t.diagnostic(`samples with spell slots: ${casters}; showing other slots than they cast with: ${slotMismatch.length}`);
  // Fails if a block stat's label is removed, or a row is shown that no label names.
  assert.deepEqual(keyed, []);
  // Fails if the pool is shown as it was: a single-class caster's nine zeros.
  assert.deepEqual(zeros, []);
  // Fails if a skill's or a save's formula loses a term.
  assert.deepEqual(disagree, []);
  // Fails if every block's own table is shown (a multiclass caster's classes beside its pool), or none is.
  assert.deepEqual(slotMismatch, []);
});

test('a creature\'s NPC prints its first line and its scores\' modifiers, and what else it prints', { skip: corpusSkip }, async (t) => {
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
  const wrong: string[] = [];
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
    const sheet = sheetView(derived, npc);
    const first = sheet.sections[0];
    if (first?.elements[0]?.elementId !== creature.id) wrong.push(`${creature.name}: the first section does not name it`);
    for (const setter of ['size', 'type', 'alignment', 'ac', 'hp']) {
      const text = creature.setters[setter]?.value.trim();
      const lines = sheet.sections.flatMap((s) => s.printed).map((p) => p.text);
      if (text && !lines.includes(text)) wrong.push(`${creature.name}: its ${setter} is not printed`);
    }
    for (const r of sheet.sections.find((s) => s.id === 'abilities')?.rows ?? []) {
      if (r.beside !== signed(Math.floor((Number(r.value) - 10) / 2))) wrong.push(`${creature.name}: ${r.stat} ${r.value} beside ${r.beside}`);
    }
    if (zeroSections(sheet).length || keyedRows(sheet).length) wrong.push(`${creature.name}: ${[...zeroSections(sheet), ...keyedRows(sheet)].join(', ')}`);
  }
  t.diagnostic(`creatures: ${creatures.length}`);
  t.diagnostic(`setters a creature prints that no NPC section prints, by creatures carrying one: ${show(unshown)}`);
  const blank = sheetView(deriveCharacter(newCharacterOfKind(system, 'npc'), system, elements, { kind: npc }), npc);
  t.diagnostic(`an NPC from nothing draws ${blank.sections.map((s) => s.id).join(', ')}`);
  // Fails if the NPC's first line is not printed, or its scores' modifiers are not beside them.
  assert.deepEqual(wrong, []);
});

test('a held creature\'s stat block shows its scores\' modifiers and its first line', { skip: corpusSkip }, async () => {
  const system = await loadShippedSystem('dnd5e');
  const pc = resolveCharacterKind(system, 'pc');
  const elements = await realElements();
  // The player character's own element whose creature select has no filter: equipped, it lets any creature be chosen.
  const own = new Set([...pc.buildSteps.flatMap((x) => x.types), ...pc.sheet.sections.flatMap((x) => x.types ?? [])]);
  const creatureTypes = new Set(pc.companions?.types ?? []);
  let way: { element: Element; ruleKey: string } | undefined;
  for (const element of elements.all()) {
    if (way || !own.has(element.type)) continue;
    for (const rule of element.rules) {
      if (rule.kind === 'select' && creatureTypes.has(rule.type) && !rule.supports) way = { element, ruleKey: `${element.id}/select:${rule.name}` };
    }
  }
  assert.ok(way, 'content offers every creature to a player character through one element');
  const owl = [...elements.all()].find((e) => creatureTypes.has(e.type) && e.setters['size'] && e.setters['alignment'])!;
  const derived: DerivedCharacter = deriveCharacter(
    {
      ...newCharacterOfKind(system, 'pc'),
      progress: 5,
      inventory: [{ instanceId: 'holding', elementId: way.element.id, equipped: true }],
      choices: [{ ruleKey: way.ruleKey, elementIds: [owl.id] }],
    },
    system,
    elements,
    { kind: pc },
  );
  const view = companionsView(derived, pc, elements)!;
  const sections = view.creatures[0]!.sections;
  const printed = sections.flatMap((s) => s.printed).map((p) => p.text);
  // Fails if the scope's sheet loses its first line, or its scores' modifiers.
  assert.ok(printed.includes(owl.setters['size']!.value.trim()) && printed.includes(owl.setters['alignment']!.value.trim()), printed.join(' | '));
  for (const r of sections.find((s) => s.id === 'abilities')!.rows) assert.equal(r.beside, signed(Math.floor((Number(r.value) - 10) / 2)), r.stat);
});

test('what content says about the sheet itself', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const hints = new Map<string, number>();
  const hidden = new Map<string, number>();
  for (const element of elements.all()) {
    const sheet = element.sheet;
    if (!sheet) continue;
    tally(hints, 'any');
    for (const [key, value] of Object.entries(sheet)) if (value !== undefined) tally(hints, key === 'display' ? `display=${value}` : key);
    if (sheet.display === false) tally(hidden, element.type);
  }
  t.diagnostic(`elements with a <sheet> hint, by what it says: ${show(hints)}`);
  t.diagnostic(`marked display="false", by type: ${show(hidden)}`);
});

test('Cairn\'s only kind draws a sheet its steps can fill', async (t) => {
  const system: GameSystem = await loadShippedSystem('cairn');
  const kind: ResolvedCharacterKind = resolveCharacterKind(system, system.characterKinds[0]!.id);
  const builder = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, new BundleElementIndex([]));
  const budgeted = builder.getState().steps.filter((s) => s.budget);
  // Fails if a Cairn step's budget is removed: nothing sets that score, and every character reads 10, 10, 10 and 1.
  const targets = new Set(budgeted.flatMap((s) => s.budget!.targets));
  const scores = kind.sheet.sections.find((s) => (s.stats ?? []).length)!.stats!;
  assert.deepEqual(scores.filter((stat) => !targets.has(stat)), [], 'every score on the sheet can be entered');
  const entered = new Map<string, number>();
  for (const step of budgeted) {
    for (const [at, stat] of step.budget!.targets.entries()) {
      const typed = 4 + at;
      builder.setBudgetStat(step.id, stat, typed);
      entered.set(stat, typed);
    }
  }
  const state = builder.getState();
  const rows = new Map(state.sheet.sections.flatMap((s) => s.rows).map((r) => [r.stat, r.value]));
  for (const [stat, typed] of entered) assert.equal(rows.get(stat), String(typed), `${stat} on the sheet is what was entered`);
  assert.deepEqual(keyedRows(state.sheet), []);
  t.diagnostic(`cairn/${kind.id}: ${state.sheet.sections.map((s) => `${s.label}: ${s.rows.map((r) => `${r.label} ${r.value}`).join(', ')}`).join('; ')}`);
  t.diagnostic(`steps: ${state.steps.map((s) => `${s.id} (${s.complete ? 'complete' : 'open'})`).join(', ')}`);
});
