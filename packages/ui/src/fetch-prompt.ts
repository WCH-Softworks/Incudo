/**
 * What a source action will download, and the question a phone on a metered connection asks first — ADR 0100.
 *
 * A source is fetched once and kept (ADR 0029), so the data a phone spends on content is spent by three actions only:
 * adding a source, refreshing one, and switching one from converted to files (the conversion kept no raw files, ADR
 * 0085). This says what each will fetch and, when the connection is metered, the words to ask with. Whether a
 * connection is metered is the platform's to read; nothing here guesses it.
 */

import { keepsConverted, type ConfiguredSource, type SourceKeep } from '@incudo/content';

/** What the platform says of the connection. `metered` absent: it could not say (no connection, no details). */
export interface ConnectionState {
  metered?: boolean;
}

/** A source action that may fetch. */
export type FetchAction =
  | { kind: 'refresh'; source: ConfiguredSource }
  | { kind: 'keep'; source: ConfiguredSource; keep: SourceKeep };

/**
 * What an action downloads: `all` of the source's files, the ones that `changed` upstream (each is asked, and only a
 * changed one comes over in full), or `none`. `files` is the source's file count from its last load, when known.
 */
export interface FetchCost {
  downloads: 'all' | 'changed' | 'none';
  files?: number;
}

export function fetchCost(action: FetchAction): FetchCost {
  const files = action.source.fileCount;
  const counted = files !== undefined ? { files } : {};
  if (action.kind === 'refresh') return { downloads: keepsConverted(action.source) ? 'all' : 'changed', ...counted };
  // Converted to files: the conversion removed the raw files, so they are all downloaded again. Files to converted reads
  // the files already kept.
  if (action.keep === 'files' && keepsConverted(action.source)) return { downloads: 'all', ...counted };
  return { downloads: 'none' };
}

/** The question to ask before an action, or undefined when there is none to ask. */
export interface FetchPrompt {
  title: string;
  message: string;
  confirm: string;
}

export const METERED_NOTE = 'This device is on a metered connection, so the download may count against a data plan.';

function filesPhrase(cost: FetchCost): string {
  return cost.files !== undefined ? `all ${cost.files} of its files` : 'all of its files';
}

/** Asked only on a metered connection, and only before an action that downloads something. */
export function fetchPrompt(action: FetchAction, connection: ConnectionState): FetchPrompt | undefined {
  const cost = fetchCost(action);
  if (cost.downloads === 'none' || connection.metered !== true) return undefined;
  const name = action.source.name;
  if (action.kind === 'refresh') {
    const what =
      cost.downloads === 'all'
        ? `Refreshing downloads ${filesPhrase(cost)} again, because it is kept converted.`
        : `Refreshing asks for each of its files${cost.files !== undefined ? ` (${cost.files})` : ''} and downloads the ones that changed.`;
    return { title: `Refresh ${name}?`, message: `${what}\n\n${METERED_NOTE}`, confirm: 'Refresh' };
  }
  return {
    title: `Keep ${name} as files?`,
    message: `Keeping it as files downloads ${filesPhrase(cost)} again, because the converted form keeps none of them.\n\n${METERED_NOTE}`,
    confirm: 'Keep as files',
  };
}

/** What adding a source says before it starts, which a phone asks on every connection. */
export function addSourceNote(connection: ConnectionState): string {
  return connection.metered === true ? `It is downloaded in full now. ${METERED_NOTE}` : 'It is downloaded in full now.';
}
