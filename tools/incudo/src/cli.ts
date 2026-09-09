#!/usr/bin/env node --experimental-strip-types
/**
 * incudo — the Incudo CLI.
 *
 * This exists before any UI on purpose (ROADMAP Phase 0): it exercises the model, the
 * importer and the content layer with no UI assumptions anywhere, and it is what CI runs
 * against the whole AuroraLegacy corpus.
 *
 *   incudo validate  <index-url-or-path> [--strict] [--json]
 *   incudo inspect   <index-url-or-path> <element-id>
 *   incudo types     <index-url-or-path>
 *   incudo system    validate <system.json>
 *   incudo character new|choose|set|show|pack|unpack|verify …
 */

import { basename, dirname, join } from 'node:path';
import { statSync } from 'node:fs';
import { referencedElementIds, type ElementIndex } from '@incudo/core';
import { ContentLibrary, HttpContentSource } from '@incudo/content';
import { LocalMirrorFetcher, NodeFetcher, NodeStorage } from './node-platform.ts';
import { characterCommand, CHARACTER_USAGE, type CommandContext } from './character-commands.ts';
import { loadSystem } from './node-system.ts';

const USAGE = `incudo — Incudo content tool

Usage:
  incudo validate <index>   [--strict] [--json]   Load an index and report anything that does not resolve
  incudo inspect  <index> <element-id>            Show one element as Incudo sees it
  incudo types    <index>                         Count elements by type
  incudo system   validate <system.json>          Check a system definition against the schema
  incudo character <command> …                    Build and inspect characters (see below)

<index> is a URL or a local path, e.g.
  https://raw.githubusercontent.com/AuroraLegacy/elements/master/core.index
  ./corpus/core.index

Options:
  --strict     exit non-zero on warnings as well as errors
  --json       machine-readable output
  --local      resolve remote URLs against a local mirror instead of the network.
               Aurora indexes hard-code absolute GitHub URLs, so this is what lets you
               validate a local checkout offline. Root defaults to the index's folder.
  --root DIR   the local mirror's root (implies --local)
  --aurora-folder
               read an existing Aurora install's "custom" folder. Aurora gives each index
               a folder named after it and stores files by name inside, so this resolves
               by name rather than by URL. Fully offline; no --root needed.
  --cache DIR  write fetched files through to DIR (default: .incudo-cache)

${CHARACTER_USAGE}`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }

  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const positional = rest.filter((a, i) => !a.startsWith('--') && !takesValue(rest, i));
  const ctx = makeContext(rest, positional, flags);

  // Commands that own a character or a system file, and never need a content index unless
  // they say so. Handled before the index is loaded, because loading one is the slow part.
  if (command === 'character') return characterCommand(ctx);
  if (command === 'system') return systemCommand(ctx);

  const indexUrl = positional[0];
  if (!indexUrl) {
    process.stderr.write('Missing <index>.\n\n' + USAGE);
    return 2;
  }

  const started = Date.now();
  const library = new ContentLibrary();
  const report = await loadLibrary(library, indexUrl, rest, flags);

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

/**
 * The flags that take a following value, so `--system foo.json build` does not read
 * "foo.json" as a positional argument. Kept as a list rather than a parser: the CLI has
 * eight flags, and a dependency to parse eight flags would be a poor trade.
 */
const VALUE_FLAGS = new Set(['--cache', '--root', '--system', '--index', '--kind', '--name', '--progress', '--roll']);

function takesValue(args: string[], position: number): boolean {
  const previous = args[position - 1];
  return previous !== undefined && VALUE_FLAGS.has(previous);
}

function makeContext(args: string[], positional: string[], flags: Set<string>): CommandContext {
  return {
    positional,
    flags,
    value: (flag) => valueOf(args, flag),
    values: (flag) => valuesOf(args, flag),
    loadIndex: async (indexUrl) => {
      const library = new ContentLibrary();
      await loadLibrary(library, indexUrl, args, flags);
      return library.elements as ElementIndex;
    },
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  };
}

async function loadLibrary(
  library: ContentLibrary,
  indexUrl: string,
  args: string[],
  flags: Set<string>,
): Promise<{ filesLoaded: number; elementsLoaded: number }> {
  const cacheDir = valueOf(args, '--cache') ?? '.incudo-cache';
  const mirrorRoot = valueOf(args, '--root');
  const useLocal = flags.has('--local') || mirrorRoot !== undefined;
  const baseFetcher = new NodeFetcher();
  const fetcher = useLocal
    ? new LocalMirrorFetcher(mirrorRoot ?? inferMirrorRoot(indexUrl), baseFetcher)
    : baseFetcher;

  const source = new HttpContentSource({
    id: indexUrl,
    fetcher,
    writeThrough: new NodeStorage(cacheDir),
    resolveByName: flags.has('--aurora-folder'),
  });

  const quiet = flags.has('--json') || flags.has('--quiet');
  const report = await library.loadSource(source, indexUrl, {
    onProgress: (loaded, total, current) => {
      if (!quiet) process.stderr.write(`\r  ${loaded}/${total}  ${truncate(current, 48)}          `);
    },
  });
  if (!quiet) process.stderr.write('\r' + ' '.repeat(70) + '\r');
  return report;
}

/**
 * `incudo system validate` — the CLI half of ADR 0011's contract.
 *
 * There is no separate validator here: this calls the same `validateGameSystem` the app
 * calls on load. That is the whole point — a system that passes here and then fails to load
 * would make "if it parses, the app can build in it" a lie.
 */
async function systemCommand(ctx: CommandContext): Promise<number> {
  const [sub, path] = ctx.positional;
  if (sub !== 'validate' || !path) {
    ctx.err('Usage: incudo system validate <system.json>\n');
    return 2;
  }

  const system = await loadSystem(path, ctx.err);
  if (!system) return 1;

  ctx.out(`${system.name} (${system.id} ${system.version}) is valid.\n`);
  ctx.out(`  element types:   ${system.elementTypes.length}\n`);
  ctx.out(`  stats:           ${system.stats.length}\n`);
  ctx.out(`  character kinds: ${system.characterKinds.map((k) => k.id).join(', ')}\n`);
  if (!system.licence) {
    ctx.out('\n  No licence block. Fine for a personal system; required to ship one\n');
    ctx.out('  officially (ADR 0010).\n');
  }
  return 0;
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

/**
 * Where a local mirror is rooted, given the index the user pointed at.
 *
 * Aurora stores a downloaded index as `custom/Foo.index` with everything it pulls in
 * under `custom/Foo/`, mirroring the upstream repository's folder structure. So for
 * `<dir>/Foo.index` the mirror root is `<dir>/Foo` when that folder exists; otherwise
 * the index's own directory, which is the layout of a plain git checkout.
 */
function inferMirrorRoot(indexPath: string): string {
  const dir = dirname(indexPath);
  const sibling = join(dir, basename(indexPath).replace(/\.index$/i, ''));
  try {
    if (statSync(sibling).isDirectory()) return sibling;
  } catch {
    // No sibling folder: a git checkout, where the index sits at the repo root.
  }
  return dir;
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Flags that may repeat, like `--roll hp:level:2=7 --roll hp:level:3=4`. */
function valuesOf(args: string[], flag: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1] !== undefined) found.push(args[i + 1]!);
  }
  return found;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : '…' + text.slice(-(max - 1));
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`\n${explain(error)}\n`);
    if (process.env['INCUDO_DEBUG']) process.stderr.write(`${(error as Error).stack}\n`);
    process.exit(1);
  },
);

/**
 * A stack trace is the wrong answer to "you are offline" or "that file isn't there".
 * Set INCUDO_DEBUG=1 to get the trace as well.
 */
function explain(error: unknown): string {
  const err = error as NodeJS.ErrnoException;
  const message = err?.message ?? String(error);
  if (message.includes('fetch failed')) {
    return `Could not reach the network.\n  Check the URL, your connection, and any proxy.\n  A local path works offline: incudo validate ./path/to/core.index`;
  }
  if (err?.code === 'ENOENT') {
    return `No such file: ${err.path ?? 'unknown'}`;
  }
  return message;
}
