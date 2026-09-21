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
  /** The shared caster level, which only a multiclass save records (ADR 0041). */
  casterLevel: /^multiclass:spellcasting:level$/,
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
  const rows = { slots: 0, dc: 0, attack: 0, casterLevel: 0 };
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

// --- what must hold whatever the content is doing (ADR 0042) --------------------

/**
 * Ids Aurora's own application writes into a save's `<sum>` that no content file declares, that carry
 * no rules, and that Incudo deliberately does not model: inventing a rule for one would be the guess
 * ADR 0005 rules out. Today that is one family, the marker naming the character level at which a second
 * class began (`ID_INTERNAL_MULTICLASS_LEVEL_3`, `..._5`).
 *
 * This is the whole allowlist, and it is small on purpose: an `element-missing` that is not one of these
 * is a grant that stopped firing, and a run that lets it through has stopped being able to say so.
 */
export const AURORA_APP_MARKERS: readonly RegExp[] = [/^ID_INTERNAL_MULTICLASS_LEVEL_\d+$/];

export function isAuroraAppMarker(id: string): boolean {
  return AURORA_APP_MARKERS.some((pattern) => pattern.test(id));
}

/**
 * The invariants: what a save must satisfy against *any* corpus, so a moving upstream can neither
 * excuse nor cause a failure of one. Each returned line names content and never a character.
 *
 *  1. It imports without an error.
 *  2. No `stat-mismatch` and no `spell-missing`: a number both sides computed, differently, and a spell
 *     Aurora listed that Incudo did not derive. Neither has ever been upstream churn.
 *  3. Every `element-missing` is an Aurora-app marker. Upstream *removing* an element is `content-missing`
 *     (`compareWithAurora` walks the save's own tree to find an absent ancestor) and is reported; what is
 *     left is an element that exists and was not granted.
 *  4. Nothing was silently not compared: every recorded spellcasting block has its slot row, save DC and
 *     attack bonus compared, and the shared caster level is compared exactly when the save records one.
 *     It is measured by breaking each row (`rowsCompared`), and depends on the save and the engine only.
 *
 * Everything else — how many `element-extra` a save has, how many `content-missing`, how many
 * `not-modelled` — moves with upstream and is reported, not asserted.
 */
export function oracleViolations(run: OracleRun, rows: Record<RowFamily, number>): string[] {
  const violations: string[] = [];
  for (const d of run.imported.diagnostics.filter((d) => d.level === 'error')) {
    violations.push(`import error: ${d.message}`);
  }
  for (const d of run.comparison.differences) {
    if (d.kind === 'stat-mismatch' || d.kind === 'spell-missing') {
      violations.push(`${d.kind}  ${d.elementId ?? ''}  ${d.message}`);
    }
    if (d.kind === 'element-missing' && !(d.elementId && isAuroraAppMarker(d.elementId))) {
      violations.push(`element-missing that is not an Aurora-app marker  ${d.elementId ?? ''}  ${d.message}`);
    }
  }
  const blocks = run.save.magic.length;
  for (const family of ['slots', 'dc', 'attack'] as const) {
    if (rows[family] !== blocks) {
      violations.push(`${rows[family]} ${family} row(s) compared for ${blocks} spellcasting block(s)`);
    }
  }
  const recordsCasterLevel = run.save.magicLevel !== undefined ? 1 : 0;
  if (rows.casterLevel !== recordsCasterLevel) {
    violations.push(
      `${rows.casterLevel} caster level row(s) compared, and the save ${recordsCasterLevel ? 'records' : 'does not record'} one`,
    );
  }
  return violations;
}

/**
 * The differences of a save as a sorted list of `kind:element` lines, the finest thing worth comparing
 * between two runs of the engine on the same corpus.
 */
export function differenceLines(run: OracleRun): string[] {
  return run.comparison.differences.map((d) => `${d.kind}:${d.elementId ?? ''}`).sort();
}

/** What one list has that the other lacks, as a multiset difference, so a swap reads as a swap. */
export function lineDelta(before: readonly string[], after: readonly string[]): { removed: string[]; added: string[] } {
  const count = (lines: readonly string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const line of lines) m.set(line, (m.get(line) ?? 0) + 1);
    return m;
  };
  const a = count(before);
  const b = count(after);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [line, n] of a) for (let i = 0; i < n - (b.get(line) ?? 0); i += 1) removed.push(line);
  for (const [line, n] of b) for (let i = 0; i < n - (a.get(line) ?? 0); i += 1) added.push(line);
  return { removed: removed.sort(), added: added.sort() };
}
