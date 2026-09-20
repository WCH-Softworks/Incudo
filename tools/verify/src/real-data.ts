/**
 * Where the real Aurora data is, according to the environment and nothing else.
 *
 * **No test names a machine.** These tests used to carry the maintainer's own path to an Aurora
 * install as a fallback, so they ran on one computer and skipped on every other, and a test that
 * skips is green whatever it would have found. Where the data lives is now configuration, set the
 * way CI sets it (`INCUDO_AURORA_INDEX`, and `INCUDO_AURORA_SAVES` for saves), or written once into
 * an untracked `.env.local` that `npm test` reads (see `.env.example`).
 *
 * The rule is the one `corpus.test.ts` already held: **not set means skip; set and wrong means
 * fail.** A path that was typed wrongly must not turn a check into a silent pass.
 *
 * The saves are personal data and cannot be committed, so a test that needs them cannot run in CI.
 * That is what makes it a local check rather than a regression test, and why each file that needs
 * them says so in its header.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ElementIndex } from '@incudo/core';

import { corpusFromEnvironment, loadCorpus, type CorpusLocation } from './corpus.ts';

const { location, configured } = corpusFromEnvironment(process.env);
const namedSaves = process.env['INCUDO_AURORA_SAVES'];

/**
 * The folder of `.dnd5e` files: the one named, or, for an Aurora install (where they sit beside
 * `custom/`), the folder above the index's own. A checkout of the content repository has none.
 */
const savesFolder =
  namedSaves ?? (location?.layout === 'aurora-folder' ? dirname(dirname(location.index)) : undefined);

/** The index the environment names, or `''` when it names none (and then every test that reads it is skipped). */
export const AURORA_INDEX: string = location?.index ?? '';

/** The saves folder, or `''` when there is none (and then every test that reads it is skipped). */
export const SAVES_DIR: string = savesFolder ?? '';

/** Why a test that needs the corpus is not running, or `false` when it should. */
export const corpusSkip: string | false = configured
  ? false
  : 'INCUDO_AURORA_INDEX is not set, so there is no real corpus to read (tools/verify/README.md)';

/** Why a test that needs the corpus *and* the saves is not running, or `false` when it should. */
export const savesSkip: string | false =
  corpusSkip ||
  (savesFolder === undefined
    ? 'no saves folder: set INCUDO_AURORA_SAVES (tools/verify/README.md)'
    : false);

/** The corpus location. Fails, rather than skipping, when it was configured and is not there. */
export function requireCorpus(): CorpusLocation {
  assert.ok(location, corpusSkip || 'INCUDO_AURORA_INDEX is not set');
  assert.ok(
    existsSync(location.index),
    `INCUDO_AURORA_INDEX is set to ${location.index}, which does not exist. Failing rather than ` +
      'skipping: a check that skips on a mistyped path passes on nothing.',
  );
  return location;
}

/** The saves folder, with the same rule. */
export function requireSaves(): string {
  requireCorpus();
  assert.ok(savesFolder, savesSkip || 'no saves folder is configured');
  assert.ok(
    existsSync(savesFolder),
    `the saves folder is ${savesFolder}, which does not exist. Failing rather than skipping.`,
  );
  return savesFolder;
}

type SizedIndex = ElementIndex & { size: number };
let loaded: Promise<SizedIndex> | undefined;

/** Every element of the configured corpus, loaded once per test file. */
export function realElements(): Promise<SizedIndex> {
  loaded ??= loadCorpus(requireCorpus()).then((corpus) => corpus.library.elements as SizedIndex);
  return loaded;
}
