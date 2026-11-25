/**
 * Where the real Aurora data is, and nothing else about a machine.
 *
 * **The corpus is the current official repository.** Run `npm run corpus:sync` and every real-content
 * test reads `.corpus/`, a checkout of AuroraLegacy/elements at the repository root, with no
 * environment at all. CI checks the same repository out into the same place and runs the same tests
 * (ADR 0042). A green run therefore means "works with today's official content", and nothing depends on
 * anyone's Aurora install, which updates itself while it is open and is read by nobody else.
 *
 * **The saves are a folder in the repository**, `tools/verify/fixtures/saves/`: the generic samples of
 * docs/SAMPLE-SAVES.md. A checkout without them skips the tests that need one and says so, unless
 * `INCUDO_REQUIRE_SAVES=1` (CI sets it), which makes an empty folder a failure.
 *
 * `INCUDO_AURORA_INDEX` still points a run somewhere else (and `INCUDO_CORPUS_LAYOUT`,
 * `INCUDO_CORPUS_ROOT` say how to read it). The saves have no such variable any more: they are the
 * committed samples, and a test that wanted a person's own saves would be a test that runs on one machine.
 * The rule for the corpus is the one `corpus.test.ts` already held: **nothing named means the default, or
 * a skip; something named and wrong means fail.** A path that was typed wrongly must not turn a check into
 * a silent pass, and `node --test` reports a skip as green.
 * Never put a real value in a committed file: a path names a person's machine and history is permanent.
 * They go in an untracked `.env.local` (see `.env.example`).
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

import type { ElementIndex } from '@incudo/core';

import { BASE_CORPUS_COMMIT, baseCheckoutLocation, checkoutLocation, commitOf, type CheckoutCommit } from './corpus-checkout.ts';
import { loadCorpus, resolveCorpus, type CorpusLocation } from './corpus.ts';
import { repoRoot } from './node-system.ts';

const { location, configured, source } = resolveCorpus(process.env, checkoutLocation());

/**
 * CI sets this. Without it an empty saves folder skips its tests, and a checkout that lost the folder (an
 * ignore rule, a bad merge) would go green on nothing. With it, an empty folder is a failure that says so.
 */
const savesRequired = process.env['INCUDO_REQUIRE_SAVES'] === '1';

/** The committed folder the sample saves live in. */
export const DEFAULT_SAVES_DIR: string = join(repoRoot(), 'tools', 'verify', 'fixtures', 'saves');

const savesFolder = DEFAULT_SAVES_DIR;
const savesPresent =
  existsSync(savesFolder) && readdirSync(savesFolder).some((name) => extname(name).toLowerCase() === '.dnd5e');

/** The index a run reads, or `''` when there is none (and then every test that reads it is skipped). */
export const AURORA_INDEX: string = location?.index ?? '';

/** The saves folder, or `''` when it holds no save (and then every test that reads it is skipped). */
export const SAVES_DIR: string = savesPresent || savesRequired ? savesFolder : '';

/** Why a test that needs the corpus is not running, or `false` when it should. */
export const corpusSkip: string | false = location
  ? false
  : 'no real corpus: run `npm run corpus:sync` to fetch the official AuroraLegacy/elements into .corpus/ ' +
    '(tools/verify/README.md)';

/** Why a test that needs the corpus *and* the saves is not running, or `false` when it should. */
export const savesSkip: string | false =
  corpusSkip ||
  (savesPresent || savesRequired
    ? false
    : 'no .dnd5e saves in tools/verify/fixtures/saves/ (docs/SAMPLE-SAVES.md)');

/** The corpus location. Fails, rather than skipping, when it was named and is not there. */
export function requireCorpus(): CorpusLocation {
  assert.ok(location, corpusSkip || 'no corpus is configured');
  assert.ok(
    existsSync(location.index),
    `the corpus index is named by ${source === 'environment' ? 'INCUDO_AURORA_INDEX' : 'the checkout'} ` +
      'but does not exist. Failing rather than skipping: a check that skips on a mistyped path passes on nothing.',
  );
  return location;
}

/** The saves folder, with the same rule. */
export function requireSaves(): string {
  requireCorpus();
  assert.ok(savesFolder && SAVES_DIR, savesSkip || 'no saves folder is configured');
  assert.ok(
    existsSync(savesFolder),
    'the saves folder does not exist. Failing rather than skipping: a check that skips on a missing folder passes on nothing.',
  );
  assert.ok(
    savesPresent,
    'INCUDO_REQUIRE_SAVES=1 and the saves folder holds no .dnd5e. Failing rather than skipping.',
  );
  return savesFolder;
}

/**
 * How much of the real-content suite a run does: `full` (the default, and what `main`, the nightly schedule and a
 * release run) or `quick` (what a pull request runs). Quick is the same tests, abridged two ways, and nothing it does
 * run is weaker than in full:
 *
 * - **A sweep over the samples reads a few of them**, chosen by what they are (`QUICK_SAMPLES` in `sample-saves.ts`),
 *   not all thirty. The checks that are the point of the samples still read every one: `aurora-oracle.test.ts` (the
 *   invariants against Aurora) and `sample-saves.test.ts` (anonymity, the manifest).
 * - **A measurement is skipped** (`measureSkip`): a test that reports numbers as `ℹ` lines and asserts nothing beyond
 *   "something was read" (ADR 0042), or a perturbation proving another check bites. It is evidence for a decision, not
 *   a guard on one, and the full suite still runs it after every merge.
 *
 * Any other value fails, as a mistyped corpus path does: a run that meant `full` must not quietly do less.
 */
export type CorpusSuite = 'quick' | 'full';

export function corpusSuiteOf(env: Record<string, string | undefined>): CorpusSuite {
  const value = env['INCUDO_CORPUS_SUITE'];
  if (value === undefined || value === '' || value === 'full') return 'full';
  if (value === 'quick') return 'quick';
  throw new Error(`INCUDO_CORPUS_SUITE is "${value}"; it is "quick" or "full" (the default).`);
}

export const corpusSuite: CorpusSuite = corpusSuiteOf(process.env);

/**
 * Why a measurement is not running, or `false` when it should. It goes last in a skip, after what the test needs
 * (`{ skip: corpusSkip || savesSkip || measureSkip }`), so a run with no corpus still says to sync one.
 */
export const measureSkip: string | false =
  corpusSuite === 'quick'
    ? 'a measurement: the full corpus suite runs it (main, nightly, release), a pull request does not'
    : false;

/**
 * Why a check that loads or converts the whole corpus twice, to hold two ways of doing it to the same result (cached
 * and fresh, walked and prefetched, one source and split), is not running, or `false` when it should. Only the
 * converter, the loader and the formats can make two such loads differ, and CI runs the full suite on any pull request
 * that touches them (ci.yml), so a quick run skips these.
 */
export const loaderSkip: string | false =
  corpusSuite === 'quick'
    ? 'a whole-corpus loader check: the full suite runs it, and so does a pull request that touches the converter, the loader or a format'
    : false;

/** How many items a quick run's `sweep` keeps. */
export const QUICK_SWEEP = 12;

/**
 * What a sweep over many like things (every creature, every element of a type) reads: all of them in a full run, and
 * in a quick one `QUICK_SWEEP` of them spread evenly through the list as given, its first and last included, so the
 * same ones every time. A test that sweeps must not assert how many it read.
 */
export function sweep<T>(items: readonly T[]): T[] {
  if (corpusSuite === 'full' || items.length <= QUICK_SWEEP) return [...items];
  const step = (items.length - 1) / (QUICK_SWEEP - 1);
  return Array.from({ length: QUICK_SWEEP }, (_, i) => items[Math.round(i * step)]!);
}

/** Whether the corpus came from the environment (an explicit choice) or from the repository's own checkout. */
export const corpusSource: 'environment' | 'checkout' | 'none' = source;

/** Whether the corpus was named on purpose. A named corpus that is missing fails, an absent default skips. */
export const corpusConfigured: boolean = configured;

/**
 * The commit of the corpus a run read, when it is a git checkout, so that a run that behaves differently
 * from yesterday's can be traced to what upstream changed. `undefined` for anything that is not one.
 */
export function corpusCommit(): CheckoutCommit | undefined {
  if (!location || location.layout !== 'repository') return undefined;
  return commitOf(location.root ?? dirname(location.index));
}

/** One line naming the corpus, safe to print: a commit, never a path. */
export function corpusProvenance(): string {
  if (!location) return 'corpus: none';
  const commit = corpusCommit();
  const which = `corpus: ${source === 'checkout' ? 'AuroraLegacy/elements checkout' : `named by the environment (${location.layout} layout)`}`;
  return commit ? `${which} at ${commit.sha.slice(0, 12)} (${commit.date})` : `${which}, commit unknown`;
}

type SizedIndex = ElementIndex & { size: number };
let loaded: Promise<SizedIndex> | undefined;

/** Every element of the configured corpus, loaded once per test file. */
export function realElements(): Promise<SizedIndex> {
  loaded ??= loadCorpus(requireCorpus()).then((corpus) => corpus.library.elements as SizedIndex);
  return loaded;
}

/**
 * An older checkout of the official corpus to measure a content refresh against (ADR 0082): the samples are imported
 * against it, as if saved then, and compared with today's. It is `.corpus-base/`, the same repository at a pinned commit
 * (`BASE_CORPUS_COMMIT`), fetched by `npm run corpus:sync` and checked out by CI, so it names the same content on every
 * machine. Absent, the measurement skips and says to sync; with `INCUDO_REQUIRE_BASE_CORPUS=1` (CI sets it) absent fails.
 */
const base = baseCheckoutLocation();
const baseRequired = process.env['INCUDO_REQUIRE_BASE_CORPUS'] === '1';

/** Why the refresh measurement is not running, or `false` when it should. */
export const baseCorpusSkip: string | false =
  base || baseRequired ? false : 'no older corpus: run `npm run corpus:sync` to fetch the pinned older commit into .corpus-base/';

/** The older corpus, failing rather than skipping when it is required and is not there, or is not the pinned commit. */
export function requireBaseCorpus(): CorpusLocation {
  assert.ok(base, 'INCUDO_REQUIRE_BASE_CORPUS=1 and .corpus-base/ holds no AuroraLegacy.index. Failing rather than skipping.');
  assert.equal(
    commitOf(base.root ?? dirname(base.index))?.sha,
    BASE_CORPUS_COMMIT,
    '.corpus-base/ is not at the pinned commit: run `npm run corpus:sync` again.',
  );
  return base;
}
