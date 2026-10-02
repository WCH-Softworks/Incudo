/**
 * A `.incu` written on one platform opens on the other — the zip half of ROADMAP Phase 6's exit criterion (ADR 0083).
 *
 * The phone compresses with fflate (`apps/mobile/src/zip.ts`) and the desktop with the platform's DEFLATE (`node:zlib`
 * stands in for it here, as everywhere in these tests). The two make different bytes from the same files, which is
 * allowed; what must hold is that each reads what the other wrote, file for file, and that a container read either way
 * is the same character. Held on the committed fixture and on a large, varied payload, so it needs no corpus.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readCharacterContainer } from '@incudo/core';
import { createMobileZipCodec } from '@incudo/mobile/zip';

import { repoRoot } from './node-system.ts';
import { nodeZipCodec } from './node-zip.ts';

function fixtureFiles(): Map<string, Uint8Array> {
  const dir = join(repoRoot(), 'tools', 'verify', 'fixtures', 'aelin');
  return new Map(readdirSync(dir).map((name) => [name, new Uint8Array(readFileSync(join(dir, name)))]));
}

/** Text that compresses, bytes that do not, and an empty file: every path through a zip writer. */
function variedFiles(): Map<string, Uint8Array> {
  const noise = new Uint8Array(200_000);
  let seed = 12345;
  for (let i = 0; i < noise.length; i++) noise[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  return new Map([
    ['content.json', new TextEncoder().encode(JSON.stringify({ text: 'Áé — '.repeat(50_000) }))],
    ['assets/portrait.bin', noise],
    ['assets/empty.txt', new Uint8Array(0)],
  ]);
}

test('the phone reads what the desktop writes, and the desktop what the phone writes', async () => {
  const phone = createMobileZipCodec();
  for (const files of [fixtureFiles(), variedFiles()]) {
    // Fails if fflate wrote a zlib or gzip wrapper (the desktop could not inflate it), or read one it was not given.
    assert.deepEqual(await phone.unzip(await nodeZipCodec.zip(files)), files);
    assert.deepEqual(await nodeZipCodec.unzip(await phone.zip(files)), files);
  }
});

test('the committed fixture, packed on one side and read on the other, is the same character', async () => {
  const phone = createMobileZipCodec();
  const files = fixtureFiles();
  const viaPhone = readCharacterContainer(await phone.unzip(await nodeZipCodec.zip(files)));
  const viaDesktop = readCharacterContainer(await nodeZipCodec.unzip(await phone.zip(files)));
  assert.ok(viaPhone.container && viaDesktop.container);
  assert.deepEqual(viaPhone.problems, []);
  assert.deepEqual(viaPhone.container, viaDesktop.container);
});
