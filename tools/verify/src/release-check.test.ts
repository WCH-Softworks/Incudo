/**
 * The written release check, docs/RELEASE-CHECK.md: its steps, who checks each, and the readings its drive holds a
 * candidate to, read the way the drive reads them.
 *
 * The drive itself is not a test of the code and is not here: it needs an installed candidate, which no runner has and
 * which names a folder on one machine. `npm run release:drive -- <its incudo-desktop.exe>` runs it
 * (`release-drive/drive.ts`), as the written check says.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exportedRows, readReleaseCheck } from './release-drive/check-doc.ts';

test('the written release check names its steps, who checks each, and the readings the drive holds it to', () => {
  const doc = readReleaseCheck();
  const titles = doc.steps.map((step) => step.title.toLowerCase());
  // The shape ROADMAP Phase 9 gives the check, in its order.
  const wanted = ['install', 'first launch', 'choose a system', 'suggested source', 'build', 'save', 'export', 'print',
    'reopen', 'import', 'browse', 'menus', 'switching system', 'uninstall'];
  let at = -1;
  for (const word of wanted) {
    const found = titles.findIndex((title, index) => index > at && title.includes(word));
    assert.ok(found > at, `the written check has no step about "${word}" after step ${at + 1}`);
    at = found;
  }
  assert.deepEqual(doc.steps.map((step) => step.number), doc.steps.map((_, index) => index + 1), 'steps are numbered 1, 2, 3…');
  for (const step of ['install', 'uninstall']) {
    assert.equal(doc.steps.find((s) => s.title.toLowerCase() === step)?.by, 'person only', `${step} is the person's`);
  }
  assert.ok(doc.readings.length >= 8, 'the readings table holds the built character\'s numbers');
  for (const label of ['Armor Class', 'Hit Points', 'Speed', 'Spell Save DC']) {
    assert.ok(doc.readings.some((reading) => reading.label === label), `the readings table reads ${label}`);
  }
  assert.equal(new Set(doc.readings.map((reading) => reading.character)).size, 1, 'one built character');
});

test('an exported sheet is read by its rows\' labels', () => {
  const rows = exportedRows('# Name\n\n## Combat\n\n- Armor Class: 12\n- **Fire Bolt**: +4, — (range 120 feet)\n\n### Owl\n\n- Armor Class: 11\n');
  assert.equal(rows.get('Armor Class'), '12', 'the character\'s row, not its creature\'s');
  assert.equal(rows.get('Fire Bolt'), '+4, — (range 120 feet)');
});
