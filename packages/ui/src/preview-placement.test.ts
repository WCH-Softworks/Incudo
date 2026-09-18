import { test } from 'node:test';
import assert from 'node:assert/strict';

import { placePreview, type PreviewRect } from './preview-placement.ts';

const viewport = { width: 1400, height: 900 };
const panel = { width: 440, height: 300 };

function row(left: number, top: number, width = 300, height = 30): PreviewRect {
  return { left, top, right: left + width, bottom: top + height };
}

test('opens to the right of the row when there is room', () => {
  const placed = placePreview({ anchor: row(400, 200), viewport, panel });
  assert.deepEqual(placed, { left: 708, top: 200, side: 'right' });
});

test('opens to the left when the right side is too narrow', () => {
  const placed = placePreview({ anchor: row(1000, 200), viewport, panel });
  assert.equal(placed.side, 'left');
  assert.equal(placed.left, 1000 - 8 - 440);
});

test('stacks below the row when neither side fits', () => {
  const narrow = { width: 700, height: 900 };
  const placed = placePreview({ anchor: row(150, 200, 400), viewport: narrow, panel });
  assert.equal(placed.side, 'below');
  assert.equal(placed.top, 200 + 30 + 8);
});

test('stacks above the row when neither side fits and there is no room below', () => {
  const narrow = { width: 700, height: 900 };
  const placed = placePreview({ anchor: row(150, 800, 400), viewport: narrow, panel });
  assert.equal(placed.side, 'above');
  assert.equal(placed.top, 800 - 8 - 300);
});

test('a row near the bottom pulls a side panel up so it stays on screen', () => {
  const placed = placePreview({ anchor: row(400, 850), viewport, panel });
  assert.equal(placed.side, 'right');
  assert.equal(placed.top, 900 - 8 - 300);
});

test('the panel never leaves the window, whatever the row', () => {
  for (const left of [0, 200, 700, 1100, 1390]) {
    for (const top of [0, 300, 880]) {
      const placed = placePreview({ anchor: row(left, top, 100), viewport, panel });
      assert.ok(placed.left >= 8, `left ${placed.left} for row at ${left},${top}`);
      assert.ok(placed.top >= 8, `top ${placed.top} for row at ${left},${top}`);
      assert.ok(placed.left + panel.width <= viewport.width - 8);
      assert.ok(placed.top + panel.height <= viewport.height - 8);
    }
  }
});

test('a window smaller than the panel still returns a position, on screen at the margin', () => {
  const tiny = { width: 300, height: 200 };
  const placed = placePreview({ anchor: row(20, 100, 200), viewport: tiny, panel });
  assert.equal(placed.side, 'over');
  assert.equal(placed.left, 8);
  assert.equal(placed.top, 8);
});
