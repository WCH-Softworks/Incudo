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
  preparationPool,
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
 *  5. No recorded id is one the content spells in another case (`caseMismatches`): the importer respells them.
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
  violations.push(...caseMismatches(run));
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
 * Ids the character records that the content does not have as written but does have in another case.
 * Aurora matches ids ignoring case and the engine does not, so the importer respells them; one left over
 * is a whole subclass, race or item that resolves to nothing, and no count moves when it happens.
 */
export function caseMismatches(run: OracleRun): string[] {
  const recorded = new Set<string>([
    ...run.imported.character.choices.flatMap((c) => c.elementIds),
    ...(run.imported.character.inventory ?? []).map((e) => e.elementId),
  ]);
  const missing = [...recorded].filter((id) => !run.elements.get(id));
  if (!missing.length) return [];
  const spellings = new Map<string, Set<string>>();
  for (const element of run.elements.all()) {
    const key = element.id.toLowerCase();
    const set = spellings.get(key) ?? new Set<string>();
    set.add(element.id);
    spellings.set(key, set);
  }
  return missing.flatMap((id) => {
    const same = spellings.get(id.toLowerCase());
    return same && same.size === 1
      ? [`recorded "${id}", which the content spells "${[...same][0]}"`]
      : [];
  });
}

/**
 * Prepared lists held to what Aurora wrote and showed — ADR 0046.
 *
 * `compareWithAurora` is frozen and never read a `prepared` flag, so this lives with the verifier's own
 * comparisons. For every block a save flags a spell prepared in:
 *
 *  1. Incudo has a prepared list for the block.
 *  2. The spells Incudo puts on it (always prepared, and what counts) are the flagged ones, exactly.
 *  3. Nothing recorded is one the block cannot prepare.
 *  4. The block prepares the way Aurora's own listing says it does: a block whose `<spells>` holds only spells
 *     the character knows is a book, and any other lists the class. That is the second witness for the one
 *     assumption the system definition makes about content (`heldSelect`, ADR 0046 decision 4).
 *  5. Everything Aurora lists for the block is something Incudo holds or offers. For a block that prepares
 *     from a book, what Incudo offers and holds is what Aurora lists, exactly; for one that prepares from
 *     a list Incudo may offer more, because Aurora had sources and editions switched off that Incudo has no
 *     way to know about, and it must never offer less.
 *
 * And across the save, when the maintainer's readout is given: the limits Incudo derives are the ones
 * Aurora's screen showed. The readout is per class in class order and a class that does not prepare reads
 * 0, so it is compared as a multiset of the non-zero numbers, which loses nothing that could be told apart.
 *
 * **Not asserted, and reported:** how many of the flagged spells Aurora marks *always* prepared. Aurora
 * marks one the character holds by another route (a Ranger's pick, a feat's) always prepared in any block
 * whose list has it, and content marks only what a grant says; the flagged set agrees regardless, and
 * neither reading puts either sample over its limit.
 *
 * Takes the pieces and not a run, so a perturbation can hand it a derivation it changed.
 */
export function preparationViolations(
  run: Pick<OracleRun, 'save' | 'derived' | 'elements'>,
  readout?: readonly number[],
): string[] {
  const violations: string[] = [];
  const mine = new Map(run.derived.preparation.map((block) => [block.key, block]));

  for (const block of run.save.magic) {
    const key = block.name.trim().toLowerCase();
    const flagged = new Set(block.spells.filter((spell) => spell.prepared).map((spell) => spell.id));
    if (flagged.size === 0) continue;
    const where = `"${block.name}"`;
    const ours = mine.get(key);
    if (!ours) {
      violations.push(`${where}: Aurora flags ${flagged.size} spell(s) prepared and Incudo has no prepared list for it`);
      continue;
    }

    const counted = new Set([...ours.always, ...ours.chosen]);
    for (const id of flagged) {
      if (!counted.has(id)) violations.push(`${where}: Aurora has ${id} prepared and Incudo does not`);
    }
    for (const id of counted) {
      if (!flagged.has(id)) violations.push(`${where}: Incudo has ${id} prepared and Aurora does not`);
    }
    for (const id of ours.unavailable) {
      violations.push(`${where}: ${id} is recorded prepared and Incudo says the block cannot prepare it`);
    }

    const book = block.spells.length > 0 && block.spells.every((spell) => spell.known);
    if ((ours.mode === 'held') !== book) {
      violations.push(
        `${where}: Aurora's listing is ${book ? 'a book of what the character knows' : 'the class list'} and Incudo prepares from ${ours.mode === 'held' ? 'a book' : 'the list'}`,
      );
    }

    const listed = new Set(block.spells.map((spell) => spell.id));
    const offered = new Set([
      ...preparationPool(run.derived, run.elements, key).map((element) => element.id),
      ...counted,
    ]);
    for (const id of listed) {
      if (!offered.has(id)) violations.push(`${where}: Aurora lists ${id} and Incudo neither holds nor offers it`);
    }
    if (ours.mode === 'held') {
      for (const id of offered) {
        if (!listed.has(id)) violations.push(`${where}: Incudo offers ${id} from a book Aurora's does not list it in`);
      }
    }
  }

  if (readout) {
    const numbers = (values: readonly number[]): string =>
      values.filter((n) => n > 0).sort((a, b) => a - b).join('/');
    const want = numbers(readout);
    const got = numbers(run.derived.preparation.map((block) => block.limit));
    if (want !== got) {
      violations.push(`the preparable count reads ${want || 'nothing'} on Aurora's screen and ${got || 'nothing'} here`);
    }
  }
  return violations;
}

/**
 * One line per preparing block for the report: how it prepares, the limit, what is always on it, what counts,
 * how far over that is, and how many spells Aurora marks always prepared that content does not (the
 * difference `preparationViolations` leaves unasserted).
 */
export function preparationReport(run: Pick<OracleRun, 'save' | 'derived'>): string[] {
  return run.derived.preparation.map((block) => {
    const saved = run.save.magic.find((m) => m.name.trim().toLowerCase() === block.key);
    const alwaysThere = new Set(
      (saved?.spells ?? []).filter((s) => s.alwaysPrepared && s.prepared).map((s) => s.id),
    );
    // On a book every entry carries the flag, so it says nothing about being always prepared there.
    const beyondContent =
      block.mode === 'list' ? [...alwaysThere].filter((id) => !block.always.includes(id)).length : 0;
    return (
      `${block.name}: ${block.mode}, limit ${block.limit}, always ${block.always.length}, ` +
      `prepared ${block.chosen.length}${block.over ? ` (${block.over} over)` : ''}` +
      (beyondContent ? `, Aurora marks ${beyondContent} more always prepared than content does` : '')
    );
  });
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
