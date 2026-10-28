/**
 * What a source action will download, and the question a phone on a metered connection asks first — ADR 0100.
 *
 * A source is converted once and kept as a file (ADR 0119), so the data a phone spends on content is spent by two
 * actions only: adding a source and refreshing one, and since no other copy is kept (ADR 0119 decision 10) each
 * downloads every file. This says what each will fetch and, when the connection is metered, the words to ask with.
 * Whether a connection is metered is the platform's to read; nothing here guesses it.
 */

import type { ConfiguredSource } from '@incudo/content';

/** What the platform says of the connection. `metered` absent: it could not say (no connection, no details). */
export interface ConnectionState {
  metered?: boolean;
}

/** A source action that may fetch. */
export type FetchAction = { kind: 'refresh'; source: ConfiguredSource };

/** What an action downloads: `all` of the source's files. `files` is the source's file count from its last load, when known. */
export interface FetchCost {
  downloads: 'all' | 'none';
  files?: number;
}

export function fetchCost(action: FetchAction): FetchCost {
  const files = action.source.fileCount;
  // A file the user added, or a homebrew source, has nothing upstream to download.
  if (action.source.kind !== undefined) return { downloads: 'none' };
  return { downloads: 'all', ...(files !== undefined ? { files } : {}) };
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
  return {
    title: `Refresh ${action.source.name}?`,
    message: `Refreshing downloads ${filesPhrase(cost)} again.\n\n${METERED_NOTE}`,
    confirm: 'Refresh',
  };
}

/** What adding a source says before it starts, which a phone asks on every connection. */
export function addSourceNote(connection: ConnectionState): string {
  return connection.metered === true ? `It is downloaded in full now. ${METERED_NOTE}` : 'It is downloaded in full now.';
}
