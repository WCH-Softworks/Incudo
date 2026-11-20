/**
 * The phone's sheet keeps a section's explanation behind an "i", as the desktop's does (ADR 0126 decision 2). Found on
 * the emulator (docs/release-checks/mobile-v1.0.0-rc.1.md): printed under every heading, the explanations were most of
 * the sheet. A React Native screen has no test renderer here, so this reads the file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../../apps/mobile/src/SheetView.tsx', import.meta.url), 'utf8');

test('a sheet section’s explanation is shown only once its "i" is opened', () => {
  // Perturbation: draw `section.description` beside the heading again, or drop the `open` gate, and this fails.
  assert.doesNotMatch(source, /<Muted text=\{section\.description\}/);
  assert.match(source, /<SectionHead label=\{section\.label\} description=\{section\.description\}/);
  assert.match(source, /\{open \? <Muted text=\{description\}/);
  assert.match(source, /accessibilityLabel=\{`About \$\{label\}`\}/);
});

test('the level control before a class names no other class, in either app', () => {
  // Perturbation: write "Further levels can then go to other classes" back into either shell, or into the shared line;
  // it is false of a character with multiclassing switched off (found on the phone emulator).
  const shells = ['../../../apps/mobile/src/BuildParts.tsx', '../../../apps/desktop/src/panes/ClassLevels.tsx'].map((path) =>
    readFileSync(new URL(path, import.meta.url), 'utf8'),
  );
  const shared = readFileSync(new URL('../../../packages/ui/src/build-view.ts', import.meta.url), 'utf8');
  for (const shell of shells) {
    assert.match(shell, /\{LEVEL_NO_CLASS_HINT\}/);
    assert.doesNotMatch(shell, /Further levels can then go/);
  }
  assert.match(shared, /export const LEVEL_NO_CLASS_HINT = 'Choose a class in Open decisions\.';/);
});

test('the phone tells its library the profile, so a Save records the sources a character draws on', () => {
  // Perturbation: drop the call and every phone save records `"sources": []` again (found on the emulator).
  const app = readFileSync(new URL('../../../apps/mobile/src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /keepLibraryProfile\(platform\.sources, platform\.library\)/);
});
