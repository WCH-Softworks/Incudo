/**
 * What Build and Browse say while content loads and after a load that left nothing (`content-loading.ts`). Each case
 * names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contentLoadFailedNote, contentLoadingView, loadProgressLine } from './content-loading.ts';

const progress = { source: 'AuroraLegacy', loaded: 158, total: 799, current: 'cleric-trickery.xml' };

test('the progress line names the source, the count and the file', () => {
  // Fails if the line drops any of the four parts the Sources pane used to write.
  assert.equal(loadProgressLine(progress), 'AuroraLegacy: 158 / 799 — cleric-trickery.xml');
});

test('a pane waiting for a load shows its progress, or that it is starting', () => {
  // Fails if a load with no progress yet reads as finished or empty.
  assert.equal(contentLoadingView('build', null).progress, 'Starting…');
  assert.equal(contentLoadingView('browse', progress).progress, loadProgressLine(progress));
  // Fails if New character's waiting dialog is not named on Build, or is named on Browse.
  assert.match(contentLoadingView('build', progress, true).note, /campaign options/);
  assert.doesNotMatch(contentLoadingView('browse', progress, true).note, /campaign options/);
});

test('a load that left nothing says why, and one that loaded something says nothing', () => {
  // Fails if a thrown load is not reported (the panes would read "no content" with no reason).
  assert.equal(contentLoadFailedNote([], 0, 'Network down.'), 'The content could not be loaded: Network down.');
  const failed = [{ name: 'AuroraLegacy', failed: 'The index could not be fetched.' }];
  // Fails if a single failed source is not named, or its full stop is doubled.
  assert.equal(
    contentLoadFailedNote(failed, 0),
    "AuroraLegacy: The index could not be fetched. Nothing else was loaded; the source's line on Sources has Refresh.",
  );
  // Fails if a failure is reported over content that did load (its own line on Sources says it).
  assert.equal(contentLoadFailedNote(failed, 12, undefined), undefined);
  assert.equal(contentLoadFailedNote([{ name: 'A' }], 0), undefined);
  assert.match(contentLoadFailedNote([...failed, { name: 'B', failed: 'Gone' }], 0) ?? '', /^None of the sources loaded/);
});
