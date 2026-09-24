/**
 * Loading an Aurora corpus from disk, and the four questions CI asks of it.
 *
 * This is what `incudo validate` used to be, minus the command line (ADR 0039). The numbers in
 * CLAUDE.md's baselines are measured by `corpus.test.ts` through the functions here, and CI's
 * `aurora-corpus` job runs that file with the budgets it spells out in `.github/workflows/ci.yml`.
 *
 * Everything is offline, always. `LocalMirrorFetcher` falls through to its fallback when a file is
 * not in the mirror, which is right for a partial mirror and quietly wrong everywhere else: a
 * check that silently fetches proves nothing about the checkout it was pointed at. The fallback
 * here is `OfflineFetcher`, so a miss is a named error giving both the URL refused and the path
 * that was checked.
 */

import { dirname } from 'node:path';
import { referencedElementIds, type Fetcher } from '@incudo/core';
import { ContentLibrary, HttpContentSource, type SourceDiagnostic } from '@incudo/content';
import { KNOWN_UPSTREAM_TYPOS } from '@incudo/aurora-import';
import { LocalMirrorFetcher, OfflineFetcher } from './node-platform.ts';

/**
 * How an index's files are found on disk. They are different layouts (docs/AURORA-FORMAT.md) and
 * one must not be used for the other.
 *
 *  - `aurora-folder`: an existing Aurora install's `custom` folder. Aurora gives each index a
 *    folder named after it and stores files by `name` inside, so files resolve by name and never
 *    by URL.
 *  - `repository`: a git checkout. An index hard-codes absolute GitHub URLs, so each is mapped
 *    back onto the checkout by the path after the ref segment.
 */
export type CorpusLayout = 'aurora-folder' | 'repository';

export interface CorpusLocation {
  index: string;
  layout: CorpusLayout;
  /** `repository` only: where the checkout is rooted. Defaults to the index's own folder. */
  root?: string;
}

export interface LoadedCorpus {
  location: CorpusLocation;
  library: ContentLibrary;
  filesLoaded: number;
  elementsLoaded: number;
  elapsedMs: number;
}

/** How a load is made, for a test that compares two loads of the same corpus (ADR 0051). */
export interface CorpusLoadOptions {
  /** Requests in flight at once; the library's default when absent. */
  concurrency?: number;
  /** Stands between the loader and the disk, to delay or count what it asks for. */
  wrap?: (fetcher: Fetcher) => Fetcher;
}

export async function loadCorpus(location: CorpusLocation, options: CorpusLoadOptions = {}): Promise<LoadedCorpus> {
  const started = Date.now();
  const disk =
    location.layout === 'repository'
      ? new LocalMirrorFetcher(location.root ?? dirname(location.index), new OfflineFetcher())
      : new OfflineFetcher();
  const fetcher = options.wrap ? options.wrap(disk) : disk;

  const library = new ContentLibrary();
  const report = await library.loadSource(
    new HttpContentSource({
      id: location.index,
      fetcher,
      resolveByName: location.layout === 'aurora-folder',
    }),
    location.index,
    { concurrency: options.concurrency },
  );
  return {
    location,
    library,
    filesLoaded: report.filesLoaded,
    elementsLoaded: report.elementsLoaded,
    elapsedMs: Date.now() - started,
  };
}

// --- analysis --------------------------------------------------------------

/**
 * `parseRules` mints one id per candidate of an inline `<select type="List">` — a background's
 * suggested personality traits, and similar tables — as `<owner id>/list:<select name>/<item id>`.
 * They come from a real file but not from an `<element id="ID_…">` tag, and they count toward the
 * loaded total, which is why the marker is worth counting on its own: it is the number that moves
 * if the importer stops reading them.
 */
const SYNTHESIZED_ID_MARKER = '/list:';

export interface CorpusAnalysis {
  files: number;
  /** Loaded from files. Excludes what Aurora's app generates at runtime. */
  elements: number;
  /** The overlay plus the improvement options derived from what is loaded. */
  generated: number;
  /** Everything the library can answer for. */
  size: number;
  synthesizedFromText: number;
  errors: SourceDiagnostic[];
  warnings: SourceDiagnostic[];
  /**
   * Ids a `<grant>` (or a select's default) names that nothing declares. A character silently
   * loses something, and this is the budgeted figure.
   */
  unresolved: string[];
  /**
   * Ids only a *requirement* names. A membership test that reads false — `!ID_X` against an id
   * that will never exist is how the corpus says "unless the 2024 replacement is in play".
   * Reported and never budgeted; counting them with the first kind would bury it under them.
   */
  unmetRequirements: string[];
}

export function analyseCorpus(corpus: LoadedCorpus): CorpusAnalysis {
  const { library } = corpus;
  const all = [...library.elements.all()];

  const unresolved = [...referencedElementIds(all, { requirements: false })]
    .filter((id) => !library.elements.get(id))
    .sort();
  const unmetRequirements = [...referencedElementIds(all)]
    .filter((id) => !library.elements.get(id) && !unresolved.includes(id))
    .sort();

  return {
    files: corpus.filesLoaded,
    elements: corpus.elementsLoaded,
    generated: library.generatedElements,
    size: library.size,
    synthesizedFromText: all.filter((e) => e.id.includes(SYNTHESIZED_ID_MARKER)).length,
    errors: library.diagnostics.filter((d) => d.level === 'error'),
    warnings: library.diagnostics.filter((d) => d.level === 'warning'),
    unresolved,
    unmetRequirements,
  };
}

/**
 * Real content is permanently imperfect — AuroraLegacy has one reference that will never
 * resolve and 23 requirements that can never be met — so the question worth asking is "did it
 * get worse", not "is it zero".
 */
export interface CorpusBudget {
  maxUnresolved: number;
  maxWarnings: number;
  /** Guards the failure mode the two above cannot see: a corpus that did not load at all. */
  expectFiles: number;
  expectElements: number;
}

/** What is wrong, one sentence each. Empty means the corpus is within budget. */
export function checkBudget(analysis: CorpusAnalysis, budget: CorpusBudget): string[] {
  const failures: string[] = [];
  if (analysis.errors.length) {
    failures.push(`${analysis.errors.length} error(s). Content that does not parse is never a baseline.`);
  }
  if (analysis.unresolved.length > budget.maxUnresolved) {
    failures.push(
      `${analysis.unresolved.length} unresolved references, budget ${budget.maxUnresolved}. ` +
        `${analysis.unresolved.length - budget.maxUnresolved} more than expected.`,
    );
  }
  if (analysis.warnings.length > budget.maxWarnings) {
    failures.push(`${analysis.warnings.length} warnings, budget ${budget.maxWarnings}.`);
  }
  // A corpus that failed to check out loads nothing, and nothing resolves perfectly. Without
  // these two, the budgets above would wave it straight through.
  if (analysis.files < budget.expectFiles) {
    failures.push(`only ${analysis.files} files loaded, expected at least ${budget.expectFiles}.`);
  }
  if (analysis.elements < budget.expectElements) {
    failures.push(`only ${analysis.elements} elements loaded, expected at least ${budget.expectElements}.`);
  }
  return failures;
}

/**
 * The lines a person reads, one per fact.
 *
 * A reference that is a known upstream mistake reads very differently from a new one: the note is
 * the difference between "someone should look at this" and "this is one of the six we already
 * know about".
 */
export function describeCorpus(analysis: CorpusAnalysis, elapsedMs?: number): string[] {
  const seconds = elapsedMs === undefined ? '' : ` in ${(elapsedMs / 1000).toFixed(1)}s`;
  const lines = [
    `loaded ${analysis.elements} elements from ${analysis.files} files${seconds}`,
    `plus ${analysis.generated} Aurora generates at runtime (not counted above)`,
    `${analysis.synthesizedFromText} of the loaded elements are synthesized from inline text`,
    `errors ${analysis.errors.length}, warnings ${analysis.warnings.length}, ` +
      `unresolved references ${analysis.unresolved.length}, ` +
      `requirements that can never be met ${analysis.unmetRequirements.length}`,
  ];
  for (const error of analysis.errors.slice(0, 20)) lines.push(`ERROR  ${error.message}`);
  for (const id of analysis.unresolved.slice(0, 20)) lines.push(`MISSING  ${id}${noteFor(id)}`);
  for (const id of analysis.unmetRequirements.slice(0, 30)) lines.push(`UNMET-REQ  ${id}${noteFor(id)}`);
  return lines;
}

function noteFor(id: string): string {
  const known = KNOWN_UPSTREAM_TYPOS.find((t) => t.id === id);
  return known ? `\n           known upstream: ${known.note}` : '';
}

// --- configuration ---------------------------------------------------------

/**
 * The budgets as they stand today. `.github/workflows/ci.yml` states the same four numbers and
 * `corpus.test.ts` fails if the two disagree, so moving one is a deliberate edit to both.
 */
export const RECORDED_BUDGET: CorpusBudget = {
  maxUnresolved: 1,
  maxWarnings: 57,
  expectFiles: 740,
  expectElements: 14316,
};

type Environment = Record<string, string | undefined>;

const LAYOUTS: readonly string[] = ['aurora-folder', 'repository'];

/**
 * Where the corpus is, and whether anyone said so.
 *
 * The environment alone has no default location, because a default absolute path is a path on
 * somebody's machine. `location` is `undefined` until `INCUDO_AURORA_INDEX` names one; the repository's
 * own `.corpus/` checkout is the default a run falls back to, and that is `resolveCorpus`.
 *
 * `configured` is the difference between a machine that has no Aurora install (skip, as every
 * other real-corpus test does) and a CI job that was pointed at a checkout that did not happen
 * (fail). `node --test` reports a skip as green, so a check that skips on nothing passes on
 * nothing — the same argument as `expectFiles`.
 */
export function corpusFromEnvironment(env: Environment): {
  location: CorpusLocation | undefined;
  configured: boolean;
} {
  const layout = env['INCUDO_CORPUS_LAYOUT'] ?? 'aurora-folder';
  if (!LAYOUTS.includes(layout)) {
    throw new Error(`INCUDO_CORPUS_LAYOUT wants one of ${LAYOUTS.join(', ')}, got "${layout}".`);
  }
  const root = env['INCUDO_CORPUS_ROOT'];
  if (layout === 'aurora-folder' && root !== undefined) {
    throw new Error(
      'INCUDO_CORPUS_ROOT only means something for the "repository" layout. An Aurora install ' +
        'resolves files by name and has no root to give.',
    );
  }
  const index = env['INCUDO_AURORA_INDEX'];
  return {
    location:
      index === undefined
        ? undefined
        : { index, layout: layout as CorpusLayout, ...(root === undefined ? {} : { root }) },
    configured: index !== undefined,
  };
}

/**
 * Which corpus a run reads: the one the environment names, else the checkout `npm run corpus:sync`
 * made, else none (and the tests that need one skip, saying how to get it).
 *
 * `configured` is true only when the *environment* named it, because that is the case where a missing
 * index has to fail: a path somebody typed wrongly must not turn a check into a pass. A checkout that
 * is simply not there yet is the ordinary state of a fresh clone, and skips.
 */
export function resolveCorpus(
  env: Environment,
  checkout: CorpusLocation | undefined,
): { location: CorpusLocation | undefined; configured: boolean; source: 'environment' | 'checkout' | 'none' } {
  const named = corpusFromEnvironment(env);
  if (named.location) return { location: named.location, configured: true, source: 'environment' };
  if (checkout) return { location: checkout, configured: false, source: 'checkout' };
  return { location: undefined, configured: false, source: 'none' };
}

const BUDGET_VARIABLES: ReadonlyArray<readonly [keyof CorpusBudget, string]> = [
  ['maxUnresolved', 'INCUDO_MAX_UNRESOLVED'],
  ['maxWarnings', 'INCUDO_MAX_WARNINGS'],
  ['expectFiles', 'INCUDO_EXPECT_FILES'],
  ['expectElements', 'INCUDO_EXPECT_ELEMENTS'],
];

/** The variable names CI sets. Exported so the guard against `ci.yml` drifting reads the same list. */
export const BUDGET_VARIABLE_NAMES: readonly string[] = BUDGET_VARIABLES.map(([, name]) => name);

export function budgetFromEnvironment(
  env: Environment,
  fallback: CorpusBudget = RECORDED_BUDGET,
): CorpusBudget {
  const budget = { ...fallback };
  for (const [field, name] of BUDGET_VARIABLES) {
    const raw = env[name];
    if (raw === undefined) continue;
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${name} wants a non-negative number, got "${raw}".`);
    }
    budget[field] = value;
  }
  return budget;
}
