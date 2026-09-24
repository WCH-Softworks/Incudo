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
 * The saves are the committed generic samples of docs/SAMPLE-SAVES.md, `tools/verify/fixtures/saves/`,
 * so this runs in CI. Each is labelled `Sample NN`, the messages behind a failure name content
 * (elements, spells, stats), and `INCUDO_ORACLE_DETAIL=1` adds every difference message to the report,
 * for chasing one.
 *
 * **Armour class, speed and hit points are the numbers here checked against a person.** Aurora's file
 * records no armour class and no speed, and never a hit point total, but its screen shows all three, and
 * the maintainer typed what it showed for every sample into the manifest (`readout`). It is a human
 * transcription, and it agrees with the derivation on all 30 for each, so each is held to it (speed: ADR
 * 0043; hit points: ADR 0044).
 *
 * **So are prepared lists** (ADR 0046): the maintainer read the preparable count of every class off the
 * screen, and the save records which spells are prepared and which spells a block lists. Both are held for
 * all 30 (`preparationViolations`); the always-prepared count is reported and not asserted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DifferenceKind } from '@incudo/aurora-import';

import {
  AURORA_APP_MARKERS,
  countKinds,
  differenceLines,
  isAuroraAppMarker,
  lineDelta,
  oracleViolations,
  preparationReport,
  preparationViolations,
  rowsCompared,
  runOracle,
  type OracleRun,
  type RowFamily,
} from './aurora-oracle.ts';
import { readManifest, sampleFileNames, SAMPLES_DIR } from './sample-saves.ts';
import { corpusCommit, corpusProvenance, realElements, requireCorpus, requireSaves, savesSkip } from './real-data.ts';

/** One save's recorded table. Every kind not named is zero. */
interface Recorded {
  kinds: Partial<Record<DifferenceKind, number>>;
  /** Problems the engine reports while deriving this save. */
  problems: number;
  /** `<spellcasting>` blocks the save records, and so its slot rows, save DCs and attack bonuses. */
  blocks: number;
}

const KINDS: DifferenceKind[] = [
  'element-missing',
  'element-extra',
  'spell-missing',
  'stat-mismatch',
  'content-missing',
  'not-modelled',
];

interface Measured {
  /** `Sample NN`: the character's name inside the file, which is what a sample is. */
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
    requireSaves();

    const names = sampleFileNames();
    assert.ok(names.length > 0, 'there is at least one .dnd5e save to check');
    const manifest = readManifest();
    const recordedAt = manifest.recordedAt?.slice(0, 12) ?? 'no commit';
    const byId = new Map(manifest.samples.map((sample) => [sample.id, sample]));

    const corpus = await realElements();
    t.diagnostic(corpusProvenance());

    const measured: Measured[] = [];
    for (const name of names) {
      const run = await runOracle(join(SAMPLES_DIR, name), corpus, location.index);
      measured.push({ id: run.imported.character.name, run, rows: rowsCompared(run) });
    }
    // Sorted by id so the report reads the same whatever order the folder lists things in.
    measured.sort((a, b) => (a.id < b.id ? -1 : 1));

    // 1. The report. Every number, per save, and where it moved from the recorded table.
    const detail = process.env['INCUDO_ORACLE_DETAIL'] === '1';
    for (const { id, run, rows } of measured) {
      const table = tableOf(run);
      const recorded = byId.get(id)?.recorded as Recorded | undefined;
      t.diagnostic(
        `${id} (${recorded ? 'recorded' : 'NOT RECORDED'}): Aurora derived ` +
          `${run.comparison.auroraElements} elements, Incudo ${run.comparison.incudoElements}; ` +
          `${describeTable(table)}; rows ${JSON.stringify(rows)}`,
      );
      if (recorded && JSON.stringify(recorded) !== JSON.stringify(table)) {
        t.diagnostic(
          `${id} MOVED since it was recorded at ${recordedAt}: ` +
            `was ${describeTable(recorded)}, now ${describeTable(table)}`,
        );
      }
      for (const line of preparationReport(run)) t.diagnostic(`  ${id} prepares: ${line}`);
      if (detail) {
        for (const d of run.comparison.differences) t.diagnostic(`  ${d.kind}  ${d.message}`);
      }
    }
    const commit = corpusCommit();
    if (commit && !commit.sha.startsWith(recordedAt)) {
      t.diagnostic(`the recorded tables were confirmed at ${recordedAt}; this corpus is at ${commit.sha.slice(0, 12)}`);
    }

    // 2. The invariants, for every save, recorded or not: the only failures upstream can neither cause
    //    nor excuse. A new character is held to exactly these the day it is saved.
    const broken = measured.flatMap(({ id, run, rows }) =>
      oracleViolations(run, rows).map((line) => `${id}  ${line}`),
    );
    assert.deepEqual(broken, [], `An invariant does not hold:\n  ${broken.join('\n  ')}`);

    // 3. Armour class, speed and hit points against what Aurora's screen showed, all held. A sample with no
    //    readout is held to the invariants only.
    const disagree: string[] = [];
    for (const { id, run } of measured) {
      const read = byId.get(id)?.readout;
      if (!read) continue;
      const stat = (name: string) => run.derived.stats.get(name)?.value;
      if (stat('ac') !== read.ac) disagree.push(`${id}: armour class reads ${read.ac} on Aurora's screen and ${stat('ac')} here`);
      if (stat('hp') !== read.hp) disagree.push(`${id}: hit points read ${read.hp} on Aurora's screen (${read.hpMethod}) and ${stat('hp')} here`);
      if (stat('speed') !== read.speed) disagree.push(`${id}: speed reads ${read.speed} on Aurora's screen and ${stat('speed')} here`);
    }
    assert.deepEqual(disagree, [], 'Incudo disagrees with what Aurora showed for armour class, speed or hit points');

    // 3b. Prepared lists (ADR 0046): what the save flags, what it lists, and the count the screen showed.
    const unprepared = measured.flatMap(({ id, run }) =>
      preparationViolations(run, byId.get(id)?.readout.prepared).map((line) => `${id}  ${line}`),
    );
    assert.deepEqual(unprepared, [], 'Incudo disagrees with Aurora about a prepared list');

    // A manifest entry whose save has gone is a referee lost, and it says which one.
    const present = new Set(measured.map((m) => m.id));
    for (const id of byId.keys()) assert.ok(present.has(id), `${id} is in the manifest and not in the saves folder`);

    // 4. The engine-versus-upstream check, opt in. Two runs on the same checkout, one per version of the
    //    engine, are the only thing that separates a change here from a change there.
    const snapshot = Object.fromEntries(
      measured.map(({ id, run, rows }) => [
        id,
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
          moved.push(`${id} is ${before ? 'gone from' : 'new in'} this run`);
          continue;
        }
        const delta = lineDelta(before.differences, after.differences);
        for (const line of delta.removed) moved.push(`${id}  no longer: ${line}`);
        for (const line of delta.added) moved.push(`${id}  now: ${line}`);
        if (before.problems !== after.problems) {
          moved.push(`${id}  problems ${before.problems} -> ${after.problems}`);
        }
        if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) {
          moved.push(`${id}  rows compared ${JSON.stringify(before.rows)} -> ${JSON.stringify(after.rows)}`);
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
