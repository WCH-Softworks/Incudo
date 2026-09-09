import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zipSync, unzipSync } from './node-zip.ts';

function sample(): Map<string, Uint8Array> {
  return new Map([
    ['manifest.json', new TextEncoder().encode('{"formatVersion":1}')],
    // Embedded content is repetitive HTML; ADR 0012 counts on roughly 10:1 for it.
    ['content.json', new TextEncoder().encode('<p>The same sentence again. </p>'.repeat(400))],
    ['assets/portrait.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3])],
  ]);
}

test('a container round-trips', () => {
  const files = sample();
  const back = unzipSync(zipSync(files));

  assert.deepEqual([...back.keys()], [...files.keys()]);
  for (const [path, bytes] of files) {
    assert.deepEqual([...back.get(path)!], [...bytes], path);
  }
});

test('the JSON actually compresses', () => {
  const files = sample();
  const raw = [...files.values()].reduce((n, b) => n + b.length, 0);
  const zipped = zipSync(files).length;
  assert.ok(zipped * 5 < raw, `expected real compression, got ${raw} → ${zipped}`);
});

test('writing the same tree twice produces the same bytes', () => {
  // A save in git should not churn just because it was opened and saved again.
  assert.deepEqual([...zipSync(sample())], [...zipSync(sample())]);
});

test('an empty container is still a valid zip', () => {
  assert.deepEqual([...unzipSync(zipSync(new Map())).keys()], []);
});

test('an entry that does not compress is stored rather than inflated', () => {
  // Random bytes stand in for a PNG: DEFLATE makes them bigger, so the writer stores them.
  const random = new Uint8Array(4096).map(() => Math.floor(Math.random() * 256));
  const files = new Map([['assets/noise.bin', random]]);
  const zipped = zipSync(files);
  assert.ok(zipped.length < random.length + 200, `stored entry grew to ${zipped.length}`);
  assert.deepEqual([...unzipSync(zipped).get('assets/noise.bin')!], [...random]);
});

test('corruption is caught, not passed on', () => {
  const zipped = zipSync(sample());
  // Flip a byte inside the first entry's payload, past the 30-byte header and its name.
  const damaged = new Uint8Array(zipped);
  damaged[60] = damaged[60]! ^ 0xff;
  assert.throws(() => unzipSync(damaged), /corrupt|damaged|unsupported/i);
});

test('something that is not a zip says so', () => {
  assert.throws(
    () => unzipSync(new TextEncoder().encode('this is a character sheet, honest')),
    /does not look like a zip/,
  );
});

/**
 * A `.incu` is a file people email to each other, so it is untrusted input. `..` in an entry
 * name is the oldest archive trick there is, and the right place to stop it is on read,
 * before any caller is tempted to write the path out.
 */
test('a path that escapes the container is refused', () => {
  const hostile = zipSync(new Map([['../../.ssh/authorized_keys', new Uint8Array([1])]]));
  assert.throws(() => unzipSync(hostile), /unsafe path/);

  const absolute = zipSync(new Map([['C:/Windows/System32/evil.dll', new Uint8Array([1])]]));
  assert.throws(() => unzipSync(absolute), /unsafe path/);
});

test('backslashes are normalized, so a Windows-written container reads anywhere', () => {
  const back = unzipSync(zipSync(new Map([['assets\\portrait.png', new Uint8Array([1])]])));
  assert.deepEqual([...back.keys()], ['assets/portrait.png']);
});

/**
 * The whole argument for zip in ADR 0012 is that every platform already has a reader. If the
 * system `unzip` cannot open what this writes, that argument does not hold — so check it,
 * and skip where the tool is not installed rather than pretending to.
 */
test('the system unzip agrees it is a zip', { skip: !hasUnzip() }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'incudo-zip-'));
  try {
    const path = join(dir, 'character.incu');
    await writeFile(path, zipSync(sample()));
    const listing = execFileSync('unzip', ['-l', path], { encoding: 'utf8' });
    assert.match(listing, /manifest\.json/);
    assert.match(listing, /assets\/portrait\.png/);
    assert.match(execFileSync('unzip', ['-t', path], { encoding: 'utf8' }), /No errors detected/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
