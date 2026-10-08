/**
 * What a launcher card says about an overlay — ADR 0102 decision 3. Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GameSystem, OverlayChange } from '@incudo/core';

import { overlayChangeLine, overlayView, sharedSourceNote } from './system-overlay-view.ts';

const parent = { id: 'base', name: 'Base Game' } as GameSystem;
const house = { id: 'house', name: 'Our Table', extends: 'base' } as GameSystem;
const pc = { field: 'characterKinds', entry: 'pc', label: 'Player Character' };

const line = (change: OverlayChange): string => overlayChangeLine(change, 'Base Game');

// Perturbation: naming an entry by its identity when it has a label ("Adds the stat sanity").
test('an added, removed or absent entry is named by its label, and where it is', () => {
  assert.equal(line({ action: 'added', path: [{ field: 'stats', entry: 'sanity', label: 'Sanity' }] }), 'Adds the stat Sanity');
  assert.equal(
    line({ action: 'removed', path: [pc, { field: 'buildSteps', entry: 'feats', label: 'Feats' }] }),
    'Removes the build step Feats from Player Character',
  );
  assert.equal(
    line({ action: 'added', path: [pc, { field: 'buildSteps', entry: 'boons' }] }),
    'Adds the build step boons to Player Character',
  );
  assert.equal(
    line({ action: 'absent', path: [pc, { field: 'buildSteps', entry: 'gone' }] }),
    'Would remove the build step gone from Player Character, which Base Game no longer has',
  );
});

// Perturbation: writing the format's field names ("buildSteps", "characterKinds") on screen.
test('a changed field is named in words, with the entry it belongs to', () => {
  assert.equal(line({ action: 'changed', path: [pc, { field: 'progression' }] }), 'Changes the progression of the character kind Player Character');
  assert.equal(line({ action: 'changed', path: [{ field: 'currency' }] }), 'Changes the money');
  assert.equal(
    line({ action: 'changed', path: [pc, { field: 'buildSteps', entry: 'feats', label: 'Feats' }, { field: 'required' }] }),
    'Changes the required of the build step Feats (Player Character)',
  );
  assert.equal(line({ action: 'changed', path: [{ field: 'candidateNotes' }] }), 'Changes the candidate notes');
  assert.equal(line({ action: 'removed', path: [pc, { field: 'description' }] }), 'Removes the description of the character kind Player Character');
});

// Perturbation: an empty list with nothing said (a card that changes nothing reads as if its changes failed to show).
test('an overlay that changes nothing says so', () => {
  assert.deepEqual(overlayView(house, { parent, changes: [] }), {
    builtOn: 'Built on Base Game.',
    changes: [],
    none: 'Our Table is the same as Base Game as it is today.',
  });
});

test('every line is plain: no path, no id the user did not write, no ADR', () => {
  const view = overlayView(house, {
    parent,
    changes: [
      { action: 'added', path: [{ field: 'stats', entry: 'sanity', label: 'Sanity' }] },
      { action: 'changed', path: [pc, { field: 'sheet' }] },
    ],
  });
  for (const text of [view.builtOn, ...view.changes, sharedSourceNote('Base Game')]) {
    assert.doesNotMatch(text, /\[|\]|characterKinds|ADR|\{/);
  }
  assert.deepEqual(view.changes, ['Adds the stat Sanity', 'Changes the sheet of the character kind Player Character']);
});
