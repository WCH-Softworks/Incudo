/**
 * The differential check over the nine real Aurora saves (ADR 0008's second DONE criterion, and
 * ADR 0039's replacement for `incudo aurora verify`).
 *
 * Aurora wrote its own answer into every save it ever produced — every element its engine ended up
 * with, and the spell slots, save DC and attack bonus of each casting block — and those answers
 * were checked for ten years by people whose characters would have been wrong otherwise. This
 * imports each save against the real corpus, derives it, and diffs. A disagreement points at a
 * bug in the engine, the system definition or the content; nothing else this project can get for
 * free is worth as much.
 *
 * What is pinned is the *table*, not just "no mismatches": how many differences of each kind
 * there are, and how many rows of each family were compared at all. Both matter. A count that
 * drifts up is a regression; a count that drifts down is content that was fixed or a comparison
 * that quietly stopped, and this file cannot tell which, so it makes someone look.
 *
 * It cannot run in CI and never could: the saves are personal data and stay on the maintainer's
 * machine (CLAUDE.md), so it skips wherever they are not. `INCUDO_AURORA_INDEX` and
 * `INCUDO_AURORA_SAVES` say where they are, and once either is set a missing path fails.
 *
 * Nothing here prints a character's name or any of its contents. Saves are numbered by their
 * position in the sorted folder listing, every assertion is on counts and kinds, and the messages
 * behind a failure name content (elements, spells, stats) and never the character.
 * `INCUDO_ORACLE_DETAIL=1` adds every difference message to the report, for chasing an extra.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

import { corpusFromEnvironment, loadCorpus } from './corpus.ts';
import { countKinds, rowsCompared, runOracle, type OracleRun } from './aurora-oracle.ts';

/**
 * The baseline in CLAUDE.md, as numbers. Moving one is a decision, and the reason belongs in the
 * commit: every `element-extra` is content AuroraLegacy added after the saves were written or the
 * Mithral finding; the one `element-missing` is an Aurora-app marker nothing in the corpus names.
 */
const BASELINE = {
  saves: 9,
  kinds: {
    'element-missing': 1,
    'element-extra': 55,
    'spell-missing': 0,
    'stat-mismatch': 0,
    'content-missing': 13,
    'not-modelled': 3,
  },
  /** Problems the engine reports while deriving — the missing marker above, once. */
  problems: 1,
  /** Every `<magic>` block, and so every recorded slot row, save DC and attack bonus. */
  spellcastingBlocks: 8,
  rows: { slots: 8, dc: 8, attack: 8 },
};

const { location, configured: indexConfigured } = corpusFromEnvironment(process.env);
const savesConfigured = process.env['INCUDO_AURORA_SAVES'] !== undefined;
const savesDir = process.env['INCUDO_AURORA_SAVES'] ?? dirname(dirname(location.index));
const configured = indexConfigured || savesConfigured;
const present = existsSync(location.index) && existsSync(savesDir);

test(
  'the nine real saves agree with Aurora on everything both sides model',
  { skip: !configured && !present ? `no Aurora install with saves at ${savesDir}` : false },
  async (t) => {
    assert.ok(
      present,
      `INCUDO_AURORA_INDEX / INCUDO_AURORA_SAVES point at ${location.index} and ${savesDir}, and one ` +
        `of them does not exist. Failing rather than skipping: a skipped test is a green one.`,
    );

    const files = (await readdir(savesDir))
      .filter((name) => extname(name).toLowerCase() === '.dnd5e')
      .sort()
      .map((name) => join(savesDir, name));
    assert.equal(files.length, BASELINE.saves, 'how many saves the folder holds');

    const { library } = await loadCorpus(location);
    const corpus = library.elements;

    const runs: OracleRun[] = [];
    for (const file of files) runs.push(await runOracle(file, corpus, location.index));

    const detail = process.env['INCUDO_ORACLE_DETAIL'] === '1';
    runs.forEach((run, i) => {
      const kinds = Object.entries(countKinds([run.comparison]))
        .filter(([, n]) => n > 0)
        .map(([kind, n]) => `${n} ${kind}`)
        .join(', ');
      t.diagnostic(
        `save ${i + 1}/${runs.length}: Aurora derived ${run.comparison.auroraElements} elements, ` +
          `Incudo ${run.comparison.incudoElements}; ${run.save.magic.length} spellcasting block(s); ${kinds || 'no differences'}`,
      );
      if (detail) {
        for (const d of run.comparison.differences) t.diagnostic(`  ${d.kind}  ${d.message}`);
      }
    });

    // Imported cleanly: every save parsed and derived, or `runOracle` would have thrown.
    for (const run of runs) {
      assert.deepEqual(run.imported.diagnostics.filter((d) => d.level === 'error'), []);
    }

    // 1. The two kinds that are always a bug, first and with their own message, so a regression
    //    reads as what it is before the table below is even compared.
    const real = runs.flatMap((run, i) =>
      run.comparison.differences
        .filter((d) => d.kind === 'stat-mismatch' || d.kind === 'spell-missing')
        .map((d) => `save ${i + 1}  ${d.kind}  ${d.elementId ?? ''}  expected ${d.expected ?? '-'}  actual ${d.actual ?? '-'}`),
    );
    assert.deepEqual(real, [], `Incudo disagrees with Aurora's own numbers:\n  ${real.join('\n  ')}`);

    // 2. The whole table.
    const kinds = countKinds(runs.map((run) => run.comparison));
    assert.deepEqual(kinds, BASELINE.kinds, describeKinds(runs));

    const problems = runs.reduce((n, run) => n + run.derived.problems.length, 0);
    assert.equal(problems, BASELINE.problems, 'problems the engine reports while deriving');

    // 3. That the rows were compared and not skipped — see `rowsCompared`.
    const blocks = runs.reduce((n, run) => n + run.save.magic.length, 0);
    assert.equal(blocks, BASELINE.spellcastingBlocks, 'spellcasting blocks recorded across the saves');

    const rows = { slots: 0, dc: 0, attack: 0 };
    for (const run of runs) {
      const found = rowsCompared(run);
      rows.slots += found.slots;
      rows.dc += found.dc;
      rows.attack += found.attack;
    }
    assert.deepEqual(rows, BASELINE.rows, 'rows compared, measured by breaking each one');
  },
);

/** Which save each difference of a kind came from, ids only — enough to know where to look. */
function describeKinds(runs: OracleRun[]): string {
  const lines: string[] = ['difference kinds moved; by save:'];
  runs.forEach((run, i) => {
    const counts = Object.entries(countKinds([run.comparison])).filter(([, n]) => n > 0);
    lines.push(`  save ${i + 1}: ${counts.map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`);
  });
  lines.push('Set INCUDO_ORACLE_DETAIL=1 to see every message.');
  return lines.join('\n');
}
