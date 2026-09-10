/**
 * `incudo aurora …` — read Aurora `.dnd5e` saves.
 *
 * Three commands, and the third is the one that matters:
 *
 *   inspect  what is in the file, without importing anything
 *   import   the file -> a `.incu`, portrait decoded out to real bytes
 *   verify   import it, re-derive it, and diff against the `<sum>` and `<magic>`
 *            blocks Aurora itself wrote
 *
 * `verify` is ADR 0008's second DONE criterion made runnable. Aurora already did the maths
 * for every character anyone ever built in it; a disagreement points straight at a bug in
 * Incudo's engine, its system definition, or the content. There is no better oracle
 * available to this project and it costs nothing.
 *
 * The saves themselves are personal data. Nothing here writes a character's name, notes or
 * portrait anywhere except the output file the user asked for.
 */

import { basename, extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  compareWithAurora,
  importAuroraCharacter,
  parseAuroraSave,
  summarizeDifferences,
  systemIdForSaveExtension,
  type AuroraComparison,
  type AuroraSave,
  type ImportedCharacter,
} from '@incudo/aurora-import';
import {
  BundleElementIndex,
  collectCharacterContent,
  deriveCharacter,
  packCharacterContainer,
  resolveCharacterKind,
  type Element,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { writeContainer } from './node-save.ts';
import { loadSystem, loadSystemForCharacter } from './node-system.ts';
import type { CommandContext } from './character-commands.ts';

export const AURORA_USAGE = `incudo aurora — read Aurora Builder character saves (import only, ADR 0008)

  inspect <file.dnd5e>
  import  <file.dnd5e> <out.incu> --index <index> [--system <system.json>]
  verify  <file.dnd5e> --index <index> [--system <system.json>] [--json]

  --index <index>   content to resolve the save's ids against; the same flags as
                    \`validate\` apply (--local, --root, --aurora-folder, --offline).
  --max-differences N   \`verify\` exits non-zero above this many real mismatches
                        (default 0). Differences Aurora computed in app code that no
                        system definition models are reported and never counted.
`;

export async function auroraCommand(ctx: CommandContext): Promise<number> {
  const [sub, ...rest] = ctx.positional;
  const args = { ...ctx, positional: rest };

  switch (sub) {
    case 'inspect':
      return auroraInspect(args);
    case 'import':
      return auroraImport(args);
    case 'verify':
      return auroraVerify(args);
    default:
      ctx.err(sub ? `Unknown aurora command "${sub}".\n\n` : '');
      ctx.err(AURORA_USAGE);
      return sub ? 2 : 0;
  }
}

// --- inspect ---------------------------------------------------------------

/**
 * What is in the file, without loading content or importing anything.
 *
 * Deliberately counts rather than lists. A save is somebody's character: the useful summary
 * is "57 decisions, a 5.2 MB portrait, 37,235 disabled ids", not their backstory.
 */
async function auroraInspect(ctx: CommandContext): Promise<number> {
  const file = ctx.positional[0];
  if (!file) {
    ctx.err('Usage: incudo aurora inspect <file.dnd5e>\n');
    return 2;
  }

  const save = await readSave(file, ctx);
  if (!save) return 1;

  const bytes = save.portrait?.base64?.length ?? 0;
  ctx.out(`${basename(file)}\n`);
  ctx.out(`  save format:      ${save.version ?? 'unknown'}\n`);
  ctx.out(`  system:           ${systemIdForSaveExtension(file) ?? 'unknown'}\n`);
  ctx.out(`  level:            ${save.levelCount}\n`);
  ctx.out(`  decisions:        ${save.decisions.length}\n`);
  ctx.out(`  recorded grants:  ${save.grants.length}  (derived; not imported)\n`);
  ctx.out(`  ability scores:   ${Object.keys(save.abilities).length}\n`);
  ctx.out(`  rolled hit dice:  ${save.rndhp.length}\n`);
  ctx.out(`  portrait:         ${bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB of base64` : 'none'}\n`);
  ctx.out(`  <sum>:            ${save.sum.length} elements (the oracle)\n`);
  ctx.out(`  <magic>:          ${save.magic.length} spellcasting block(s)\n`);
  ctx.out(`  disabled:         ${save.restrictedSources.length} sources, ${save.restrictedElements.length} elements\n`);
  ctx.out(`  freeform fields:  ${Object.keys(save.input).length + Object.keys(save.appearance).length}\n`);
  printDiagnostics(save.diagnostics, ctx);
  return 0;
}

// --- import ----------------------------------------------------------------

async function auroraImport(ctx: CommandContext): Promise<number> {
  const [file, out] = ctx.positional;
  const indexUrl = ctx.value('--index');
  if (!file || !out) {
    ctx.err('Usage: incudo aurora import <file.dnd5e> <out.incu> --index <index>\n');
    return 2;
  }

  const loaded = await importSave(file, indexUrl, ctx);
  if (!loaded) return 1;
  const { save, imported, elements, system } = loaded;

  // Aurora's own `<sum>` as extraIds: the save then carries every element Aurora's
  // derivation used, not only what Incudo's reaches. That is what keeps `aurora verify`
  // meaningful after the original .dnd5e is gone.
  const content = collectCharacterContent(imported.character, elements, {
    kind: resolveCharacterKind(system, imported.character.kind),
    extraIds: imported.extraIds,
  });
  const files = packCharacterContainer(imported.character, content, {
    assets: imported.assets,
    generator: 'incudo-cli (aurora import)',
  });
  await writeContainer(out, files);

  const total = [...files.values()].reduce((n, b) => n + b.length, 0);
  ctx.out(`${basename(file)} → ${out}\n`);
  ctx.out(`  ${imported.character.choices.length} choices, `);
  ctx.out(`${Object.keys(imported.character.rolls).length} recorded rolls, `);
  ctx.out(`${Object.keys(imported.character.baseStats ?? {}).length} ability scores\n`);
  ctx.out(`  ${content.elements.length} elements embedded, ${imported.assets.size} asset(s)\n`);
  ctx.out(`  ${imported.character.sources.length} source(s) in the allowlist`);
  ctx.out(save.restrictedSources.length ? ` (inverted from ${save.restrictedSources.length} disabled)\n` : '\n');
  ctx.out(`  ${(total / 1024).toFixed(0)} KB before compression\n`);
  if (content.unresolved.length) {
    ctx.out(`  ${content.unresolved.length} referenced id(s) not in the loaded content, recorded as unresolved\n`);
  }
  printDiagnostics(imported.diagnostics, ctx);
  return 0;
}

// --- verify ----------------------------------------------------------------

/**
 * The differential check.
 *
 * Import, derive, and diff against what Aurora recorded. The exit code counts only real
 * disagreements: things Aurora computed in its own app code with no content behind them —
 * the multiclass spell slot table is the standing example — are reported as `not-modelled`
 * and never counted, because a check that can never pass is a check nobody runs.
 */
async function auroraVerify(ctx: CommandContext): Promise<number> {
  const file = ctx.positional[0];
  const indexUrl = ctx.value('--index');
  if (!file || !indexUrl) {
    ctx.err('Usage: incudo aurora verify <file.dnd5e> --index <index>\n');
    return 2;
  }

  const loaded = await importSave(file, indexUrl, ctx);
  if (!loaded) return 1;
  const { save, imported, elements, system } = loaded;

  const derived = deriveCharacter(imported.character, system, elements);
  const comparison = compareWithAurora(save, derived, { index: elements });

  if (ctx.flags.has('--json')) {
    ctx.out(JSON.stringify({ file: basename(file), ...comparison }, null, 2) + '\n');
  } else {
    printComparison(basename(file), save, derived.problems.length, comparison, ctx);
  }

  const budget = Number(ctx.value('--max-differences') ?? 0);
  return comparison.mismatches > budget ? 1 : 0;
}

function printComparison(
  name: string,
  save: AuroraSave,
  problems: number,
  comparison: AuroraComparison,
  ctx: CommandContext,
): void {
  ctx.out(`${name}\n`);
  ctx.out(`  Aurora derived ${comparison.auroraElements} elements; Incudo derived ${comparison.incudoElements}\n`);
  if (save.magic.length) {
    ctx.out(`  ${save.magic.length} spellcasting block(s) compared\n`);
  }
  if (problems) ctx.out(`  ${problems} problem(s) in Incudo's derivation\n`);

  const counts = summarizeDifferences(comparison);
  for (const [kind, count] of [...counts].sort()) {
    ctx.out(`  ${String(count).padStart(4)}  ${kind}\n`);
  }

  for (const difference of comparison.differences.slice(0, 30)) {
    ctx.out(`    ${difference.kind === 'not-modelled' ? 'note' : 'DIFF'}  ${difference.message}\n`);
  }
  if (comparison.differences.length > 30) {
    ctx.out(`    … and ${comparison.differences.length - 30} more\n`);
  }

  ctx.out(
    comparison.agrees
      ? '\n  Agrees with Aurora on everything both sides model.\n'
      : `\n  ${comparison.mismatches} real disagreement(s).\n`,
  );
}

// --- shared ----------------------------------------------------------------

interface LoadedSave {
  save: AuroraSave;
  imported: ImportedCharacter;
  elements: ElementIndex;
  system: GameSystem;
}

async function importSave(
  file: string,
  indexUrl: string | undefined,
  ctx: CommandContext,
): Promise<LoadedSave | undefined> {
  if (!indexUrl) {
    ctx.err('This needs content to resolve the save against: --index <index>\n');
    return undefined;
  }

  const save = await readSave(file, ctx);
  if (!save) return undefined;

  const corpus = await ctx.loadIndex(indexUrl);
  const systemId = ctx.value('--system-id') ?? systemIdForSaveExtension(file) ?? 'dnd5e';
  const imported = importAuroraCharacter(save, {
    index: corpus,
    systemId,
    source: { id: indexUrl },
  });

  // The elements Aurora made up at runtime and this save is the only record of. Layered
  // over the corpus rather than added to it: they belong to this character, not to anyone's
  // content library.
  const elements = imported.generated.length ? overlay(corpus, imported.generated) : corpus;

  const explicit = ctx.value('--system');
  const system = explicit
    ? await loadSystem(explicit, ctx.err)
    : await loadSystemForCharacter(imported.character, undefined, ctx.err);
  if (!system) return undefined;

  return { save, imported, elements, system };
}

/**
 * One index that answers from `extra` first and falls back to `base`.
 *
 * Small enough to keep here rather than in `core`: only the Aurora save importer needs a
 * per-character content overlay, and giving `core` a general layering type would be
 * inventing a concept for one caller.
 */
function overlay(base: ElementIndex, extra: Element[]): ElementIndex {
  const own = new BundleElementIndex(extra);
  return {
    get: (id) => own.get(id) ?? base.get(id),
    all: function* () {
      yield* base.all();
      yield* own.all();
    },
    byType: (type) => [...base.byType(type), ...own.byType(type)],
    bySupport: (tag) => [...base.bySupport(tag), ...own.bySupport(tag)],
  };
}

async function readSave(file: string, ctx: CommandContext): Promise<AuroraSave | undefined> {
  if (extname(file).toLowerCase() === '.incu') {
    ctx.err(`${file} is already an Incudo save. Use \`incudo character show\`.\n`);
    return undefined;
  }
  let xml: string;
  try {
    xml = await readFile(file, 'utf8');
  } catch (error) {
    ctx.err(`Could not read ${file}: ${(error as Error).message}\n`);
    return undefined;
  }
  const save = parseAuroraSave(xml);
  if (save.diagnostics.some((d) => d.level === 'error')) {
    printDiagnostics(save.diagnostics, ctx);
    return undefined;
  }
  return save;
}

/**
 * Diagnostics, deduplicated by message.
 *
 * A save repeats the same structural oddity once per level — one sample produces the
 * "neither id nor registered" warning eight times for the same construct. Eight copies of
 * one sentence is how a report stops being read.
 */
function printDiagnostics(
  diagnostics: Array<{ level: string; message: string }>,
  ctx: CommandContext,
): void {
  const counts = new Map<string, { level: string; n: number }>();
  for (const d of diagnostics) {
    const existing = counts.get(d.message);
    if (existing) existing.n++;
    else counts.set(d.message, { level: d.level, n: 1 });
  }
  if (!counts.size) return;
  ctx.out('\n');
  for (const [message, { level, n }] of counts) {
    ctx.out(`  ${level.toUpperCase()}  ${message}${n > 1 ? ` (×${n})` : ''}\n`);
  }
}
