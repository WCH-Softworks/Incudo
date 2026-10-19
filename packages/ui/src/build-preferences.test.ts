/** The Build pane's remembered view (ADR 0115): read field by field, defaults where a field is missing or wrong. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Storage } from '@incudo/core';
import {
  BUILD_PREFERENCES_KEY,
  advancedOptionsHint,
  DEFAULT_BUILD_PREFERENCES,
  parseBuildPreferences,
  readBuildPreferences,
  writeBuildPreferences,
} from './build-preferences.ts';

function memory(): Storage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    read: async (key) => values.get(key) ?? null,
    write: async (key, value) => void values.set(key, value),
    remove: async (key) => void values.delete(key),
    list: async (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)),
  };
}

test('nothing stored, or nothing readable, is the defaults: advanced options off', () => {
  // Fails if the default offers advanced steps, or if a broken record throws.
  assert.deepEqual(parseBuildPreferences(null), DEFAULT_BUILD_PREFERENCES);
  assert.equal(DEFAULT_BUILD_PREFERENCES.showAdvanced, false);
  // The optional decisions start folded (ADR 0123).
  assert.equal(DEFAULT_BUILD_PREFERENCES.optionalOpen, false);
  assert.deepEqual(parseBuildPreferences('{not json'), DEFAULT_BUILD_PREFERENCES);
  assert.deepEqual(parseBuildPreferences('[true]'), DEFAULT_BUILD_PREFERENCES);
});

test('each field falls back on its own', () => {
  // Fails if one wrong field throws the others away, or a tab nothing declares is kept.
  assert.deepEqual(parseBuildPreferences('{"showAdvanced":true,"previewCollapsed":"yes","tab":"elsewhere"}'), {
    ...DEFAULT_BUILD_PREFERENCES,
    showAdvanced: true,
  });
});

test('what is written is read back, under its own key', async () => {
  const storage = memory();
  // Fails if the optional decisions' fold is not written or not read back (ADR 0123).
  const chosen = { showAdvanced: true, previewCollapsed: true, tab: 'details' as const, optionalOpen: true };
  await writeBuildPreferences(storage, chosen);
  assert.deepEqual([...storage.values.keys()], [BUILD_PREFERENCES_KEY]);
  assert.deepEqual(await readBuildPreferences(storage), chosen);
});

test('storage that fails to read or write changes nothing for the pane', async () => {
  const broken: Storage = {
    read: async () => { throw new Error('locked'); },
    write: async () => { throw new Error('locked'); },
    remove: async () => {},
    list: async () => [],
  };
  assert.deepEqual(await readBuildPreferences(broken), DEFAULT_BUILD_PREFERENCES);
  await writeBuildPreferences(broken, DEFAULT_BUILD_PREFERENCES);
});

test('the switch names what it leaves out, by the steps\' own labels', () => {
  assert.equal(
    advancedOptionsHint(['Additional features', 'Ability score adjustments']),
    'Additional features and Ability score adjustments are offered only when this is on: things a table may grant beyond the usual rules. Anything already taken from them still shows.',
  );
  assert.equal(
    advancedOptionsHint(['Boons']),
    'Boons is offered only when this is on: things a table may grant beyond the usual rules. Anything already taken from it still shows.',
  );
});
