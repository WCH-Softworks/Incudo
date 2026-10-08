/**
 * An Aurora save received on a phone, imported on a tap — ADR 0101.
 *
 * `received-files.ts` recognises a `.dnd5e` by its contents and offers it for import. This says what the import needs
 * before it runs, and runs it. An import resolves the ids a save records against content and embeds what they name (ADR
 * 0012), so it needs its game's content loaded, and a first import may mean adding a source, which downloads it in full.
 * Nothing is switched on or downloaded for the user: each of those is a question with its own button (`saveImportStep`),
 * asked again after every answer until the import is `ready`.
 *
 * The game is the file's extension when it has one, as Aurora names it (ADR 0008). A phone often hands over a file with
 * no extension (a provider's id, `msf:44`), and then the user is asked which game, among the systems that read Aurora
 * content (`auroraTypeMap`): their answer, not a guess. The import itself is the desktop's `importAuroraSaveIntoLibrary`,
 * through `CharacterLibrary.save`, so the name is free and never over a file already there (ADR 0027).
 */

import type { ConfiguredSource } from '@incudo/content';
import type { ElementIndex, GameSystem, LibraryEntryRef, SuggestedSource } from '@incudo/core';

import { importAuroraSaveIntoLibrary, type AuroraImportDiagnostic } from './aurora-import.ts';
import { suggestedFileName, type CharacterLibrary } from './character-library.ts';
import { addSourceNote, type ConnectionState } from './fetch-prompt.ts';
import { shown, type ReceivedFile } from './received-files.ts';

/** What the question before an import can see: the games, the source profile, the connection. */
export interface SaveImportContext {
  systems: readonly GameSystem[];
  /** Every configured source, of every system. */
  sources: readonly ConfiguredSource[];
  connection: ConnectionState;
}

/** The next thing to ask before an import, or `ready` when there is nothing left to ask. */
export type SaveImportStep =
  | { kind: 'ready' }
  /** A file whose name does not say which game it is for. One choice per system that reads Aurora content. */
  | { kind: 'choose-game'; title: string; message: string; choices: { systemId: string; label: string }[] }
  /** Every source of the game is switched off: the Content screen is where to switch one on. */
  | { kind: 'switched-off'; systemId: string; title: string; message: string }
  /** The game has no source and suggests one: add it, then import. */
  | { kind: 'needs-source'; systemId: string; suggestion: SuggestedSource; title: string; message: string; confirm: string }
  /** The game has no source and suggests none, or no game reads Aurora saves at all. */
  | { kind: 'no-source'; title: string; message: string };

/** The systems a save may be imported into: those that read Aurora content. */
function auroraSystems(systems: readonly GameSystem[]): GameSystem[] {
  return systems.filter((system) => system.auroraTypeMap !== undefined);
}

/**
 * The system a file's extension names, as Aurora names the game (`.dnd5e`), among those that read Aurora content.
 * Undefined for no extension, a provider's id, or one naming no such game (".xml", ".txt"): the user is asked.
 */
function namedSystem(file: { name?: string }, systems: readonly GameSystem[]): GameSystem | undefined {
  const match = /\.([A-Za-z0-9_-]+)$/.exec(file.name?.trim() ?? '');
  const extension = match?.[1]!.toLowerCase();
  return extension ? auroraSystems(systems).find((system) => system.id === extension) : undefined;
}

/** The system a save is for: its name's, or the user's answer when its name does not say. */
function systemFor(file: ReceivedFile, systems: readonly GameSystem[], game: string | undefined): GameSystem | undefined {
  return namedSystem(file, systems) ?? auroraSystems(systems).find((system) => system.id === game);
}

/**
 * What to ask before importing these saves. `game` is the user's answer to `choose-game`, for the files whose names do
 * not say which game they are for.
 */
export function saveImportStep(saves: readonly ReceivedFile[], context: SaveImportContext, game?: string): SaveImportStep {
  const readers = auroraSystems(context.systems);
  const unnamed = saves.filter((file) => !namedSystem(file, context.systems)).length;
  if (unnamed && game === undefined) {
    if (!readers.length) {
      return { kind: 'no-source', title: 'Not imported', message: 'This app has no game that reads Aurora saves.' };
    }
    const nameless = unnamed;
    const it = nameless === 1 ? 'it' : 'them';
    return {
      kind: 'choose-game',
      title: nameless === 1 ? 'Import this save?' : `Import ${nameless} saves?`,
      message:
        readers.length === 1
          ? `Import ${it} as ${nameless === 1 ? `a ${readers[0]!.name} character` : `${readers[0]!.name} characters`}? The file's name does not say which game ${it === 'it' ? 'it is' : 'they are'} for.`
          : `Which game ${nameless === 1 ? 'is it' : 'are they'} for? The file's name does not say.`,
      choices: readers.map((system) => ({ systemId: system.id, label: readers.length === 1 ? 'Import' : system.name })),
    };
  }

  const needed: GameSystem[] = [];
  for (const file of saves) {
    const system = systemFor(file, context.systems, game);
    if (system && !needed.includes(system)) needed.push(system);
  }
  for (const system of needed) {
    const own = context.sources.filter((source) => source.systemId === system.id);
    if (own.some((source) => source.enabled)) continue;
    if (own.length) {
      return {
        kind: 'switched-off',
        systemId: system.id,
        title: 'Importing needs content',
        message: `Every content source for ${system.name} is switched off. Switch one on in Content, then import again.`,
      };
    }
    const suggestion = (system.suggestedSources ?? []).find((suggested) => !context.sources.some((source) => source.url === suggested.url));
    if (suggestion) {
      return {
        kind: 'needs-source',
        systemId: system.id,
        suggestion,
        title: `Add ${suggestion.name}?`,
        message: `Importing needs content for ${system.name}. Add ${suggestion.name} and import? ${addSourceNote(context.connection)}`,
        confirm: 'Add and import',
      };
    }
    return {
      kind: 'no-source',
      title: 'Importing needs content',
      message: `Importing needs content for ${system.name}. Add a source in Content, then import again.`,
    };
  }
  return { kind: 'ready' };
}

/** What became of one save. `notes` are the importer's diagnostics, once each with their count. */
export type ImportedOutcome =
  | { status: 'imported'; entry: LibraryEntryRef; title: string; message: string; notes: AuroraImportDiagnostic[] }
  | { status: 'refused'; message: string; notes: AuroraImportDiagnostic[] };

export interface SaveImportDeps {
  library: CharacterLibrary;
  systems: readonly GameSystem[];
  /** A system's content, loaded: on a phone, `ContentSources.load(systemId)`'s elements. */
  load: (systemId: string) => Promise<ElementIndex>;
  /** Recorded in the manifest as what wrote the file. */
  generator?: string;
  /** Told when the import moves from loading content to importing, for the line the shell shows meanwhile. */
  onPhase?: (phase: SaveImportPhase) => void;
}

export type SaveImportPhase = 'loading' | 'importing';

/**
 * Import the saves, one after another (each write must see the one before it, so two characters of one name do not
 * collide). `game` is the user's answer for the files whose names do not say. Always one outcome per file, never a throw.
 */
export async function importReceivedSaves(deps: SaveImportDeps, saves: readonly ReceivedFile[], game?: string): Promise<ImportedOutcome[]> {
  const outcomes: ImportedOutcome[] = [];
  const loaded = new Map<string, ElementIndex>();
  for (const file of saves) {
    const system = systemFor(file, deps.systems, game);
    if (!system) {
      outcomes.push({ status: 'refused', notes: [], message: `${shown(file)} was not imported: no game was chosen for it.` });
      continue;
    }
    let elements = loaded.get(system.id);
    if (!elements) {
      deps.onPhase?.('loading');
      try {
        elements = await deps.load(system.id);
      } catch (error) {
        outcomes.push({ status: 'refused', notes: [], message: `${shown(file)} was not imported: content did not load. ${messageOf(error)}` });
        continue;
      }
      loaded.set(system.id, elements);
    }
    deps.onPhase?.('importing');
    // The importer reads the game from the name; a file whose name does not say is handed over under one ending in the
    // chosen game's.
    const name = namedSystem(file, deps.systems) ? file.name!.trim() : `${file.name?.trim() || 'save'}.${system.id}`;
    const report = await importAuroraSaveIntoLibrary(
      deps.library,
      { name, bytes: file.bytes },
      { system, elements, generator: deps.generator ?? 'incudo-mobile (aurora import)' },
    );
    if (!report.ok || !report.entry || !report.character) {
      // The importer quotes the name it was given; a provider's id is not the file's name as the user knows it.
      const message = (report.message ?? 'It did not import.').replace(`"${name}"`, shown(file));
      outcomes.push({ status: 'refused', message, notes: report.diagnostics });
      continue;
    }
    const title = report.character.name.trim() || 'Unnamed character';
    const wanted = suggestedFileName(title);
    let message = report.entry.name === wanted ? `Imported ${title}.` : `Imported ${title} as ${report.entry.name}; the library already had a file called ${wanted}.`;
    const missing = report.unresolved.length;
    if (missing) {
      message += ` ${missing === 1 ? 'One thing' : `${missing} things`} it uses ${missing === 1 ? 'is' : 'are'} not in the content loaded, so it was imported without ${missing === 1 ? 'it' : 'them'}.`;
    }
    outcomes.push({ status: 'imported', entry: report.entry, title, message, notes: report.diagnostics });
  }
  return outcomes;
}

/** The result as the shell shows it: a title, a line per save, the one to open, and the notes on request. */
export interface ImportedView {
  title: string;
  lines: string[];
  open?: { name: string; title: string };
  /** The importer's notes, once each, "(×3)" when repeated; the shell offers them behind a button. */
  notes: string[];
}

export function importedView(outcomes: readonly ImportedOutcome[]): ImportedView {
  const imported = outcomes.filter((outcome) => outcome.status === 'imported');
  const title = imported.length === outcomes.length ? 'Imported' : imported.length ? 'Some saves were not imported' : 'Not imported';
  const notes = outcomes.flatMap((outcome) => outcome.notes.map((note) => (note.count > 1 ? `${note.message} (×${note.count})` : note.message)));
  const lines = outcomes.map((outcome) => outcome.message);
  if (notes.length) lines.push(`The import noted ${notes.length === 1 ? 'one thing' : `${notes.length} things`}.`);
  const view: ImportedView = { title, lines, notes };
  const only = imported.length === 1 ? imported[0] : undefined;
  if (only && only.status === 'imported') view.open = { name: only.entry.name, title: only.title };
  return view;
}

/** The line shown over the screen while an import runs: what it is waiting on, and how far a load has come. */
export function saveImportLine(
  saves: readonly ReceivedFile[],
  phase: SaveImportPhase,
  progress?: { loaded: number; total: number },
): string {
  const what = saves.length === 1 ? shown(saves[0]!, true) : `${saves.length} saves`;
  if (phase === 'importing') return `Importing ${what}…`;
  return `Loading content to import ${what}…${progress && progress.total ? ` ${progress.loaded} of ${progress.total}` : ''}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
