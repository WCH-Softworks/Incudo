/**
 * Where the real Aurora data is, and nothing else about a machine.
 *
 * **The corpus is the current official repository.** Run `npm run corpus:sync` and every real-content
 * test reads `.corpus/`, a checkout of AuroraLegacy/elements at the repository root, with no
 * environment at all. CI checks the same repository out into the same place and runs the same tests
 * (ADR 0042). A green run therefore means "works with today's official content", and nothing depends on
 * anyone's Aurora install, which updates itself while it is open and is read by nobody else.
 *
 * **The saves are a folder in the repository**, `tools/verify/fixtures/saves/`. Until the sample saves
 * of docs/SAMPLE-SAVES.md are in it, a test that needs a save skips, and says so.
 *
 * `INCUDO_AURORA_INDEX` still points a run somewhere else (and `INCUDO_CORPUS_LAYOUT`,
 * `INCUDO_CORPUS_ROOT` say how to read it), and `INCUDO_AURORA_SAVES` still points at another folder of
 * saves until the samples replace it. The rule for both is the one `corpus.test.ts` already held:
 * **nothing named means the default, or a skip; something named and wrong means fail.** A path that was
 * typed wrongly must not turn a check into a silent pass, and `node --test` reports a skip as green.
 * Never put a real value in a committed file: a path names a person's machine and history is permanent.
 * They go in an untracked `.env.local` (see `.env.example`).
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

import type { ElementIndex } from '@incudo/core';

import { checkoutLocation, commitOf, type CheckoutCommit } from './corpus-checkout.ts';
import { loadCorpus, resolveCorpus, type CorpusLocation } from './corpus.ts';
import { repoRoot } from './node-system.ts';

const { location, configured, source } = resolveCorpus(process.env, checkoutLocation());
const namedSaves = process.env['INCUDO_AURORA_SAVES'];

/**
 * CI sets this once the sample saves are committed. Without it an empty saves folder skips its tests, and a
 * checkout that lost the folder (an ignore rule, a bad merge) would go green on nothing. With it, an empty
 * folder is a failure that says so.
 */
const savesRequired = process.env['INCUDO_REQUIRE_SAVES'] === '1';

/** The committed folder the sample saves live in. */
export const DEFAULT_SAVES_DIR: string = join(repoRoot(), 'tools', 'verify', 'fixtures', 'saves');

const savesFolder = namedSaves ?? DEFAULT_SAVES_DIR;
const savesPresent =
  existsSync(savesFolder) && readdirSync(savesFolder).some((name) => extname(name).toLowerCase() === '.dnd5e');

/** The index a run reads, or `''` when there is none (and then every test that reads it is skipped). */
export const AURORA_INDEX: string = location?.index ?? '';

/** The saves folder, or `''` when it holds no save (and then every test that reads it is skipped). */
export const SAVES_DIR: string = savesPresent || namedSaves !== undefined || savesRequired ? savesFolder : '';

/** Why a test that needs the corpus is not running, or `false` when it should. */
export const corpusSkip: string | false = location
  ? false
  : 'no real corpus: run `npm run corpus:sync` to fetch the official AuroraLegacy/elements into .corpus/ ' +
    '(tools/verify/README.md)';

/** Why a test that needs the corpus *and* the saves is not running, or `false` when it should. */
export const savesSkip: string | false =
  corpusSkip ||
  (savesPresent || namedSaves !== undefined || savesRequired
    ? false
    : 'no .dnd5e saves in tools/verify/fixtures/saves/ yet (docs/SAMPLE-SAVES.md)');

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
