/**
 * The update dialog's words and states — ADR 0133. Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '@incudo/core';
import type { AppUpdater, FoundUpdate, UpdateProgress } from '@incudo/core';

import {
  DEFAULT_UPDATE_PREFERENCES,
  UPDATE_IDLE,
  UPDATE_PREFERENCES_KEY,
  CHECK_FAILED,
  checkForUpdate,
  installUpdate,
  parseUpdatePreferences,
  progressText,
  readUpdatePreferences,
  releaseNotesUrl,
  updateBusy,
  updateDialog,
  writeUpdatePreferences,
  type UpdateStatus,
} from './app-update.ts';

const NEWER: FoundUpdate = { version: '1.1.0', date: '2026-12-01T00:00:00Z' };

class FakeUpdater implements AppUpdater {
  available = true;
  unavailableReason?: string;
  found: FoundUpdate | null = NEWER;
  checkError?: Error;
  installError?: Error;
  checks = 0;
  installs = 0;
  steps: UpdateProgress[] = [];

  async check(): Promise<FoundUpdate | null> {
    this.checks++;
    if (this.checkError) throw this.checkError;
    return this.found;
  }

  async install(onProgress?: (progress: UpdateProgress) => void): Promise<void> {
    this.installs++;
    for (const step of this.steps) onProgress?.(step);
    if (this.installError) throw this.installError;
  }
}

test('a check that finds a newer version offers it, and downloads nothing', async () => {
  // Fails if a check installs, or if a found update is not offered.
  const updater = new FakeUpdater();
  for (const manual of [true, false]) {
    assert.deepEqual(await checkForUpdate(updater, manual), { kind: 'found', update: NEWER });
  }
  assert.equal(updater.installs, 0);
  const view = updateDialog({ kind: 'found', update: NEWER }, '1.0.1')!;
  assert.equal(view.title, 'Incudo 1.1.0 is available');
  assert.equal(view.lede, 'You have version 1.0.1. Download and install the new version now?');
  assert.deepEqual(view.buttons.map((button) => button.action), ['install', 'later']);
  assert.deepEqual(view.link, { label: 'What is new in 1.1.0', url: 'https://github.com/WCH-Softworks/Incudo/releases/tag/v1.1.0' });
});

test('a check made at start says nothing when there is nothing new or it cannot reach the address', async () => {
  // Fails if a start check shows "up to date", or nags someone offline with an error.
  const updater = new FakeUpdater();
  updater.found = null;
  assert.deepEqual(await checkForUpdate(updater, false), UPDATE_IDLE);
  updater.checkError = new Error('offline');
  const quiet: unknown[] = [];
  assert.deepEqual(await checkForUpdate(updater, false, (error) => quiet.push(error)), UPDATE_IDLE);
  assert.equal(quiet.length, 1, 'the failure reaches the log');
  assert.equal(updateDialog({ kind: 'checking', manual: false }, '1.0.0'), null);
});

test('a check someone asked for says each answer: checking, up to date, or why it failed', async () => {
  // Fails if a manual check is as silent as a start check.
  const updater = new FakeUpdater();
  updater.found = null;
  assert.deepEqual(await checkForUpdate(updater, true), { kind: 'current' });
  assert.equal(updateDialog({ kind: 'current' }, '1.0.0')!.lede, 'Version 1.0.0 is the newest published version.');
  assert.equal(updateDialog({ kind: 'checking', manual: true }, '1.0.0')!.title, 'Checking for updates');
  updater.checkError = new Error('error sending request for url (https://github.com/…)');
  const logged: unknown[] = [];
  const failed = await checkForUpdate(updater, true, (error) => logged.push(error));
  // The updater's own words go to the log, never on screen.
  assert.deepEqual(failed, { kind: 'failed', stage: 'check', message: CHECK_FAILED });
  assert.equal(logged.length, 1);
  const view = updateDialog(failed, '1.0.0')!;
  assert.equal(view.title, 'Could not check for updates');
  assert.deepEqual(view.buttons.map((button) => button.action), ['retry-check', 'close']);
});

test('a shell with no updater never checks, and says why only when asked', async () => {
  // Fails if the browser build reaches for the updater, or shows a dialog unasked.
  const updater = new FakeUpdater();
  updater.available = false;
  updater.unavailableReason = 'This build does not update itself.';
  assert.deepEqual(await checkForUpdate(updater, false), UPDATE_IDLE);
  assert.deepEqual(await checkForUpdate(updater, true), { kind: 'failed', stage: 'check', message: 'This build does not update itself.' });
  assert.equal(updater.checks, 0);
});

test('an install reports its download, and one that fails leaves the version as it was and offers it again', async () => {
  // Fails if progress is not passed on, or a failed install reads as installed.
  const updater = new FakeUpdater();
  updater.steps = [{ downloaded: 0, total: 40_000_000 }, { downloaded: 12_400_000, total: 40_000_000 }];
  updater.installError = new Error('The signature did not match.');
  const seen: UpdateStatus[] = [];
  const end = await installUpdate(updater, NEWER, (status) => seen.push(status));
  assert.deepEqual(seen.map((status) => status.kind), ['installing', 'installing', 'installing']);
  assert.equal(updateDialog(seen[2]!, '1.0.0')!.progress!.text, 'Downloaded 12.4 of 40.0 MB');
  assert.deepEqual(updateDialog(seen[2]!, '1.0.0')!.buttons, [], 'an install cannot be stopped halfway');
  assert.deepEqual(end, { kind: 'failed', stage: 'install', update: NEWER, message: 'The signature did not match.' });
  const view = updateDialog(end, '1.0.0')!;
  assert.equal(view.title, 'The update was not installed');
  assert.deepEqual(view.notes, ['Incudo 1.0.0 is unchanged.']);
  assert.deepEqual(view.buttons.map((button) => button.action), ['retry-install', 'close']);
});

test('an install that returns without the app closing or reopening says so', async () => {
  // Fails if a returning install is taken for success, which would leave the dialog at "installing" for ever.
  const end = await installUpdate(new FakeUpdater(), NEWER, () => {});
  assert.equal(end.kind, 'failed');
  assert.match((end as { message: string }).message, /could not open again/);
});

test('progress reads in megabytes, and a download of unknown size reads what has arrived', () => {
  assert.deepEqual(progressText(undefined), { text: 'Starting the download…' });
  assert.deepEqual(progressText({ downloaded: 5_000_000 }), { text: 'Downloaded 5.0 MB' });
  assert.deepEqual(progressText({ downloaded: 40_000_000, total: 40_000_000 }), { text: 'Downloaded. Installing…', fraction: 1 });
  assert.equal(progressText({ downloaded: 10_000_000, total: 40_000_000 }).fraction, 0.25);
});

test('a check or an install in flight is busy, and nothing else is', () => {
  // Fails if the command can start a second check over a running one.
  assert.equal(updateBusy({ kind: 'checking', manual: false }), true);
  assert.equal(updateBusy({ kind: 'installing', update: NEWER }), true);
  for (const status of [UPDATE_IDLE, { kind: 'current' }, { kind: 'found', update: NEWER }] as UpdateStatus[]) {
    assert.equal(updateBusy(status), false, status.kind);
  }
  assert.equal(updateDialog(UPDATE_IDLE, '1.0.0'), null);
});

test('the start check is on unless the user turned it off, and a broken record falls back', async () => {
  // Fails if the default flips, if a non-boolean is trusted, or if the record is kept in the wrong key.
  assert.deepEqual(DEFAULT_UPDATE_PREFERENCES, { checkOnStart: true });
  assert.deepEqual(parseUpdatePreferences(null), { checkOnStart: true });
  assert.deepEqual(parseUpdatePreferences('{nope'), { checkOnStart: true });
  assert.deepEqual(parseUpdatePreferences('{"checkOnStart":"no"}'), { checkOnStart: true });
  const storage = new MemoryStorage();
  await writeUpdatePreferences(storage, { checkOnStart: false });
  assert.equal(await storage.read(UPDATE_PREFERENCES_KEY), '{"checkOnStart":false}');
  assert.deepEqual(await readUpdatePreferences(storage), { checkOnStart: false });
});

test('no word on screen names an ADR, and the notes link is the release page of that version', () => {
  // Fails if a dialog cites an ADR (the house rule for screen text) or links somewhere the opener does not allow.
  const statuses: UpdateStatus[] = [
    { kind: 'checking', manual: true },
    { kind: 'current' },
    { kind: 'found', update: NEWER },
    { kind: 'installing', update: NEWER, progress: { downloaded: 1, total: 2 } },
    { kind: 'failed', stage: 'check', message: 'x' },
    { kind: 'failed', stage: 'install', message: 'x', update: NEWER },
  ];
  for (const status of statuses) {
    const view = updateDialog(status, '1.0.0')!;
    assert.doesNotMatch(JSON.stringify(view), /ADR|\d{4}-/, status.kind);
  }
  assert.equal(releaseNotesUrl('2.0.0'), 'https://github.com/WCH-Softworks/Incudo/releases/tag/v2.0.0');
});
