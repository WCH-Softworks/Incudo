/**
 * The differential check over the real Aurora saves (ADR 0008's second DONE criterion, ADR 0039's
 * replacement for `incudo aurora verify`, and ADR 0042's policy for a corpus that moves).
 *
 * Aurora wrote its own answer into every save it ever produced — every element its engine ended up
 * with, and the spell slots, save DC and attack bonus of each casting block — and those answers
 * were checked for ten years by people whose characters would have been wrong otherwise. This
 * imports each save against the real corpus, derives it, and diffs. A disagreement points at a
 * bug in the engine, the system definition or the content; nothing else this project can get for
 * free is worth as much.
 *
 * **What fails, and what is only reported (ADR 0042).** The saves are frozen and the corpus is the
 * current head of the official repository, so the table of differences moves whenever upstream does.
 * A count is therefore not a gate. What fails is what must hold against *any* corpus, and it is
 * `oracleViolations`: the save imports, no `stat-mismatch`, no `spell-missing`, every `element-missing`
 * is an Aurora-app marker, and no row Aurora recorded went uncompared. Every other number is printed,
 * per save, beside the table recorded when the save was last understood, and a change is a `MOVED` line
 * for a person to read. Recorded tables are *reports*, not pins: a pin that fails when upstream adds a
 * feature teaches everyone to update pins.
 *
 * **What that costs.** An engine change that grants a handful of elements it should not used to fail a
 * pin. It now fails nothing here, and shows only as a `MOVED` line. What tells an engine change from
 * upstream churn is a run of the same corpus on two versions of the engine, and this file makes that
 * possible without running anything twice by itself: `INCUDO_ORACLE_SNAPSHOT=<file>` writes every save's
 * differences to a file, and `INCUDO_ORACLE_BASELINE=<file>` compares this run with one written earlier
 * and **fails on any difference**. Snapshot on the base, baseline on the change, same checkout.
 *
 * It cannot run in CI until saves are committed, and until then it skips wherever they are not
 * (`tools/verify/fixtures/saves/`, or a folder `INCUDO_AURORA_SAVES` names; once that is set a missing
 * path fails).
 *
 * Nothing here prints a character's name or any of its contents. A save is labelled by the first
 * characters of its fingerprint, which says nothing about the character, every assertion is on counts
 * and kinds, and the messages behind a failure name content (elements, spells, stats) and never the
 * character. `INCUDO_ORACLE_DETAIL=1` adds every difference message to the report, for chasing one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import type { DifferenceKind } from '@incudo/aurora-import';

import {
  AURORA_APP_MARKERS,
  countKinds,
  differenceLines,
  isAuroraAppMarker,
  lineDelta,
  oracleViolations,
  rowsCompared,
  runOracle,
  type OracleRun,
  type RowFamily,
} from './aurora-oracle.ts';
import { unnamed } from './private-saves.ts';
import { corpusCommit, corpusProvenance, realElements, requireCorpus, requireSaves, savesSkip } from './real-data.ts';

/** One save's recorded table. Every kind not named is zero. */
interface Recorded {
  kinds: Partial<Record<DifferenceKind, number>>;
  /** Problems the engine reports while deriving this save. */
  problems: number;
  /** `<spellcasting>` blocks the save records, and so its slot rows, save DCs and attack bonuses. */
  blocks: number;
}

/** The corpus commit the tables below were last confirmed against. Recorded, never asserted. */
const RECORDED_AT = 'c28ce6cd77ff';

/**
 * The saves the maintainer has, each with the table it had when it was last understood. A `MOVED` line
 * is not a failure and updating one is not a decision: every `element-extra` is content AuroraLegacy
 * added after the save was written, or the Mithral finding, or the Thieves' Tools expertise pair below;
 * every `element-missing` is an Aurora-app marker nothing in the corpus names.
 *
 * Summed, the first nine are the baseline CLAUDE.md records: 1 element-missing, 55 element-extra,
 * 13 content-missing, 3 not-modelled, 8 blocks. The tenth is the Wizard 4 / Rogue 4 built from the
 * description in ROADMAP Phase 2, and it is the only save with two ordinary casting blocks, which is
 * how ADR 0041 came about.
 */
const RECORDED: Record<string, Recorded> = {
  a6e7af83ffc5: { kinds: { 'element-extra': 4, 'not-modelled': 1 }, problems: 0, blocks: 1 },
  '2a42b19e161c': { kinds: { 'element-extra': 2 }, problems: 0, blocks: 0 },
  // The multiclass Paladin 2 / Warlock 18. Its one element-missing is `ID_INTERNAL_MULTICLASS_LEVEL_3`.
  f5a37e331281: { kinds: { 'element-missing': 1, 'element-extra': 1, 'content-missing': 3, 'not-modelled': 2 }, problems: 0, blocks: 2 },
  b875c2550bcf: { kinds: { 'element-extra': 7 }, problems: 0, blocks: 0 },
  e0f195948e29: { kinds: { 'element-extra': 14, 'content-missing': 3 }, problems: 0, blocks: 1 },
  '4fbf1af53fcb': { kinds: { 'element-extra': 4 }, problems: 0, blocks: 1 },
  '9ecc6a221900': { kinds: { 'element-extra': 6, 'content-missing': 4 }, problems: 1, blocks: 1 },
  '5fc63055c196': { kinds: { 'element-extra': 14, 'content-missing': 3 }, problems: 0, blocks: 1 },
  '01b3f35cda2e': { kinds: { 'element-extra': 3 }, problems: 0, blocks: 1 },
  // The Wizard 4 / Arcane Trickster 4. Its element-missing is `ID_INTERNAL_MULTICLASS_LEVEL_5`, the
  // same marker as the Paladin/Warlock's, named for the character level the second class began at.
  // Its two extras are the Thieves' Tools expertise elements Aurora never derived, in this save and in
  // the Rogue 8's alike. Aurora's updater rewrote `class-rogue.xml` a quarter of an hour before this
  // save was written, so it may have been running on the older copy it had already loaded, which is
  // the ordinary "content added after the save" species. Unconfirmed: restart Aurora, reopen the
  // character and save it again, and if the pair goes the save has a new fingerprint and a new record.
  b8acec08a7fe: { kinds: { 'element-missing': 1, 'element-extra': 2, 'not-modelled': 1 }, problems: 0, blocks: 2 },
};

const KINDS: DifferenceKind[] = [
  'element-missing',
  'element-extra',
  'spell-missing',
  'stat-mismatch',
  'content-missing',
  'not-modelled',
];

interface Measured {
  /** The first twelve characters of a hash of the file: what a save is, whatever it is called. */
  id: string;
  run: OracleRun;
  rows: Record<RowFamily, number>;
}

function tableOf(run: OracleRun): Recorded {
  const found = countKinds([run.comparison]);
  return {
    kinds: Object.fromEntries(KINDS.filter((k) => found[k] > 0).map((k) => [k, found[k]])),
    problems: run.derived.problems.length,
    blocks: run.save.magic.length,
  };
}

const describeTable = (table: Recorded): string =>
  `${
    Object.entries(table.kinds)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ') || 'no differences'
  }; ${table.blocks} block(s); ${table.problems} problem(s)`;

// --- the pieces that need no corpus ---------------------------------------------

test('the Aurora-app allowlist is exactly the marker family, and nothing wider', () => {
  assert.equal(AURORA_APP_MARKERS.length, 1, 'a new allowlist entry is a decision (ADR 0042), not an edit');
  assert.ok(isAuroraAppMarker('ID_INTERNAL_MULTICLASS_LEVEL_3'));
  assert.ok(isAuroraAppMarker('ID_INTERNAL_MULTICLASS_LEVEL_12'));
  // Nothing that merely resembles it, and nothing a content file can declare, is excused.
  for (const id of [
    'ID_INTERNAL_MULTICLASS_LEVEL_',
    'ID_INTERNAL_MULTICLASS_LEVEL_3_EXTRA',
    'ID_INTERNAL_GRANT_MULTICLASS',
    'ID_WOTC_PHB_MULTICLASS_WARLOCK',
    'ID_INTERNAL_MULTICLASS_LEVEL_X',
  ]) {
    assert.equal(isAuroraAppMarker(id), false, id);
  }
});

test('a difference list is compared as a multiset, so a swap reads as a swap', () => {
  assert.deepEqual(lineDelta(['a', 'b'], ['a', 'b']), { removed: [], added: [] });
  assert.deepEqual(lineDelta(['a', 'b'], ['a', 'c']), { removed: ['b'], added: ['c'] });
  // A repeated line is a count, not a set member.
  assert.deepEqual(lineDelta(['a'], ['a', 'a']), { removed: [], added: ['a'] });
  assert.deepEqual(lineDelta(['a', 'a'], ['a']), { removed: ['a'], added: [] });
});

// --- the real thing -------------------------------------------------------------

test(
  'every real save satisfies the invariants against the current corpus',
  { skip: savesSkip },
  async (t) => {
    const location = requireCorpus();
    const savesDir = requireSaves();

    const names = (await readdir(savesDir)).filter((name) => extname(name).toLowerCase() === '.dnd5e');
    assert.ok(names.length > 0, 'there is at least one .dnd5e save to check');

    const corpus = await realElements();
    t.diagnostic(corpusProvenance());

    const measured: Measured[] = [];
    for (const name of names) {
      const path = join(savesDir, name);
      const bytes = await unnamed('reading a save', () => readFile(path));
      const id = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      const run = await runOracle(path, corpus, location.index);
      measured.push({ id, run, rows: rowsCompared(run) });
    }
    // Sorted by fingerprint so the report reads the same whatever the folder holds or calls things.
    measured.sort((a, b) => (a.id < b.id ? -1 : 1));

    // 1. The report. Every number, per save, and where it moved from the recorded table.
    const detail = process.env['INCUDO_ORACLE_DETAIL'] === '1';
    for (const { id, run, rows } of measured) {
      const table = tableOf(run);
      const recorded = RECORDED[id];
      t.diagnostic(
        `save ${id.slice(0, 8)} (${recorded ? 'recorded' : 'NOT RECORDED'}): Aurora derived ` +
          `${run.comparison.auroraElements} elements, Incudo ${run.comparison.incudoElements}; ` +
          `${describeTable(table)}; rows ${JSON.stringify(rows)}`,
      );
      if (recorded && JSON.stringify(recorded) !== JSON.stringify(table)) {
        t.diagnostic(
          `save ${id.slice(0, 8)} MOVED since it was recorded at ${RECORDED_AT}: ` +
            `was ${describeTable(recorded)}, now ${describeTable(table)}`,
        );
      }
      if (detail) {
        for (const d of run.comparison.differences) t.diagnostic(`  ${d.kind}  ${d.message}`);
      }
    }
    const commit = corpusCommit();
    if (commit && !commit.sha.startsWith(RECORDED_AT)) {
      t.diagnostic(`the recorded tables were confirmed at ${RECORDED_AT}; this corpus is at ${commit.sha.slice(0, 12)}`);
    }

    // 2. The invariants, for every save, recorded or not: the only failures upstream can neither cause
    //    nor excuse. A new character is held to exactly these the day it is saved.
    const broken = measured.flatMap(({ id, run, rows }) =>
      oracleViolations(run, rows).map((line) => `save ${id.slice(0, 8)}  ${line}`),
    );
    assert.deepEqual(broken, [], `An invariant does not hold:\n  ${broken.join('\n  ')}`);

    // 3. A recorded table whose save has gone is a referee lost, and it says which one rather than
    //    letting a smaller folder pass. (This is about the folder, not the corpus.)
    const present = new Set(measured.map((m) => m.id));
    for (const id of Object.keys(RECORDED)) {
      assert.ok(present.has(id), `the save recorded as ${id.slice(0, 8)} is not in the saves folder`);
    }

    // 4. The engine-versus-upstream check, opt in. Two runs on the same checkout, one per version of the
    //    engine, are the only thing that separates a change here from a change there.
    const snapshot = Object.fromEntries(
      measured.map(({ id, run, rows }) => [
        id.slice(0, 12),
        { differences: differenceLines(run), problems: run.derived.problems.length, rows },
      ]),
    );
    const baselinePath = process.env['INCUDO_ORACLE_BASELINE'];
    if (baselinePath) {
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as typeof snapshot;
      const moved: string[] = [];
      for (const id of new Set([...Object.keys(baseline), ...Object.keys(snapshot)])) {
        const before = baseline[id];
        const after = snapshot[id];
        if (!before || !after) {
          moved.push(`save ${id.slice(0, 8)} is ${before ? 'gone from' : 'new in'} this run`);
          continue;
        }
        const delta = lineDelta(before.differences, after.differences);
        for (const line of delta.removed) moved.push(`save ${id.slice(0, 8)}  no longer: ${line}`);
        for (const line of delta.added) moved.push(`save ${id.slice(0, 8)}  now: ${line}`);
        if (before.problems !== after.problems) {
          moved.push(`save ${id.slice(0, 8)}  problems ${before.problems} -> ${after.problems}`);
        }
        if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) {
          moved.push(`save ${id.slice(0, 8)}  rows compared ${JSON.stringify(before.rows)} -> ${JSON.stringify(after.rows)}`);
        }
      }
      assert.deepEqual(moved, [], `This run differs from the baseline it was told to match:\n  ${moved.join('\n  ')}`);
    }
    const snapshotPath = process.env['INCUDO_ORACLE_SNAPSHOT'];
    if (snapshotPath) {
      await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      t.diagnostic(`wrote a snapshot of ${measured.length} save(s) for INCUDO_ORACLE_BASELINE`);
    }
  },
);
