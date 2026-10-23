/**
 * The words a pane shows in place of its content while the system's sources load, and after a load that left nothing.
 *
 * Build and Browse are not usable while a load runs (a first download can take a minute): what they would offer is
 * whatever was loaded before, or nothing, and a character built from that is built from the wrong list. The Sources pane
 * shows the same progress line, so it is worded once here.
 */

/** How far a load has got, as `loadSources` reports it. The same shape as `@incudo/content`'s `LoadProgress`. */
export interface ContentLoadProgress {
  readonly loaded: number;
  readonly total: number;
  readonly current: string;
  readonly source: string;
}

/** "AuroraLegacy: 158 / 799 — cleric-trickery.xml". */
export function loadProgressLine(progress: ContentLoadProgress): string {
  return `${progress.source}: ${progress.loaded} / ${progress.total} — ${progress.current}`;
}

export type ContentLoadingPane = 'build' | 'browse';

export interface ContentLoadingView {
  readonly heading: string;
  /** The progress line, or a sentence while the load has not reported any yet. */
  readonly progress: string;
  /** Why the pane waits, and what opens when it is done. */
  readonly note: string;
}

const NOTES: Record<ContentLoadingPane, string> = {
  build: 'Build opens when the content has loaded, so that everything it offers comes from it.',
  browse: 'Browse opens when the content has loaded.',
};

export function contentLoadingView(
  pane: ContentLoadingPane,
  progress: ContentLoadProgress | null,
  startOptionsWaiting = false,
): ContentLoadingView {
  return {
    heading: 'Loading content',
    progress: progress ? loadProgressLine(progress) : 'Starting…',
    note:
      pane === 'build' && startOptionsWaiting
        ? 'The campaign options for the new character open when the content has loaded.'
        : NOTES[pane],
  };
}

/** How long a load may go without a file arriving before the panel says it has stalled, in seconds. */
export const LOAD_STALL_SECONDS = 20;

/**
 * Said under the progress when nothing has arrived for a while, so a slow or dead connection does not read as working.
 * Undefined until `LOAD_STALL_SECONDS` have passed. A file that never arrives is given up by the fetcher (the desktop's
 * gives each request two minutes), and the source's line on Sources then names it.
 */
export function contentLoadStallNote(secondsSinceProgress: number): string | undefined {
  if (secondsSinceProgress < LOAD_STALL_SECONDS) return undefined;
  const seconds = Math.floor(secondsSinceProgress);
  const wait = seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} seconds`;
  return (
    `Nothing has arrived for ${wait}. The connection may be slow or down. ` +
    'A file that does not arrive is given up, and the source then says so on Sources.'
  );
}

/** What Build and Browse show in place of their content when the last load ended and left nothing loaded. */
export function contentLoadFailedView(note: string | undefined): ContentLoadingView {
  return {
    heading: 'Content did not load',
    progress: note ?? 'Nothing was loaded from the sources switched on.',
    note: 'Sources has each source’s line, with Refresh. Build and Browse open once content has loaded.',
  };
}

/** A source that did not load, as `LoadedContent.sources` names it. */
export interface FailedLoad {
  readonly name: string;
  readonly failed?: string | undefined;
}

/**
 * What a pane says when the last load ended with nothing loaded because something failed: the load itself (`thrown`) or
 * every source in it. Undefined when nothing failed, or when something loaded anyway (the Sources pane names a single
 * failed source on its own line).
 */
export function contentLoadFailedNote(
  sources: readonly FailedLoad[],
  elementCount: number,
  thrown?: string,
): string | undefined {
  if (thrown !== undefined) return `The content could not be loaded: ${withoutStop(thrown)}.`;
  if (elementCount > 0) return undefined;
  const failed = sources.filter((source) => source.failed !== undefined);
  if (failed.length === 0) return undefined;
  const lines = failed.map((source) => `${source.name}: ${withoutStop(source.failed ?? '')}`);
  return failed.length === 1
    ? `${lines[0]}. Nothing else was loaded; the source's line on Sources has Refresh.`
    : `None of the sources loaded. ${lines.join('. ')}.`;
}

/** An error message is quoted inside a sentence of its own, so its own full stop goes. */
function withoutStop(message: string): string {
  return message.trim().replace(/\.+$/, '');
}
