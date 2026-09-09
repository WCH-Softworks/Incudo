#!/usr/bin/env node --experimental-strip-types
/**
 * hf — the HeroForge CLI.
 *
 * This exists before any UI on purpose (ROADMAP Phase 0): it exercises the model, the
 * importer and the content layer with no UI assumptions anywhere, and it is what CI runs
 * against the whole AuroraLegacy corpus.
 *
 *   hf validate <index-url-or-path> [--strict] [--json]
 *   hf inspect  <index-url-or-path> <element-id>
 *   hf types    <index-url-or-path>
 */

import { referencedElementIds } from '@heroforge/core';
import { ContentLibrary, HttpContentSource } from '@heroforge/content';
import { NodeFetcher, NodeStorage } from './node-platform.ts';

const USAGE = `hf — HeroForge content tool

Usage:
  hf validate <index>   [--strict] [--json]   Load an index and report anything that does not resolve
  hf inspect  <index> <element-id>            Show one element as HeroForge sees it
  hf types    <index>                         Count elements by type

<index> is a URL or a local path, e.g.
  https://raw.githubusercontent.com/AuroraLegacy/elements/master/core.index
  ./corpus/core.index

Options:
  --strict     exit non-zero on warnings as well as errors
  --json       machine-readable output
  --cache DIR  write fetched files through to DIR (default: .heroforge-cache)
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }

  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const positional = rest.filter((a) => !a.startsWith('--'));
  const cacheDir = valueOf(rest, '--cache') ?? '.heroforge-cache';

  const indexUrl = positional[0];
  if (!indexUrl) {
    process.stderr.write('Missing <index>.\n\n' + USAGE);
    return 2;
  }

  const library = new ContentLibrary();
  const source = new HttpContentSource({
    id: indexUrl,
    fetcher: new NodeFetcher(),
    writeThrough: new NodeStorage(cacheDir),
  });

  const started = Date.now();
  const report = await library.loadSource(source, indexUrl, {
    onProgress: (loaded, total, current) => {
      if (!flags.has('--json')) {
        process.stderr.write(`\r  ${loaded}/${total}  ${truncate(current, 48)}          `);
      }
    },
  });
  if (!flags.has('--json')) process.stderr.write('\r' + ' '.repeat(70) + '\r');

  switch (command) {
    case 'validate':
      return validate(library, report, flags, Date.now() - started);
    case 'inspect':
      return inspect(library, positional[1]);
    case 'types':
      return types(library);
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
      return 2;
  }
}

function validate(
  library: ContentLibrary,
  report: { filesLoaded: number; elementsLoaded: number },
  flags: Set<string>,
  elapsedMs: number,
): number {
  const referenced = referencedElementIds(library.elements.all());
  const missing = [...referenced].filter((id) => !library.elements.get(id)).sort();

  const errors = library.diagnostics.filter((d) => d.level === 'error');
  const warnings = library.diagnostics.filter((d) => d.level === 'warning');

  if (flags.has('--json')) {
    process.stdout.write(
      JSON.stringify(
        {
          files: report.filesLoaded,
          elements: report.elementsLoaded,
          unresolvedReferences: missing,
          errors,
          warnings,
          elapsedMs,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(`Loaded ${report.elementsLoaded} elements from ${report.filesLoaded} files in ${(elapsedMs / 1000).toFixed(1)}s\n`);
    process.stdout.write(`  errors:                 ${errors.length}\n`);
    process.stdout.write(`  warnings:               ${warnings.length}\n`);
    process.stdout.write(`  unresolved references:  ${missing.length}\n`);
    for (const d of errors.slice(0, 20)) process.stdout.write(`  ERROR  ${d.message}\n`);
    if (errors.length > 20) process.stdout.write(`  ... and ${errors.length - 20} more errors\n`);
    for (const id of missing.slice(0, 20)) process.stdout.write(`  MISSING  ${id}\n`);
    if (missing.length > 20) process.stdout.write(`  ... and ${missing.length - 20} more\n`);
  }

  if (errors.length || missing.length) return 1;
  if (flags.has('--strict') && warnings.length) return 1;
  return 0;
}

function inspect(library: ContentLibrary, id: string | undefined): number {
  if (!id) {
    process.stderr.write('Missing <element-id>.\n');
    return 2;
  }
  const element = library.elements.get(id);
  if (!element) {
    process.stderr.write(`No element with id "${id}".\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify({ ...element, description: undefined }, null, 2) + '\n');
  return 0;
}

function types(library: ContentLibrary): number {
  const counts = new Map<string, number>();
  for (const element of library.elements.all()) {
    counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const width = Math.max(...rows.map(([type]) => type.length), 4);
  for (const [type, count] of rows) {
    process.stdout.write(`${type.padEnd(width)}  ${String(count).padStart(5)}\n`);
  }
  process.stdout.write(`${'TOTAL'.padEnd(width)}  ${String(library.size).padStart(5)}\n`);
  return 0;
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : '…' + text.slice(-(max - 1));
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`\n${explain(error)}\n`);
    if (process.env['HF_DEBUG']) process.stderr.write(`${(error as Error).stack}\n`);
    process.exit(1);
  },
);

/**
 * A stack trace is the wrong answer to "you are offline" or "that file isn't there".
 * Set HF_DEBUG=1 to get the trace as well.
 */
function explain(error: unknown): string {
  const err = error as NodeJS.ErrnoException;
  const message = err?.message ?? String(error);
  if (message.includes('fetch failed')) {
    return `Could not reach the network.\n  Check the URL, your connection, and any proxy.\n  A local path works offline: hf validate ./path/to/core.index`;
  }
  if (err?.code === 'ENOENT') {
    return `No such file: ${err.path ?? 'unknown'}`;
  }
  return message;
}
