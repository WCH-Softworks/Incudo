/**
 * An Aurora `.dnd5e` save, into the character library — ADR 0008's importer meeting ADR
 * 0027's folder.
 *
 * The sequence here is not new: `tools/verify/src/library.test.ts` has been doing it
 * headlessly since the library landed (and the `aurora import` command did, from Phase 1 until
 * ADR 0039 removed it). What is new
 * is that it is written down **once**, in the layer both shells read, rather than a third
 * time inside a button handler (CODE-REUSE-POLICY rule 2). Nothing below knows what a screen
 * is.
 *
 * **This is the one library operation that needs content, and that is not a contradiction.**
 * ADR 0012 says a `.incu` opens with zero sources, and `character-library.ts` exists to hold
 * that line. An import runs the other way: a `.dnd5e` records Aurora's element *ids* and
 * nothing about what they mean, so turning one into a self-contained save means resolving
 * those ids against a corpus and copying what they name into the container. With no content
 * loaded the honest outcome is a sentence saying so — never a character full of ids nothing
 * can resolve, which is a save that opens to an empty sheet forever. So this file takes an
 * `ElementIndex` as an argument, and `character-library.ts` still takes none.
 *
 * Two steps are easy to leave out and neither fails loudly:
 *
 * - **The overlay.** `imported.generated` are elements Aurora's application materialises and
 *   no content file declares — one per class per ability-score-improvement level, among
 *   others. They belong to *this character*, not to anyone's content library, so they go in
 *   front of the corpus in a `LayeredElementIndex` rather than into it.
 * - **`extraIds`.** Aurora's own `<sum>`: every element its derivation ended up with.
 *   Embedding that set is what keeps the Aurora oracle meaningful once the original
 *   `.dnd5e` is gone.
 *
 * Miss either and the container is written short, the import still reports success, and ADR
 * 0012 is quietly broken for that one character.
 */

import {
  BundleElementIndex,
  LayeredElementIndex,
  type Character,
  type ContainerForm,
  type ElementId,
  type ElementIndex,
  type GameSystem,
  type LibraryEntryRef,
  type PickedFile,
} from '@incudo/core';
import {
  importAuroraCharacter,
  parseAuroraSave,
  systemIdForSaveExtension,
  type AuroraSave,
  type SaveDiagnostic,
} from '@incudo/aurora-import';

import type { CharacterLibrary } from './character-library.ts';

export interface AuroraImportOptions {
  system: GameSystem;
  /**
   * The corpus Aurora's ids are resolved against. Required — see the file header for why this
   * is the one library operation with content in its signature at all.
   */
  elements: ElementIndex;
  /**
   * Recorded as the index this character came from, the way the removed `aurora import` command
   * recorded its `--index`.
   *
   * Optional, and the desktop shell leaves it out: `recordSourceRefs` already works the
   * answer out from the `origin.sourceId` of every element the container embeds, which is
   * the index URL for a configured source. That is derived rather than asserted, and it
   * copes with several sources at once where naming one could only ever pick arbitrarily.
   */
  sourceId?: string;
  generator?: string;
  /** The form for the new entry. A zip unless a caller says otherwise — ADR 0027. */
  form?: ContainerForm;
}

/**
 * What happened to one file. Always a report, never a throw: nine saves imported at once
 * should tell you about all nine rather than stop at the first surprise.
 */
export interface AuroraImportReport {
  /** The file the user picked, by its own name. */
  file: string;
  ok: boolean;
  /** Where it landed in the library. */
  entry?: LibraryEntryRef;
  /** The imported character, for a shell that wants it without re-reading the file. */
  character?: Character;
  /** The corpus with this save's generated elements layered in front of it. */
  elements?: ElementIndex;
  /** How many elements the container embeds. */
  embedded?: number;
  /**
   * Ids the character names that the loaded content does not declare.
   *
   * Not an error and not a refusal: a save that names content the user does not have still
   * imports, and this is how it says which parts of it will be missing. Usually it means a
   * source is disabled, or the character was built with a book this corpus does not carry.
   */
  unresolved: ElementId[];
  assetCount: number;
  /** One sentence for the user when `ok` is false. */
  message?: string;
  /**
   * Everything the parser and the importer had to say, deduplicated by message.
   *
   * Shown, never swallowed (ADR 0005). A save that imports with warnings is the normal case
   * rather than the exception — a warning here usually means content moved upstream, not
   * that something is wrong with the character.
   */
  diagnostics: AuroraImportDiagnostic[];
}

/** A diagnostic, and how many times this file produced it. */
export interface AuroraImportDiagnostic extends SaveDiagnostic {
  /**
   * A save repeats one structural oddity once per level — one of the nine real samples
   * produces the same warning eight times. Eight copies of one sentence is how a report
   * stops being read.
   */
  count: number;
}

/**
 * Import one save and write it into the library.
 *
 * The library does the writing, so the filename, the collision suffix and the recorded
 * sources are the same code that saves a character built in the app: ADR 0027 slugs the
 * character's name, adds a numeric suffix when that is taken, and never renames anything
 * already in the folder.
 */
export async function importAuroraSaveIntoLibrary(
  library: CharacterLibrary,
  file: PickedFile,
  options: AuroraImportOptions,
): Promise<AuroraImportReport> {
  const fail = (message: string, diagnostics: SaveDiagnostic[] = []): AuroraImportReport => ({
    file: file.name,
    ok: false,
    message,
    unresolved: [],
    assetCount: 0,
    diagnostics: tally(diagnostics),
  });

  const systemId = systemIdForSaveExtension(file.name);
  if (!systemId) {
    return fail(`"${file.name}" has no extension, so nothing in it says which game it is.`);
  }
  if (systemId !== options.system.id) {
    return fail(
      `"${file.name}" is a ${systemId} save and the loaded system is ${options.system.id}. ` +
        'Aurora names the game in the file extension, and Incudo will not guess past it.',
    );
  }

  // The empty-corpus case, said plainly. Everything past here would "succeed" against no
  // content and write a character nothing can render.
  if (isEmpty(options.elements)) {
    return fail(
      'Importing needs content loaded: a .dnd5e records Aurora’s element ids and nothing ' +
        'about what they mean. Add and enable a content source, then import again. Opening a ' +
        'character you have already imported needs none (ADR 0012).',
    );
  }

  let save: AuroraSave;
  try {
    save = parseAuroraSave(new TextDecoder().decode(file.bytes));
  } catch (error) {
    return fail(`"${file.name}" did not read as an Aurora save: ${messageOf(error)}`);
  }
  if (save.diagnostics.some((diagnostic) => diagnostic.level === 'error')) {
    return fail(`"${file.name}" did not read as an Aurora save.`, save.diagnostics);
  }

  const imported = importAuroraCharacter(save, {
    index: options.elements,
    systemId,
    ...(options.sourceId ? { source: { id: options.sourceId } } : {}),
  });

  const elements = imported.generated.length
    ? new LayeredElementIndex([new BundleElementIndex(imported.generated), options.elements])
    : options.elements;

  const result = await library.save(imported.character, options.system, elements, {
    extraIds: imported.extraIds,
    assets: imported.assets,
    generator: options.generator ?? 'aurora import',
    ...(options.form ? { form: options.form } : {}),
  });

  if (!result.ok) {
    return { ...fail(result.message, imported.diagnostics), character: imported.character, elements };
  }

  return {
    file: file.name,
    ok: true,
    entry: result.entry,
    character: imported.character,
    elements,
    embedded: result.elementCount,
    unresolved: result.unresolved,
    assetCount: imported.assets.size,
    diagnostics: tally(imported.diagnostics),
  };
}

/** The same, for however many files the picker returned. One report each, in order. */
export async function importAuroraSavesIntoLibrary(
  library: CharacterLibrary,
  files: readonly PickedFile[],
  options: AuroraImportOptions,
): Promise<AuroraImportReport[]> {
  const reports: AuroraImportReport[] = [];
  // Sequentially, because each write has to see the one before it: the library picks a free
  // filename from its current listing, and two characters called Aelin racing would collide.
  for (const file of files) {
    reports.push(await importAuroraSaveIntoLibrary(library, file, options));
  }
  return reports;
}

/** Deduplicated by message, first occurrence first — the shape the removed CLI printed, shared. */
function tally(diagnostics: readonly SaveDiagnostic[]): AuroraImportDiagnostic[] {
  const counts = new Map<string, AuroraImportDiagnostic>();
  for (const diagnostic of diagnostics) {
    const existing = counts.get(diagnostic.message);
    if (existing) existing.count++;
    else counts.set(diagnostic.message, { ...diagnostic, count: 1 });
  }
  return [...counts.values()];
}

/** Whether an index holds nothing, without asking it for a size the interface does not have. */
function isEmpty(index: ElementIndex): boolean {
  for (const _element of index.all()) return false;
  return true;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
