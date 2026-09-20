/**
 * Aurora's own arithmetic, as a function (ADR 0039).
 *
 * `incudo aurora verify` was this sequence plus a printer. The classification — which difference
 * is a bug, which is Aurora-app behaviour Incudo has not modelled, which is a source that is not
 * enabled — was never in the command: it is `compareWithAurora` in `@incudo/aurora-import`, and
 * that package stays frozen (ADR 0008). What is here is only the orchestration the command did
 * around it, and a measurement the command never made.
 *
 * The saves are personal data. Nothing here returns or writes a character's name, notes or
 * portrait to anywhere but the value the caller asked for, and every message `compareWithAurora`
 * produces names content — elements, spells, stats — and never the character.
 */

import { readFile } from 'node:fs/promises';
import {
  compareWithAurora,
  importAuroraCharacter,
  parseAuroraSave,
  systemIdForSaveExtension,
  type AuroraComparison,
  type AuroraSave,
  type DifferenceKind,
  type ImportedCharacter,
} from '@incudo/aurora-import';
import {
  BundleElementIndex,
  LayeredElementIndex,
  deriveCharacter,
  type DerivedCharacter,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { loadShippedSystem } from './node-system.ts';

export interface OracleRun {
  save: AuroraSave;
  imported: ImportedCharacter;
  system: GameSystem;
  elements: ElementIndex;
  derived: DerivedCharacter;
  comparison: AuroraComparison;
}

/**
 * Import one `.dnd5e`, derive it, and diff it against the `<sum>` and `<magic>` blocks Aurora
 * wrote itself.
 *
 * Throws where the command printed and returned 1: a save that does not parse, or a system the
 * repository does not ship, is not a difference to classify, it is a check that could not be made.
 */
export async function runOracle(
  file: string,
  corpus: ElementIndex,
  sourceId: string,
): Promise<OracleRun> {
  const save = parseAuroraSave(await readFile(file, 'utf8'));
  const failed = save.diagnostics.filter((d) => d.level === 'error');
  if (failed.length) {
    throw new Error(`the save did not parse: ${failed.map((d) => d.message).join('; ')}`);
  }

  const imported = importAuroraCharacter(save, {
    index: corpus,
    systemId: systemIdForSaveExtension(file) ?? 'dnd5e',
    source: { id: sourceId },
  });

  // The elements Aurora made up at runtime and this save is the only record of, layered over the
  // corpus rather than added to it: they belong to this character, not to anyone's content library.
  const elements = imported.generated.length
    ? new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus])
    : corpus;

  const system = await loadShippedSystem(imported.character.systemId);

  const derived = deriveCharacter(imported.character, system, elements);
  return {
    save,
    imported,
    system,
    elements,
    derived,
    comparison: compareWithAurora(save, derived, { index: elements }),
  };
}

/** Difference counts by kind, with every kind present so a zero is written down and not implied. */
export function countKinds(comparisons: Iterable<AuroraComparison>): Record<DifferenceKind, number> {
  const counts: Record<DifferenceKind, number> = {
    'element-missing': 0,
    'element-extra': 0,
    'spell-missing': 0,
    'stat-mismatch': 0,
    'content-missing': 0,
    'not-modelled': 0,
  };
  for (const comparison of comparisons) {
    for (const difference of comparison.differences) counts[difference.kind]++;
  }
  return counts;
}

// --- rows compared ---------------------------------------------------------

/**
 * The three families of number `<magic>` records and Incudo publishes. The patterns are the
 * stat names `systems/dnd5e/system.json` declares — `<block>:spellcasting:dc` and its siblings,
 * plus the shared multiclass pool — so this file is 5e's in the way `compareWithAurora`'s
 * defaults are, and lives outside every package for the same reason.
 */
const FAMILIES = {
  slots: /spellcasting:slots:[1-9]$/,
  dc: /:spellcasting:dc$/,
  attack: /:spellcasting:attack$/,
};

export type RowFamily = keyof typeof FAMILIES;

/**
 * How many rows of each family were actually compared, by breaking each one and counting what
 * notices.
 *
 * `AuroraComparison` reports differences. A row that is compared and agrees leaves no trace, and
 * neither does a row that is skipped: a block with no ability, a stat nothing publishes, a
 * system that declares no slot table. A pin on `stat-mismatch: 0` therefore cannot tell "checked
 * and agrees" from "never checked", and the second is the failure CLAUDE.md records again and
 * again — counts that stay green while the behaviour is gone.
 *
 * So every stat of one family is shifted by one and the comparison is run again. A row that was
 * never compared cannot mismatch, so the extra `stat-mismatch` differences *are* the rows that
 * were. It goes through the public surface only; none of `verify-character.ts`'s logic is copied.
 */
export function rowsCompared(run: OracleRun): Record<RowFamily, number> {
  const before = mismatches(run.comparison);
  const rows = { slots: 0, dc: 0, attack: 0 };
  for (const family of Object.keys(FAMILIES) as RowFamily[]) {
    const shifted = shift(run.derived, FAMILIES[family]);
    const after = mismatches(compareWithAurora(run.save, shifted, { index: run.elements }));
    rows[family] = after - before;
  }
  return rows;
}

function mismatches(comparison: AuroraComparison): number {
  return comparison.differences.filter((d) => d.kind === 'stat-mismatch').length;
}

function shift(derived: DerivedCharacter, match: RegExp): DerivedCharacter {
  const stats = new Map(derived.stats);
  for (const [key, stat] of stats) {
    if (match.test(key)) stats.set(key, { ...stat, value: stat.value + 1 });
  }
  return { ...derived, stats };
}
