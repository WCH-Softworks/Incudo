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
