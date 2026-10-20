/**
 * The add-item list's slide (ADR 0117) moves its track by a transform inside a box that clips it, and nothing may scroll
 * that box as well.
 *
 * Opening a group focused its search box while the panel was still sliding in. A focus scrolls whatever clips the
 * element into view, so the box was scrolled a panel's width sideways on top of the transform: the list was left off to
 * the left with a blank box in its place, and the page scrolled down with it. Found driving the Tauri window on
 * 2026-10-20; the earlier drives had focused after the slide had ended.
 *
 * Perturbation: drop `{ preventScroll: true }` from either focus in `apps/desktop/src/panes/InventoryEditor.tsx`, or the
 * `.offer-groups` box's scroll reset, and this fails.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const file = join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop', 'src', 'panes', 'InventoryEditor.tsx');

test('the add-item slide focuses without scrolling, and its clipping box is never left scrolled', () => {
  const code = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('//'));
  const focuses = code.filter((line) => /\.focus\(/.test(line));
  assert.ok(focuses.length >= 2, 'the slide focuses its search box and, going back, the group');
  for (const line of focuses) assert.match(line, /\.focus\(\{ preventScroll: true \}\)/, line.trim());
  const box = code.find((line) => line.includes('className="offer-groups"'));
  assert.ok(box, 'the clipping box');
  assert.match(box!, /onScroll=\{\(event\) => \{ event\.currentTarget\.scrollLeft = 0; \}\}/);
});
