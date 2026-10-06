/**
 * Which numbers on a sheet are moved by something the sheet does not list — measured before deciding how a row says why.
 *
 * A sheet section declaring `omitHidden` (ADR 0076) leaves out what content marks `<sheet display="false">`, so a feat
 * like the 2024 Tough is not in the feature list, and the hit points it adds have no reason beside them. This asks, on
 * the thirty samples, reported as `ℹ` lines and asserting nothing (ADR 0042):
 *
 * - **What is omitted**: held elements a section declaring `omitHidden` would list, marked hidden, and listed by no other
 *   section of the sheet (a race is hidden too, and named in the Character header).
 * - **What they move, directly**: every row on the sheet whose stat's published contributions (`ResolvedStat
 *   .contributions`, `from` the element) name an omitted element, by row and by element.
 * - **What they move through a formula**: a row whose stat the kind derives (`derive`) from stats an omitted element
 *   contributes to, followed through the kind's own formulas. Reading a formula's references is not recomputing it, but
 *   it is a second reader of the system's arithmetic; counted apart to see whether the direct reading is enough.
 *
 * The first run, on AuroraLegacy/elements at `c28ce6c`, found 198 omitted elements (99 class features, 53 racial traits,
 * 26 subclass features, 10 feats, 10 proficiencies) and 1,399 rows on the samples' sheets, of which **5 are moved
 * directly** by an omitted element, all of them Hit Points (Tough on four samples, Dwarven Toughness on one), and **24
 * only through a formula**: Speed by Fleet of Foot, and skills by Skill Expertise (9, each a row its mark already calls
 * expertise), the 2024 Jack of All Trades (9), and the 2024 Thaumaturge and Magician (4). No omitted element contributes
 * 0. Wider, what moves a row and is listed nowhere and is not omitted is the user's base scores, the kind's own
 * contributions, the casting blocks, the progression, and the ability score improvements (whose type no section lists).
 *
 * Since ADR 0095 a row names what moved it, and the second test holds that against any corpus, each assertion with the
 * perturbation that fails it.
 */

import { test } from 'node:test';

import assert from 'node:assert/strict';

import { BundleElementIndex, readCharacterContainer, type Element, type StatExpr } from '@incudo/core';
import { CharacterBuilder, packCharacter, rowAside, sheetDocument, sheetMarkdown, type BuilderState } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const tally = (into: Map<string, number>, key: string): void => void into.set(key, (into.get(key) ?? 0) + 1);
const show = (m: Map<string, number>, limit = 40): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

function refs(expr: StatExpr | undefined, into: Set<string> = new Set()): Set<string> {
  if (!expr) return into;
  switch (expr.kind) {
    case 'ref': into.add(expr.stat.toLowerCase()); break;
    case 'binary': refs(expr.left, into); refs(expr.right, into); break;
    case 'call': for (const a of expr.args) refs(a, into); break;
    case 'table': refs(expr.index, into); break;
    default: break;
  }
  return into;
}

test('on the samples: which sheet rows an element the sheet leaves out moves', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();

  const omittedByType = new Map<string, number>();
  const omittedMoving = new Map<string, number>();
  const directRows = new Map<string, number>();
  const viaFormulaRows = new Map<string, number>();
  const directPairs = new Map<string, number>();
  const zeroDirect = new Map<string, number>();
  const unlistedPairs = new Map<string, number>();
  let rowsTotal = 0;
  let rowsDirect = 0;
  let rowsViaFormulaOnly = 0;
  let samplesDirect = 0;
  const perSample: string[] = [];

  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    const { derived, kind, sheet } = state;
    const listed = new Set(sheet.sections.flatMap((s) => s.elements.map((e) => e.elementId)));
    const hiddenTypes = new Set(kind.sheet.sections.filter((s) => s.omitHidden).flatMap((s) => s.types ?? []));
    const omitted = new Map<string, Element>();
    for (const e of derived.elements) {
      if (hiddenTypes.has(e.type) && e.sheet?.display === false && !listed.has(e.id)) {
        omitted.set(e.id, e);
        tally(omittedByType, e.type);
      }
    }

    const derives = new Map(kind.stats.filter((d) => d.derive).map((d) => [d.name.toLowerCase(), d.derive!] as const));
    const movedBy = (stat: string, seen: Set<string>): Set<string> => {
      const key = stat.toLowerCase();
      const found = new Set<string>();
      if (seen.has(key)) return found;
      seen.add(key);
      for (const c of derived.stats.get(key)?.contributions ?? []) if (omitted.has(c.from) && c.value !== 0) found.add(c.from);
      for (const ref of refs(derives.get(key))) for (const id of movedBy(ref, seen)) found.add(id);
      return found;
    };

    // Wider: anything held that the sheet lists nowhere, of any type (internal markers, hidden items, a level element).
    for (const section of sheet.sections) {
      for (const row of section.rows) {
        for (const c of derived.stats.get(row.stat.toLowerCase())?.contributions ?? []) {
          if (c.value === 0 || listed.has(c.from) || omitted.has(c.from)) continue;
          const e = derived.elements.find((x) => x.id === c.from);
          tally(unlistedPairs, e ? `${row.label} ← ${e.type}: ${e.name}` : `${row.label} ← (${c.from.replace(/^block:.*/, 'block')})`);
        }
      }
    }

    let sampleDirect = 0;
    for (const section of sheet.sections) {
      for (const row of section.rows) {
        rowsTotal++;
        const contributions = derived.stats.get(row.stat.toLowerCase())?.contributions ?? [];
        const direct = new Set(contributions.filter((c) => omitted.has(c.from) && c.value !== 0).map((c) => c.from));
        for (const c of contributions) if (omitted.has(c.from) && c.value === 0) tally(zeroDirect, `${row.label} ← ${omitted.get(c.from)!.name}`);
        const all = movedBy(row.stat, new Set());
        if (direct.size) {
          rowsDirect++;
          sampleDirect++;
          tally(directRows, row.label);
          for (const id of direct) {
            tally(directPairs, `${row.label} ← ${omitted.get(id)!.name}`);
            tally(omittedMoving, omitted.get(id)!.name);
          }
        } else if (all.size) {
          rowsViaFormulaOnly++;
          tally(viaFormulaRows, `${row.label} ← ${[...all].map((id) => omitted.get(id)!.name).join(' + ')}`);
        }
      }
    }
    if (sampleDirect) samplesDirect++;
    perSample.push(`${sample.file} ${omitted.size} omitted, ${sampleDirect} rows moved`);
  }

  t.diagnostic(`omitted by type: ${show(omittedByType)}`);
  t.diagnostic(`rows on the samples' sheets: ${rowsTotal}; moved directly by an omitted element: ${rowsDirect} in ${samplesDirect} samples; only through a formula: ${rowsViaFormulaOnly}`);
  t.diagnostic(`directly, by row: ${show(directRows)}`);
  t.diagnostic(`directly, row ← element: ${show(directPairs, 80)}`);
  t.diagnostic(`omitted elements that move a row: ${show(omittedMoving, 80)}`);
  t.diagnostic(`contributing 0 (not counted): ${show(zeroDirect, 40)}`);
  t.diagnostic(`only through a formula: ${show(viaFormulaRows, 60)}`);
  t.diagnostic(`directly, by something else the sheet lists nowhere: ${show(unlistedPairs, 120)}`);
  for (const line of perSample) t.diagnostic(line);
});

/** What the sheet leaves out of this state: hidden, of a type a section declaring `omitHidden` lists, listed nowhere. */
function omittedOf(state: BuilderState): Map<string, Element> {
  const listed = new Set(state.sheet.sections.flatMap((s) => s.elements.map((e) => e.elementId)));
  const hiddenTypes = new Set(state.kind.sheet.sections.filter((s) => s.omitHidden).flatMap((s) => s.types ?? []));
  return new Map(state.derived.elements.filter((e) => hiddenTypes.has(e.type) && e.sheet?.display === false && !listed.has(e.id)).map((e) => [e.id, e]));
}

const rowsOf = (state: BuilderState): string[] =>
  state.sheet.sections.flatMap((s) => s.rows.filter((r) => r.including).map((r) => `${s.id} ${r.stat}: ${r.including!.join(' + ')}`));

test('on the samples, a row names what moved it that the sheet leaves out, and keeps it with no source', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const named: string[] = [];

  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    const { derived, kind, sheet } = state;
    const omitted = omittedOf(state);
    const derives = new Map(kind.stats.filter((d) => d.derive).map((d) => [d.name.toLowerCase(), d.derive!] as const));
    const markSections = new Map(kind.sheet.sections.filter((s) => s.mark).map((s) => [s.id, s.mark!.stat] as const));

    for (const section of sheet.sections) {
      for (const row of section.rows) {
        const contributions = derived.stats.get(row.stat.toLowerCase())?.contributions ?? [];
        // The row's mark, when shown, already says what its stat moved; the test's own walk leaves that stat out too.
        const markTemplate = row.mark && section.section ? markSections.get(section.section) : undefined;
        const markKey = markTemplate?.replace('{stat}', row.stat).toLowerCase();
        const walk = (stat: string, seen: Set<string>, into: string[]): string[] => {
          const key = stat.toLowerCase();
          if (seen.has(key) || key === markKey) return into;
          seen.add(key);
          for (const c of derived.stats.get(key)?.contributions ?? []) if (c.value !== 0 && omitted.has(c.from) && !into.includes(c.from)) into.push(c.from);
          for (const ref of refs(derives.get(key))) walk(ref, seen, into);
          return into;
        };
        const expected = walk(row.stat, new Set(), []).map((id) => { const e = omitted.get(id)!; return e.sheet?.alt || e.sheet?.name || e.name; });
        const where = `${sample.id} ${section.label}: ${row.label}`;
        // Perturbations: `nameWhatMovedRows` returning at once (Hit Points without Tough); not skipping the mark's stat
        // (Stealth naming Skill Expertise beside "expertise"); not following `derive` (Speed without Fleet of Foot).
        assert.deepEqual(row.including ?? [], expected, `${where} names what moved it`);
        // The headline, said directly: an omitted element contributing to the row's own stat is named. Perturbation:
        // reading only the formulas, never the row's own contributions.
        for (const c of contributions) {
          if (c.value !== 0 && omitted.has(c.from)) assert.ok(row.including?.length, `${where}: ${omitted.get(c.from)!.name} moved it and is named`);
        }
        if (row.including) named.push(`${where} (${rowAside(row)})`);
      }
    }

    // Every export of the document writes it: the Markdown with the row's own words.
    const markdown = sheetMarkdown(sheetDocument(state));
    for (const section of sheet.sections) {
      for (const row of section.rows.filter((r) => r.including)) {
        // Perturbation: `rowAside` ignoring `including` leaves "45" where "45 (including Tough)" is expected.
        assert.ok(markdown.includes(`(${rowAside(row)})`) && rowAside(row)!.includes(`including ${row.including![0]}`), `${sample.id} ${row.label} is exported with what moved it`);
      }
    }

    // Packed and reopened with no source: the save embeds what it holds, hidden or not (ADR 0012).
    const packed = packCharacter(state.character, run.system, run.elements, { generator: 'test', extraIds: run.imported.extraIds });
    const { container } = readCharacterContainer(packed.files);
    const reopened = new CharacterBuilder(container!.character, run.system, new BundleElementIndex(container!.content.elements)).getState();
    assert.deepEqual(rowsOf(reopened), rowsOf(state), `${sample.id} names the same with no source`);
  }

  t.diagnostic(`rows naming what moved them: ${named.length}`);
  for (const line of named) t.diagnostic(line);
});
