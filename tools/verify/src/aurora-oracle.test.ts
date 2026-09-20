/**
 * The differential check over the real Aurora saves (ADR 0008's second DONE criterion, and
 * ADR 0039's replacement for `incudo aurora verify`).
 *
 * Aurora wrote its own answer into every save it ever produced — every element its engine ended up
 * with, and the spell slots, save DC and attack bonus of each casting block — and those answers
 * were checked for ten years by people whose characters would have been wrong otherwise. This
 * imports each save against the real corpus, derives it, and diffs. A disagreement points at a
 * bug in the engine, the system definition or the content; nothing else this project can get for
 * free is worth as much.
 *
 * **What is pinned is each save's own table, keyed by what the save is.** Not the folder: an
 * earlier version pinned totals over "the nine files in the directory" and asserted that there were
 * nine, so adding a character to the folder failed it and told the maintainer nothing. Each pinned
 * save is found by a fingerprint of its bytes, so it does not matter what it is called, where it
 * sorts, or how many other saves sit beside it. A save with no pin is held to the invariants that
 * must always hold (it imports, and nothing in it is a `stat-mismatch` or a `spell-missing`) and its
 * numbers are reported, so a new character can be checked the day it is saved and pinned when its
 * differences are understood.
 *
 * Both halves of a pin matter: how many differences of each kind, and how many rows of each family
 * were compared at all. A count that drifts up is a regression; a count that drifts down is content
 * that was fixed or a comparison that quietly stopped, and this file cannot tell which, so it makes
 * someone look.
 *
 * It cannot run in CI and never could: the saves are personal data and stay on the maintainer's
 * machine (CLAUDE.md), so it skips wherever they are not. `INCUDO_AURORA_INDEX` and
 * `INCUDO_AURORA_SAVES` say where they are, and once either is set a missing path fails.
 *
 * Nothing here prints a character's name or any of its contents. A save is labelled by the first
 * characters of its fingerprint, which says nothing about the character, every assertion is on counts
 * and kinds, and the messages behind a failure name content (elements, spells, stats) and never the
 * character. `INCUDO_ORACLE_DETAIL=1` adds every difference message to the report, for chasing one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

import type { DifferenceKind } from '@incudo/aurora-import';

import {
  countKinds,
  rowsCompared,
  runOracle,
  type OracleRun,
  type RowFamily,
} from './aurora-oracle.ts';
import { unnamed } from './private-saves.ts';
import { realElements, requireCorpus, requireSaves, savesSkip } from './real-data.ts';

/** One save's recorded table. Every kind not named is zero. */
interface Pin {
  kinds: Partial<Record<DifferenceKind, number>>;
  /** Problems the engine reports while deriving this save. */
  problems: number;
  /** `<spellcasting>` blocks the save records, and so its slot rows, save DCs and attack bonuses. */
  blocks: number;
  /** Rows of each family that were compared and agree, measured by breaking each one. */
  rows: Record<RowFamily, number>;
}

/**
 * The saves the maintainer has, each with its own numbers. Moving one is a decision, and the reason
 * belongs in the commit: every `element-extra` is content AuroraLegacy added after the save was
 * written, or the Mithral finding, or the Thieves' Tools expertise pair below; every
 * `element-missing` is an Aurora-app marker nothing in the corpus names.
 *
 * Summed, the first nine are the baseline CLAUDE.md records: 1 element-missing, 55 element-extra,
 * 13 content-missing, 3 not-modelled, 8 blocks and 8 rows of each family. The tenth is the Wizard 4 /
 * Rogue 4 built from the description in ROADMAP Phase 2, and it is the only save with two ordinary
 * casting blocks, which is how ADR 0041 came about.
 */
const PINNED: Record<string, Pin> = {
  a6e7af83ffc5: { kinds: { 'element-extra': 4, 'not-modelled': 1 }, problems: 0, blocks: 1, rows: { slots: 1, dc: 1, attack: 1, casterLevel: 0 } },
  '2a42b19e161c': { kinds: { 'element-extra': 2 }, problems: 0, blocks: 0, rows: { slots: 0, dc: 0, attack: 0, casterLevel: 0 } },
  // The multiclass Paladin 2 / Warlock 18. Its one element-missing is `ID_INTERNAL_MULTICLASS_LEVEL_3`.
  f5a37e331281: { kinds: { 'element-missing': 1, 'element-extra': 1, 'content-missing': 3, 'not-modelled': 2 }, problems: 0, blocks: 2, rows: { slots: 2, dc: 2, attack: 2, casterLevel: 1 } },
  b875c2550bcf: { kinds: { 'element-extra': 7 }, problems: 0, blocks: 0, rows: { slots: 0, dc: 0, attack: 0, casterLevel: 0 } },
  e0f195948e29: { kinds: { 'element-extra': 14, 'content-missing': 3 }, problems: 0, blocks: 1, rows: { slots: 1, dc: 1, attack: 1, casterLevel: 0 } },
  '4fbf1af53fcb': { kinds: { 'element-extra': 4 }, problems: 0, blocks: 1, rows: { slots: 1, dc: 1, attack: 1, casterLevel: 0 } },
  '9ecc6a221900': { kinds: { 'element-extra': 6, 'content-missing': 4 }, problems: 1, blocks: 1, rows: { slots: 1, dc: 1, attack: 1, casterLevel: 0 } },
  '5fc63055c196': { kinds: { 'element-extra': 14, 'content-missing': 3 }, problems: 0, blocks: 1, rows: { slots: 1, dc: 1, attack: 1, casterLevel: 0 } },
  '01b3f35cda2e': { kinds: { 'element-extra': 3 }, problems: 0, blocks: 1, rows: { slots: 1, dc: 1, attack: 1, casterLevel: 0 } },
  // The Wizard 4 / Arcane Trickster 4. Its element-missing is `ID_INTERNAL_MULTICLASS_LEVEL_5`, the
  // same marker as the Paladin/Warlock's, named for the character level the second class began at.
  // Its two extras are the Thieves' Tools expertise elements Aurora never derived, in this save and in
  // the Rogue 8's alike. Aurora's updater rewrote `class-rogue.xml` a quarter of an hour before this
  // save was written, so it may have been running on the older copy it had already loaded, which is
  // the ordinary "content added after the save" species. Unconfirmed: restart Aurora, reopen the
  // character and save it again, and if the pair goes the save has a new fingerprint and a new pin.
  b8acec08a7fe: { kinds: { 'element-missing': 1, 'element-extra': 2, 'not-modelled': 1 }, problems: 0, blocks: 2, rows: { slots: 2, dc: 2, attack: 2, casterLevel: 1 } },
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
  /** The first eight characters of a hash of the file: what a save is, whatever it is called. */
  id: string;
  run: OracleRun;
}

function tableOf(run: OracleRun): Pin {
  const found = countKinds([run.comparison]);
  return {
    kinds: Object.fromEntries(KINDS.filter((k) => found[k] > 0).map((k) => [k, found[k]])),
    problems: run.derived.problems.length,
    blocks: run.save.magic.length,
    rows: rowsCompared(run),
  };
}

const describeTable = (pin: Pin): string =>
  `${
    Object.entries(pin.kinds)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ') || 'no differences'
  }; ${pin.blocks} block(s); rows ${JSON.stringify(pin.rows)}; ${pin.problems} problem(s)`;

test(
  'every real save agrees with Aurora on everything both sides model',
  { skip: savesSkip },
  async (t) => {
    const location = requireCorpus();
    const savesDir = requireSaves();

    const names = (await readdir(savesDir)).filter((name) => extname(name).toLowerCase() === '.dnd5e');
    assert.ok(names.length > 0, 'there is at least one .dnd5e save to check');

    const corpus = await realElements();

    const measured: Measured[] = [];
    for (const name of names) {
      const path = join(savesDir, name);
      const bytes = await unnamed('reading a save', () => readFile(path));
      const id = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      measured.push({ id, run: await runOracle(path, corpus, location.index) });
    }
    // Sorted by fingerprint so the report reads the same whatever the folder holds or calls things.
    measured.sort((a, b) => (a.id < b.id ? -1 : 1));

    const detail = process.env['INCUDO_ORACLE_DETAIL'] === '1';
    for (const { id, run } of measured) {
      const pinned = id in PINNED ? 'pinned' : 'NOT PINNED';
      t.diagnostic(
        `save ${id.slice(0, 8)} (${pinned}): Aurora derived ${run.comparison.auroraElements} elements, ` +
          `Incudo ${run.comparison.incudoElements}; ${describeTable(tableOf(run))}`,
      );
      if (detail) {
        for (const d of run.comparison.differences) t.diagnostic(`  ${d.kind}  ${d.message}`);
      }
    }

    // 1. What must hold for every save, pinned or not, first and with its own message, so a
    //    regression reads as what it is before any table is compared. A new character is held to
    //    exactly this the day it is saved.
    for (const { id, run } of measured) {
      assert.deepEqual(
        run.imported.diagnostics.filter((d) => d.level === 'error'),
        [],
        `save ${id.slice(0, 8)} should import without errors`,
      );
    }
    const real = measured.flatMap(({ id, run }) =>
      run.comparison.differences
        .filter((d) => d.kind === 'stat-mismatch' || d.kind === 'spell-missing')
        .map((d) => `save ${id.slice(0, 8)}  ${d.kind}  ${d.elementId ?? ''}  ${d.message}`),
    );
    assert.deepEqual(real, [], `Incudo disagrees with Aurora's own numbers:\n  ${real.join('\n  ')}`);

    // 2. Every pin, against the save it belongs to. A pin whose save has gone is a referee lost, and
    //    it says which one rather than letting a smaller folder pass.
    const byId = new Map(measured.map((m) => [m.id, m.run]));
    for (const [id, pin] of Object.entries(PINNED)) {
      const run = byId.get(id);
      assert.ok(run, `the save pinned as ${id.slice(0, 8)} is not in the saves folder`);
      const label = `save ${id.slice(0, 8)}`;
      const found = tableOf(run);
      assert.deepEqual(found.kinds, pin.kinds, `${label}: difference kinds moved (${describeTable(found)})`);
      assert.equal(found.problems, pin.problems, `${label}: problems the engine reports while deriving`);
      assert.equal(found.blocks, pin.blocks, `${label}: spellcasting blocks recorded`);
      assert.deepEqual(found.rows, pin.rows, `${label}: rows compared, measured by breaking each one`);
    }

    // 3. A save with no pin is reported above, marked NOT PINNED, and not failed here: it is a
    //    character somebody has just made, not a regression.
  },
);
