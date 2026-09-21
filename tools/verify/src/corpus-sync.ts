/**
 * Fetch, or fast-forward, the official content repository into `.corpus/`.
 *
 *   npm run corpus:sync
 *
 * The real-content tests read the current AuroraLegacy/elements from there (ADR 0042), so a green run
 * means "works with today's official content". It is a shallow clone: the tests read files, never
 * history, and the whole history is far larger than the content.
 *
 * This is a script, not a command line: no flags, no subcommands (ADR 0039). It prints the commit the
 * checkout ends at, which is the number to quote when a run behaves differently from yesterday's.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CORPUS_REPOSITORY_URL, checkoutRoot, commitOf } from './corpus-checkout.ts';

const root = checkoutRoot();

function git(args: string[], options: { in?: string } = {}): string {
  const prefix = options.in ? ['-C', options.in] : [];
  return execFileSync('git', [...prefix, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

if (!existsSync(join(root, '.git'))) {
  if (existsSync(root)) {
    throw new Error('.corpus exists and is not a git checkout. Delete it and run this again.');
  }
  process.stdout.write(`cloning ${CORPUS_REPOSITORY_URL} into .corpus (shallow)\n`);
  // No line-ending conversion: the corpus is read as upstream wrote it, on every platform.
  git(['clone', '-c', 'core.autocrlf=false', '--depth', '1', CORPUS_REPOSITORY_URL, root]);
} else {
  if (git(['status', '--porcelain'], { in: root }).trim() !== '') {
    throw new Error('.corpus has local changes. It is a cache of the official repository: delete it and run this again.');
  }
  let conversion = '';
  try {
    conversion = git(['config', '--get', 'core.autocrlf'], { in: root }).trim();
  } catch {
    // Unset: `git config --get` exits 1, and on Windows that means conversion is on by default.
  }
  if (conversion !== 'false') {
    process.stdout.write(
      'warning: this checkout converts line endings (core.autocrlf is not false). Delete .corpus and sync again for a byte-exact copy.\n',
    );
  }
  process.stdout.write('fetching the current commit\n');
  git(['fetch', '--depth', '1', 'origin', 'HEAD'], { in: root });
  git(['reset', '--hard', 'FETCH_HEAD'], { in: root });
}

if (!existsSync(join(root, 'AuroraLegacy.index'))) {
  throw new Error('the checkout has no AuroraLegacy.index; the repository is not laid out as expected.');
}
const commit = commitOf(root);
process.stdout.write(`.corpus is at ${commit ? `${commit.sha} (${commit.date})` : 'an unknown commit'}\n`);
