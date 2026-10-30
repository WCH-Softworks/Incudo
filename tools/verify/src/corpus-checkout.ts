/**
 * Where the official content repository is checked out, and which commit that is.
 *
 * The real-content tests run against the *current* AuroraLegacy/elements, fetched by
 * `npm run corpus:sync` into `.corpus/` at the repository root (gitignored), and CI checks the same
 * repository out into the same folder. A path relative to the repository is machine agnostic, so a run
 * needs no environment at all; nothing here names a person's machine. An Aurora install is not a
 * source: a private, self-updating copy of the content is what this replaces (ADR 0042).
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { CorpusLocation } from './corpus.ts';
import { repoRoot } from './node-system.ts';

/** The one repository the tests read. There is no second one to point at. */
export const CORPUS_REPOSITORY = 'AuroraLegacy/elements';
export const CORPUS_REPOSITORY_URL = `https://github.com/${CORPUS_REPOSITORY}.git`;

/** `<repo>/.corpus`, where both `npm run corpus:sync` and CI put the checkout. */
export function checkoutRoot(): string {
  return join(repoRoot(), '.corpus');
}

/** The checkout as a corpus location, or `undefined` when nobody has synced (and the tests then skip). */
export function checkoutLocation(): CorpusLocation | undefined {
  const root = checkoutRoot();
  const index = join(root, 'AuroraLegacy.index');
  return existsSync(index) ? { index, layout: 'repository', root } : undefined;
}

/**
 * An older commit of the same repository, for the one measurement that needs content as it was: a character saved then and
 * opened against today's (ADR 0082, `content-refresh.test.ts`). Pinned, unlike `.corpus/`: "older" has to name the same
 * content on every machine, and a commit of a public repository does. April 2026, the older of the two ADR 0082 measured.
 */
export const BASE_CORPUS_COMMIT = '87e8dfa11c3808169db9d60177a09977585ebe03';

/** `<repo>/.corpus-base`, where `npm run corpus:sync` and CI put that older checkout. */
export function baseCheckoutRoot(): string {
  return join(repoRoot(), '.corpus-base');
}

/** The older checkout as a corpus location, or `undefined` when nobody has synced. */
export function baseCheckoutLocation(): CorpusLocation | undefined {
  const root = baseCheckoutRoot();
  const index = join(root, 'AuroraLegacy.index');
  return existsSync(index) ? { index, layout: 'repository', root } : undefined;
}

export interface CheckoutCommit {
  sha: string;
  /** Committer date, ISO 8601. */
  date: string;
}

/** The commit a checkout is at, or `undefined` when it is not a git checkout (or git is not there). */
export function commitOf(root: string): CheckoutCommit | undefined {
  try {
    const out = execFileSync('git', ['-C', root, 'log', '-1', '--format=%H %cI'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const [sha, date] = out.split(' ');
    return sha && /^[0-9a-f]{40}$/.test(sha) ? { sha, date: date ?? '' } : undefined;
  } catch {
    return undefined;
  }
}
