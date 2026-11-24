/**
 * The app updating itself — ADR 0133. What the update dialog says, what the Settings section says, and the one
 * remembered preference, under `node --test`; the shell holds an {@link UpdateStatus} and draws {@link updateDialog}.
 *
 * Three rules, each easy to undo by accident:
 *
 *  - **Nothing is downloaded or installed unasked.** A check only reads which version is published. The dialog offers
 *    the download and the install as one button, and "Not now" leaves the app exactly as it was.
 *  - **A check made at start says nothing unless there is something to say.** No connection, a server that is down, or
 *    being on the newest version are silent then; a person who asked (the menu's "Check for updates…", the Settings
 *    button) is told each of them.
 *  - **The release notes are a link to the release page, never text carried in the update.** The page is where the
 *    maintainer writes them, after the installers are built; anything the build wrote into the update would be older.
 *
 * Nothing here knows a game, a window or the updater plugin: the port is core's `AppUpdater`.
 */

import type { AppUpdater, FoundUpdate, Storage, UpdateProgress } from '@incudo/core';

/** Where the release notes of a version are read. The address the opener capability allows for it. */
export const RELEASES_URL = 'https://github.com/WCH-Softworks/Incudo/releases';

/**
 * What the window's opener capability allows for the release notes: any release's page and nothing else in the
 * repository. `support-links.test.ts` holds the capability to this and the About links.
 */
export const RELEASE_NOTES_URL_PATTERN = `${RELEASES_URL}/tag/*`;

export function releaseNotesUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`;
}

// --- state ------------------------------------------------------------------------------------------------------------

/**
 * Where an update stands. `manual` is whether a person asked: it decides what is worth saying (the second rule above).
 * `idle` draws nothing, which is also where a silent start check ends.
 */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking'; manual: boolean }
  | { kind: 'current' }
  | { kind: 'found'; update: FoundUpdate }
  | { kind: 'installing'; update: FoundUpdate; progress?: UpdateProgress }
  | { kind: 'failed'; stage: 'check' | 'install'; message: string; update?: FoundUpdate };

export const UPDATE_IDLE: UpdateStatus = { kind: 'idle' };

/** A check or an install is running: a second one is not started, and the command is greyed. */
export function updateBusy(status: UpdateStatus): boolean {
  return status.kind === 'checking' || status.kind === 'installing';
}

/** The error's own words, or a sentence when it has none. */
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return text.trim() || 'No reason was given.';
}

/**
 * Ask which version is published. Never throws: a failure is a status. A start check (`manual` false) that finds
 * nothing new or cannot reach the address ends `idle`, so nothing is drawn; the failure is handed to `onQuietFailure`
 * for a log line.
 */
export async function checkForUpdate(
  updater: AppUpdater,
  manual: boolean,
  onQuietFailure?: (error: unknown) => void,
): Promise<UpdateStatus> {
  if (!updater.available) {
    return manual ? { kind: 'failed', stage: 'check', message: updater.unavailableReason ?? 'This build cannot update itself.' } : UPDATE_IDLE;
  }
  try {
    const update = await updater.check();
    if (update) return { kind: 'found', update };
    return manual ? { kind: 'current' } : UPDATE_IDLE;
  } catch (error) {
    if (manual) return { kind: 'failed', stage: 'check', message: messageOf(error) };
    onQuietFailure?.(error);
    return UPDATE_IDLE;
  }
}

/**
 * Download, verify and install the update the user accepted, reporting each step through `onStatus`. Resolves with the
 * status to show when it returns at all: on Windows the installer closes the app, and elsewhere the app is opened again,
 * so a return means something went wrong, and the version running is unchanged.
 */
export async function installUpdate(
  updater: AppUpdater,
  update: FoundUpdate,
  onStatus: (status: UpdateStatus) => void,
): Promise<UpdateStatus> {
  onStatus({ kind: 'installing', update });
  try {
    await updater.install((progress) => onStatus({ kind: 'installing', update, progress }));
    // Reached only where the platform neither closed nor reopened the app. Say so rather than leave the bar at 100%.
    return { kind: 'failed', stage: 'install', update, message: 'The update was installed, but Incudo could not open again. Close it and open it yourself.' };
  } catch (error) {
    return { kind: 'failed', stage: 'install', update, message: messageOf(error) };
  }
}

// --- the dialog -------------------------------------------------------------------------------------------------------

export type UpdateAction = 'install' | 'later' | 'retry-check' | 'retry-install' | 'close';

export interface UpdateButton {
  action: UpdateAction;
  label: string;
}

/** What the dialog shows. `buttons[0]` is the one to press; none while a check or an install runs. */
export interface UpdateDialogView {
  title: string;
  lede: string;
  /** Further sentences, each its own paragraph. */
  notes: string[];
  /** "What is new in 1.1.0", to the release page. */
  link?: { label: string; url: string };
  /** Shown while downloading: "Downloaded 12.4 of 40.0 MB". */
  progress?: { text: string; fraction?: number };
  buttons: UpdateButton[];
}

/** Megabytes with one decimal, the unit a person reads an installer's size in. */
function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

export function progressText(progress: UpdateProgress | undefined): { text: string; fraction?: number } {
  if (!progress || progress.downloaded === 0) return { text: 'Starting the download…' };
  if (progress.total && progress.total > 0) {
    const fraction = Math.min(1, progress.downloaded / progress.total);
    if (fraction >= 1) return { text: 'Downloaded. Installing…', fraction: 1 };
    return { text: `Downloaded ${megabytes(progress.downloaded)} of ${megabytes(progress.total)} MB`, fraction };
  }
  return { text: `Downloaded ${megabytes(progress.downloaded)} MB` };
}

/** The dialog for `status`, or null when nothing is to be shown (idle, and a check nobody asked for while it runs). */
export function updateDialog(status: UpdateStatus, currentVersion: string): UpdateDialogView | null {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'checking':
      return status.manual
        ? // No button: a check ends by itself, within half a minute when the address does not answer.
          { title: 'Checking for updates', lede: 'Looking for a newer version of Incudo…', notes: [], buttons: [] }
        : null;
    case 'current':
      return {
        title: 'Incudo is up to date',
        lede: `Version ${currentVersion} is the newest published version.`,
        notes: [],
        buttons: [{ action: 'close', label: 'Close' }],
      };
    case 'found':
      return {
        title: `Incudo ${status.update.version} is available`,
        lede: `You have version ${currentVersion}. Download and install the new version now?`,
        notes: [
          'Incudo closes to install it and opens again when it is done.',
          'A character you have not saved to your library is kept as it is, and is there when Incudo opens again.',
        ],
        link: { label: `What is new in ${status.update.version}`, url: releaseNotesUrl(status.update.version) },
        buttons: [
          { action: 'install', label: 'Download and install' },
          { action: 'later', label: 'Not now' },
        ],
      };
    case 'installing':
      return {
        title: `Installing Incudo ${status.update.version}`,
        lede: 'Incudo will close and open again when the update is installed.',
        notes: [],
        progress: progressText(status.progress),
        buttons: [],
      };
    case 'failed':
      return status.stage === 'check'
        ? {
            title: 'Could not check for updates',
            lede: status.message,
            notes: ['Incudo looks for updates on github.com. Check the connection and try again.'],
            buttons: [
              { action: 'retry-check', label: 'Try again' },
              { action: 'close', label: 'Close' },
            ],
          }
        : {
            title: 'The update was not installed',
            lede: status.message,
            notes: [`Incudo ${currentVersion} is unchanged.`],
            link: status.update ? { label: `What is new in ${status.update.version}`, url: releaseNotesUrl(status.update.version) } : undefined,
            buttons: [
              { action: 'retry-install', label: 'Try again' },
              { action: 'close', label: 'Close' },
            ],
          };
  }
}

// --- the preference ---------------------------------------------------------------------------------------------------

/** Remembered per user in `Storage`, never in a character, as the print options and the Build preferences are. */
export interface UpdatePreferences {
  /** Look for a newer version each time Incudo starts. On by default; a check downloads nothing. */
  checkOnStart: boolean;
}

export const DEFAULT_UPDATE_PREFERENCES: UpdatePreferences = { checkOnStart: true };

export const UPDATE_PREFERENCES_KEY = 'app/updates';

/** A record that cannot be read, or a field that is not a boolean, falls back to the default. */
export function parseUpdatePreferences(text: string | null): UpdatePreferences {
  let record: Record<string, unknown> = {};
  try {
    const value: unknown = text === null ? null : JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) record = value as Record<string, unknown>;
  } catch {
    // Unreadable: the defaults.
  }
  return {
    checkOnStart: typeof record.checkOnStart === 'boolean' ? record.checkOnStart : DEFAULT_UPDATE_PREFERENCES.checkOnStart,
  };
}

export async function readUpdatePreferences(storage: Storage): Promise<UpdatePreferences> {
  return parseUpdatePreferences(await storage.read(UPDATE_PREFERENCES_KEY));
}

export async function writeUpdatePreferences(storage: Storage, preferences: UpdatePreferences): Promise<void> {
  await storage.write(UPDATE_PREFERENCES_KEY, JSON.stringify(preferences));
}

// --- Settings -----------------------------------------------------------------------------------------------------------

export const UPDATES_HEADING = 'Updates';
export const CHECK_ON_START_LABEL = 'Check for updates when Incudo starts';
export const CHECK_NOW_LABEL = 'Check now';
export const UPDATES_HINT =
  'A check asks github.com which version of Incudo is the newest published one. It sends nothing about your ' +
  'characters, and Incudo asks before it downloads or installs anything.';
