/**
 * `incudo character …` — the whole character lifecycle with no UI in the way.
 *
 * The CLI is the engine's first consumer on purpose (ROADMAP Phase 0), and characters are
 * the part that most needs it: the claim in ADR 0012 is that a save opens with zero content
 * sources, and the only honest way to check that is to build one *with* the corpus and open
 * it *without*. `incudo character show --no-sources` is that check, and `character verify`
 * runs both halves and diffs them.
 *
 *   incudo character new     <out> --system <system.json> [--kind pc] [--name …]
 *   incudo character choose  <file> <ruleKey> <elementId…> --index <index> [--system …]
 *   incudo character set     <file> --progress N | --roll key=value | --name …
 *   incudo character show    <file> [--system <system.json>] [--json]
 *   incudo character pack    <folder> <out.incu>
 *   incudo character unpack  <file.incu> <folder>
 *   incudo character verify  <file> --index <index> [--system <system.json>]
 */

import {
  BundleElementIndex,
  collectCharacterContent,
  createCharacter,
  defaultCharacterKindId,
  clampProgress,
  deriveCharacter,
  initialProgress,
  packCharacterContainer,
  readCharacterContainer,
  resolveCharacterKind,
  setChoice,
  setRoll,
  progressionStat,
  type Character,
  type ContainerFiles,
  type DerivedCharacter,
  type ElementIndex,
  type GameSystem,
  type ResolvedCharacterKind,
} from '@incudo/core';
import { readContainer, writeContainer } from './node-save.ts';
import { loadSystem, loadSystemForCharacter } from './node-system.ts';

export interface CommandContext {
  positional: string[];
  flags: Set<string>;
  value(flag: string): string | undefined;
  values(flag: string): string[];
  /** Load a content library from --index, honouring --local / --aurora-folder / --root. */
  loadIndex(indexUrl: string): Promise<ElementIndex>;
  out(text: string): void;
  err(text: string): void;
}

export const CHARACTER_USAGE = `incudo character — build and inspect characters with no UI

  new     <out> --system <system.json> [--kind <id>] [--name <name>] [--progress N]
  choose  <file> <ruleKey> <elementId…> --index <index>
  set     <file> [--progress N] [--name <name>] [--roll <key>=<value>]…
  show    <file> [--system <system.json>] [--index <index>] [--json]
  pack    <folder> <out.incu>
  unpack  <file.incu> <folder>
  verify  <file> --index <index>

<file> is a .incu container or an unpacked folder; both forms read and write the same
tree (ADR 0012). Writing follows the extension: a .incu name gets a zip, anything else
gets a folder.

  --system <path>   the system definition. Optional once a character exists: the CLI
                    looks beside the systems/ directory for the id the save records.
  --index <index>   content to build against. Only "new", "choose" and "verify" need it —
                    "show" reads the content embedded in the save, which is the point.
  --no-sources      refuse to load any content source, even if one is configured. What a
                    fresh install looks like.
`;

export async function characterCommand(ctx: CommandContext): Promise<number> {
  const [sub, ...rest] = ctx.positional;
  const args = { ...ctx, positional: rest };

  switch (sub) {
    case 'new':
      return characterNew(args);
    case 'choose':
      return characterChoose(args);
    case 'set':
      return characterSet(args);
    case 'show':
      return characterShow(args);
    case 'pack':
      return characterPack(args, 'zip');
    case 'unpack':
      return characterPack(args, 'folder');
    case 'verify':
      return characterVerify(args);
    default:
      ctx.err(sub ? `Unknown character command "${sub}".\n\n` : '');
      ctx.err(CHARACTER_USAGE);
      return sub ? 2 : 0;
  }
}

// --- new -------------------------------------------------------------------

async function characterNew(ctx: CommandContext): Promise<number> {
  const out = ctx.positional[0];
  const systemPath = ctx.value('--system');
  if (!out || !systemPath) {
    ctx.err('Usage: incudo character new <out> --system <system.json>\n');
    return 2;
  }

  const system = await loadSystem(systemPath, ctx.err);
  if (!system) return 1;

  const kindId = ctx.value('--kind') ?? defaultCharacterKindId(system);
  if (!kindId) {
    ctx.err(`System "${system.id}" declares no character kinds.\n`);
    return 1;
  }
  const kind = resolveCharacterKind(system, kindId);

  const character = createCharacter(system.id, kind.id, {
    name: ctx.value('--name') ?? 'New Character',
    progress: numberOf(ctx.value('--progress')) ?? initialProgress(kind.progression),
  });
  character.progress = clampProgress(kind.progression, character.progress);

  await writeCharacter(out, character, new BundleElementIndex([]), kind);
  ctx.out(`Created ${out}\n`);
  ctx.out(`  system:   ${system.name} (${system.id})\n`);
  ctx.out(`  kind:     ${kind.name} (${kind.id})\n`);
  ctx.out(`  ${describeProgress(kind, character)}\n`);
  return 0;
}

// --- choose ----------------------------------------------------------------

async function characterChoose(ctx: CommandContext): Promise<number> {
  const [file, ruleKey, ...elementIds] = ctx.positional;
  const indexUrl = ctx.value('--index');
  if (!file || !ruleKey || !indexUrl) {
    ctx.err('Usage: incudo character choose <file> <ruleKey> <elementId…> --index <index>\n');
    return 2;
  }

  const loaded = await loadCharacter(file, ctx);
  if (!loaded) return 1;

  const elements = await ctx.loadIndex(indexUrl);
  const missing = elementIds.filter((id) => !elements.get(id));
  if (missing.length) {
    ctx.err(`Not in that content: ${missing.join(', ')}\n`);
    return 1;
  }

  const character = setChoice(loaded.character, ruleKey, elementIds);
  // The system first, because the kind decides which baseline elements the save embeds.
  const system = await loadSystemForCharacter(character, ctx.value('--system'), ctx.err);
  const kind = system ? resolveCharacterKind(system, character.kind) : undefined;
  await writeCharacter(file, character, elements, kind);

  if (system) {
    const derived = deriveCharacter(character, system, elements);
    ctx.out(`${character.name}: ${derived.elements.length} elements, `);
    ctx.out(`${derived.pendingChoices.length} choices pending, `);
    ctx.out(`${derived.problems.filter((p) => p.level === 'error').length} problems\n`);
  }
  return 0;
}

// --- set -------------------------------------------------------------------

async function characterSet(ctx: CommandContext): Promise<number> {
  const file = ctx.positional[0];
  if (!file) {
    ctx.err('Usage: incudo character set <file> [--progress N] [--name …] [--roll k=v]\n');
    return 2;
  }

  const loaded = await loadCharacter(file, ctx);
  if (!loaded) return 1;
  let character = loaded.character;

  const name = ctx.value('--name');
  if (name !== undefined) character = { ...character, name };

  // Loaded up front now, not just when --progress is given: the kind decides which baseline
  // elements the save embeds, and every write re-collects them.
  const system = await loadSystemForCharacter(character, ctx.value('--system'), ctx.err);
  const kind = system ? resolveCharacterKind(system, character.kind) : undefined;

  const progress = numberOf(ctx.value('--progress'));
  if (progress !== undefined) {
    // Without the system there is no progression to clamp against; store what was asked
    // rather than refusing, and let the next derivation with a system sort it out.
    const clamped = kind ? clampProgress(kind.progression, progress) : progress;
    if (clamped !== progress) {
      ctx.err(`Progress ${progress} is outside this kind's range; using ${clamped}.\n`);
    }
    character = { ...character, progress: clamped };
  }

  for (const entry of ctx.values('--roll')) {
    const at = entry.indexOf('=');
    if (at < 0) {
      ctx.err(`--roll wants <key>=<value>, got "${entry}".\n`);
      return 2;
    }
    const key = entry.slice(0, at);
    const raw = entry.slice(at + 1);
    // An empty value forgets the roll. Nothing else ever removes one — see ADR 0007.
    character = setRoll(character, key, raw === '' ? undefined : Number(raw));
  }

  character = { ...character, updatedAt: new Date().toISOString() };
  await writeCharacter(file, character, new BundleElementIndex(loaded.embedded), kind);
  ctx.out(`Updated ${file}\n`);
  return 0;
}

// --- show ------------------------------------------------------------------

async function characterShow(ctx: CommandContext): Promise<number> {
  const file = ctx.positional[0];
  if (!file) {
    ctx.err('Usage: incudo character show <file> [--json]\n');
    return 2;
  }

  const loaded = await loadCharacter(file, ctx);
  if (!loaded) return 1;

  const system = await loadSystemForCharacter(loaded.character, ctx.value('--system'), ctx.err);
  if (!system) return 1;

  // The default is the ADR 0012 case: derive against the content the save carries and
  // nothing else. --index is available for comparing against a live corpus.
  const indexUrl = ctx.flags.has('--no-sources') ? undefined : ctx.value('--index');
  const elements = indexUrl
    ? await ctx.loadIndex(indexUrl)
    : new BundleElementIndex(loaded.embedded);

  const derived = deriveCharacter(loaded.character, system, elements);

  if (ctx.flags.has('--json')) {
    ctx.out(JSON.stringify(summarize(derived), null, 2) + '\n');
    return 0;
  }

  printSheet(derived, loaded.embedded.length, ctx);
  return derived.problems.some((p) => p.level === 'error') ? 1 : 0;
}

// --- pack / unpack ---------------------------------------------------------

async function characterPack(ctx: CommandContext, form: 'zip' | 'folder'): Promise<number> {
  const [from, to] = ctx.positional;
  if (!from || !to) {
    ctx.err(`Usage: incudo character ${form === 'zip' ? 'pack <folder> <out.incu>' : 'unpack <file.incu> <folder>'}\n`);
    return 2;
  }
  const files = await readContainer(from);
  await writeContainer(to, files, form);
  ctx.out(`${from} → ${to} (${files.size} entries)\n`);
  return 0;
}

// --- verify ----------------------------------------------------------------

/**
 * The ADR 0012 check, as a command.
 *
 * Derive the character twice — once against the whole corpus, once against nothing but what
 * the save carries — and diff. Identical output is the entire product requirement: *"a save
 * file generated in an app that has 200 books of sources should be openable in a fresh app
 * with zero sources."* A difference here is the bug that requirement exists to catch.
 */
async function characterVerify(ctx: CommandContext): Promise<number> {
  const file = ctx.positional[0];
  const indexUrl = ctx.value('--index');
  if (!file || !indexUrl) {
    ctx.err('Usage: incudo character verify <file> --index <index>\n');
    return 2;
  }

  const loaded = await loadCharacter(file, ctx);
  if (!loaded) return 1;
  const system = await loadSystemForCharacter(loaded.character, ctx.value('--system'), ctx.err);
  if (!system) return 1;

  const corpus = await ctx.loadIndex(indexUrl);

  // Content the save carries that the corpus does not have at all. Normally empty. It is not
  // empty for a character imported from Aurora, which embeds the elements Aurora's app
  // invented at runtime and no content file declares — so for those the *corpus* is the
  // incomplete side, and a difference confined to them is the save doing its job.
  const corpusLacks = loaded.embedded.filter((e) => !corpus.get(e.id)).map((e) => e.id);

  const withSources = summarize(deriveCharacter(loaded.character, system, corpus));
  const withoutSources = summarize(
    deriveCharacter(loaded.character, system, new BundleElementIndex(loaded.embedded)),
  );

  const a = JSON.stringify(withSources, null, 2);
  const b = JSON.stringify(withoutSources, null, 2);

  ctx.out(`with the full corpus:  ${withSources.elements.length} elements, `);
  ctx.out(`${Object.keys(withSources.stats).length} stats\n`);
  ctx.out(`with zero sources:     ${withoutSources.elements.length} elements, `);
  ctx.out(`${Object.keys(withoutSources.stats).length} stats\n`);

  if (a === b) {
    ctx.out('\nIdentical. The save opens without its sources (ADR 0012).\n');
    return 0;
  }

  // The property ADR 0012 actually asks for is that the save alone loses nothing. Content the
  // corpus is missing cannot be that failure: it is the save carrying more, not less.
  const onlyTheCorpusIsShort = accountedFor(withSources, withoutSources, new Set(corpusLacks));
  if (onlyTheCorpusIsShort) {
    ctx.out(`\nThe save opens without its sources (ADR 0012).\n`);
    ctx.out(`It also carries ${corpusLacks.length} element(s) the corpus does not have:\n`);
    for (const id of corpusLacks.slice(0, 10)) ctx.out(`  ${id}\n`);
    if (corpusLacks.length > 10) ctx.out(`  … and ${corpusLacks.length - 10} more\n`);
    ctx.out(`So the corpus derivation is the short one here, not the save's.\n`);
    return 0;
  }

  ctx.err('\nThe two derivations differ. The save is NOT self-contained.\n');
  for (const line of firstDifferences(a, b, 20)) ctx.err(`  ${line}\n`);
  return 1;
}

/**
 * Whether every difference between the two derivations is explained by the given ids.
 *
 * Deliberately strict about what counts as explained: the stats, the pending choices and the
 * problems must match exactly, and the element lists may differ *only* by ids in the set. A
 * save that carries an extra element which also changes a number is not explained — that is
 * the case worth failing on.
 */
export function accountedFor(
  withSources: DerivedSummary,
  withoutSources: DerivedSummary,
  expected: Set<string>,
): boolean {
  if (!expected.size) return false;

  const strip = (summary: DerivedSummary): string =>
    JSON.stringify({
      ...summary,
      elements: summary.elements.filter((id) => !expected.has(id)),
      // The corpus side also reports each of these as unresolved, which is the same fact
      // stated twice rather than a second difference.
      problems: summary.problems.filter((p) => !p.elementId || !expected.has(p.elementId)),
    });
  if (strip(withSources) !== strip(withoutSources)) return false;

  // And the ids that do differ must all be ones we said to expect, in either direction.
  const a = new Set(withSources.elements);
  const b = new Set(withoutSources.elements);
  for (const id of [...a, ...b]) {
    if (a.has(id) === b.has(id)) continue;
    if (!expected.has(id)) return false;
  }
  return true;
}

// --- shared ----------------------------------------------------------------

interface LoadedCharacter {
  character: Character;
  embedded: import('@incudo/core').Element[];
}

async function loadCharacter(path: string, ctx: CommandContext): Promise<LoadedCharacter | undefined> {
  let files: ContainerFiles;
  try {
    files = await readContainer(path);
  } catch (error) {
    ctx.err(`Could not read ${path}: ${(error as Error).message}\n`);
    return undefined;
  }

  const { container, problems } = readCharacterContainer(files);
  for (const problem of problems) {
    ctx.err(`  ${problem.level.toUpperCase()}  ${problem.path ?? ''} ${problem.message}\n`);
  }
  if (!container) return undefined;

  return { character: container.character, embedded: container.content.elements };
}

/**
 * Write a character back out, recomputing the embedded content from whatever index is at
 * hand. Every write re-collects: a choice that was removed should take its content with it,
 * and a save that only ever grows is a save that accumulates content the character stopped
 * using.
 */
async function writeCharacter(
  path: string,
  character: Character,
  elements: ElementIndex,
  kind?: ResolvedCharacterKind,
): Promise<void> {
  const content = collectCharacterContent(character, elements, { kind });
  const files = packCharacterContainer(character, content, { generator: 'incudo-cli' });
  await writeContainer(path, files);
}

export interface DerivedSummary {
  character: { id: string; name: string; systemId: string; kind: string; progress: number };
  elements: string[];
  stats: Record<string, number | string>;
  pendingChoices: Array<{ ruleKey: string; label: string; remaining: number }>;
  problems: Array<{ level: string; code: string; message: string; elementId?: string }>;
}

/**
 * The comparable projection of a derivation.
 *
 * Sorted and stripped to what a character *is*, so two derivations of the same character can
 * be compared byte for byte. Candidate lists are deliberately excluded: they depend on what
 * content is loaded, which is exactly the thing that differs between the two runs, and
 * embedding every option a character could have taken is explicitly not what a save is for
 * (ADR 0012).
 */
export function summarize(derived: DerivedCharacter): DerivedSummary {
  const stats: Record<string, number | string> = {};
  for (const key of [...derived.stats.keys()].sort()) {
    const stat = derived.stats.get(key)!;
    stats[key] = stat.text ?? stat.value;
  }

  return {
    character: {
      id: derived.character.id,
      name: derived.character.name,
      systemId: derived.character.systemId,
      kind: derived.character.kind,
      progress: derived.character.progress,
    },
    elements: derived.elements.map((e) => e.id).sort(),
    stats,
    pendingChoices: derived.pendingChoices
      .map((c) => ({ ruleKey: c.ruleKey, label: c.label, remaining: c.remaining }))
      .sort((a, b) => (a.ruleKey < b.ruleKey ? -1 : 1)),
    problems: derived.problems
      .map((p) => ({ level: p.level, code: p.code, message: p.message, elementId: p.elementId }))
      .sort((a, b) => (a.message < b.message ? -1 : 1)),
  };
}

function printSheet(derived: DerivedCharacter, embedded: number, ctx: CommandContext): void {
  const { character, kind } = derived;
  ctx.out(`${character.name}\n`);
  ctx.out(`  ${kind.name} · ${derived.system.name}\n`);
  ctx.out(`  ${describeProgress(kind, character)}\n`);
  ctx.out(`  ${derived.elements.length} elements (${embedded} embedded in the save)\n\n`);

  for (const section of kind.sheet.sections) {
    const stats = (section.stats ?? [])
      .map((name) => {
        const stat = derived.stats.get(name.toLowerCase());
        return stat ? `${name} ${stat.text ?? stat.value}` : undefined;
      })
      .filter((s): s is string => s !== undefined);

    const elements = derived.elements.filter((e) => (section.types ?? []).includes(e.type));
    if (!stats.length && !elements.length) continue;

    ctx.out(`  ${section.label}\n`);
    if (stats.length) ctx.out(`    ${stats.join('  ·  ')}\n`);
    for (const element of elements.slice(0, 12)) ctx.out(`    ${element.name}\n`);
    if (elements.length > 12) ctx.out(`    … and ${elements.length - 12} more\n`);
    ctx.out('\n');
  }

  if (derived.pendingChoices.length) {
    ctx.out(`  Still to choose\n`);
    for (const choice of derived.pendingChoices.slice(0, 12)) {
      ctx.out(`    ${choice.ruleKey}  ${choice.label} (${choice.remaining})\n`);
    }
    if (derived.pendingChoices.length > 12) {
      ctx.out(`    … and ${derived.pendingChoices.length - 12} more\n`);
    }
    ctx.out('\n');
  }

  for (const problem of derived.problems.slice(0, 20)) {
    ctx.out(`  ${problem.level.toUpperCase()}  ${problem.message}\n`);
  }
}

function describeProgress(
  kind: import('@incudo/core').ResolvedCharacterKind,
  character: Character,
): string {
  const stat = progressionStat(kind.progression);
  if (!stat) return 'no progression';
  return `${stat}: ${character.progress}`;
}

function firstDifferences(a: string, b: string, limit: number): string[] {
  const left = a.split('\n');
  const right = b.split('\n');
  const lines: string[] = [];
  for (let i = 0; i < Math.max(left.length, right.length) && lines.length < limit; i++) {
    if (left[i] === right[i]) continue;
    lines.push(`- ${left[i] ?? '(end)'}`);
    lines.push(`+ ${right[i] ?? '(end)'}`);
  }
  return lines;
}

function numberOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
