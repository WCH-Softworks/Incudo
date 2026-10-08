/**
 * An Aurora save shared to the phone is told apart by its contents — ADR 0099.
 *
 * Every sample save is handed over with a name that says nothing ("attachment", as a mail provider may give it) and is
 * recognised as an Aurora save, not added, not refused as "not a character". Fails if the extension decides or the byte
 * order mark is not skipped (`isAuroraSave`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CharacterLibrary, receiveFiles, receivedView } from '@incudo/ui';

import { nodeZipCodec } from './node-zip.ts';
import { readManifest, samplePath } from './sample-saves.ts';

test('every sample Aurora save is recognised by its contents and not imported', async () => {
  const written: string[] = [];
  const library = new CharacterLibrary({
    available: true,
    location: async () => 'library',
    choose: async () => 'library',
    list: async () => [],
    read: async () => new Map(),
    write: async (entry) => void written.push(entry.name),
    remove: async () => undefined,
  });
  const samples = readManifest().samples;
  assert.ok(samples.length > 0);
  const received = samples.map((sample) => ({ name: 'attachment', bytes: new Uint8Array(readFileSync(samplePath(sample))) }));
  const outcomes = await receiveFiles(library, nodeZipCodec, received);
  assert.deepEqual(new Set(outcomes.map((outcome) => outcome.status)), new Set(['aurora-save']));
  assert.equal(
    outcomes[0]!.message,
    'The file is an Aurora save. Import it in Incudo on a computer, then share the .incu file it makes to this phone.',
  );
  assert.deepEqual(written, []);
  assert.equal(receivedView(outcomes).title, 'Not added');
});
