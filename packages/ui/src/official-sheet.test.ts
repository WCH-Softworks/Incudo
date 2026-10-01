/**
 * The official sheet step: the kept copy, what the step says, and the result line — ADR 0079 decision 3. No game: a
 * made-up form. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '@incudo/core';

import type { FormMap } from './form-fill.ts';
import {
  formCopyKey,
  fromBase64,
  keepFormCopy,
  officialSheetFileName,
  officialSheetResult,
  officialSheetView,
  readFormCopy,
  removeFormCopy,
  toBase64,
} from './official-sheet.ts';

const map: FormMap = {
  formatVersion: 1,
  id: 'tinker-form',
  name: 'the tinker form',
  publisher: 'The Guild',
  download: 'https://example.invalid/forms',
  system: 'test',
  kinds: ['tinker'],
  encoding: 'WinAnsi',
  fields: { Name: 'text' },
  fill: [{ field: 'Name', value: 'name' }],
};

// Fails if a length not a multiple of three is padded wrongly, if a high byte is mangled, or if decoding does not
// invert encoding.
test('base64 round-trips every byte value and every length', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let n = 0; n <= 6; n++) assert.deepEqual([...fromBase64(toBase64(all.subarray(0, n)))], [...all.subarray(0, n)]);
  assert.deepEqual([...fromBase64(toBase64(all))], [...all]);
  assert.equal(toBase64(new TextEncoder().encode('Man')), 'TWFu');
  assert.equal(toBase64(new TextEncoder().encode('Ma')), 'TWE=');
  assert.equal(toBase64(new TextEncoder().encode('M')), 'TQ==');
});

// Fails if the copy is kept under a cache prefix (eviction would delete the only copy), if it does not come back as it
// went in, if a second copy does not replace the first, or if removing leaves it.
test('a copy is kept beside a user\'s own files, read back as it went in, replaced, and removed', async () => {
  const storage = new MemoryStorage();
  assert.equal(await readFormCopy(storage, map.id), null);
  assert.equal(formCopyKey(map.id), 'forms/tinker-form');
  assert.ok(!formCopyKey(map.id).startsWith('content/'));
  await keepFormCopy(storage, map.id, { name: 'form.pdf', bytes: new Uint8Array([37, 80, 68, 70, 0, 255]) });
  const kept = await readFormCopy(storage, map.id);
  assert.equal(kept?.name, 'form.pdf');
  assert.deepEqual([...kept!.bytes], [37, 80, 68, 70, 0, 255]);
  await keepFormCopy(storage, map.id, { name: 'other.pdf', bytes: new Uint8Array([1]) });
  assert.equal((await readFormCopy(storage, map.id))?.name, 'other.pdf');
  await removeFormCopy(storage, map.id);
  assert.equal(await readFormCopy(storage, map.id), null);
});

// Fails if a damaged record throws instead of reading as no copy (the step would not open).
test('a kept record that cannot be read is no copy', async () => {
  const storage = new MemoryStorage();
  await storage.write(formCopyKey(map.id), 'not json');
  assert.equal(await readFormCopy(storage, map.id), null);
  await storage.write(formCopyKey(map.id), JSON.stringify({ name: 'x.pdf', bytes: '!!!' }));
  assert.equal(await readFormCopy(storage, map.id), null);
});

// Fails if the step offers filling with no copy, offers removing nothing, names the copy wrongly, or does not say that
// Incudo neither includes nor downloads the form and where to get it.
test('the step says where the form comes from, which copy is kept, and offers filling only with one', () => {
  const none = officialSheetView(map, null);
  assert.equal(none.fill.enabled, false);
  assert.equal(none.remove, undefined);
  assert.equal(none.copy, 'No copy chosen yet.');
  assert.equal(none.choose, 'Choose your copy…');
  assert.deepEqual(none.download, { label: 'Download page', url: 'https://example.invalid/forms' });
  assert.match(none.lede.join(' '), /the tinker form that The Guild publishes/);
  assert.match(none.lede.join(' '), /does not include or download it/);
  const kept = officialSheetView(map, { name: 'mine.pdf' }, 'That was not it.');
  assert.equal(kept.fill.enabled, true);
  assert.equal(kept.copy, 'Your copy: mine.pdf');
  assert.equal(kept.choose, 'Choose another copy…');
  assert.equal(kept.remove, 'Remove copy');
  assert.equal(kept.problem, 'That was not it.');
});

// Fails if what was left off is not named, or if a fill with nothing left off says anything more than the file.
test('the result names the file and what was left off', () => {
  assert.equal(officialSheetResult('nyx.pdf', { leftOff: [] }), 'Filled the official sheet as nyx.pdf.');
  assert.equal(
    officialSheetResult('nyx.pdf', { leftOff: ['2 of 4 Gear past the form\'s boxes', 'Runes — Beta'] }),
    "Filled the official sheet as nyx.pdf. Left off, and on Incudo's own sheet: 2 of 4 Gear past the form's boxes; Runes — Beta.",
  );
  assert.equal(officialSheetFileName('Nyx Évora'), 'nyx-evora-official-sheet.pdf');
  assert.equal(officialSheetFileName('  '), 'character-official-sheet.pdf');
});
