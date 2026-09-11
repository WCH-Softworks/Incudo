import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crc32, createZipCodec, readZip, writeZip, type ZipCompressor } from './zip.ts';

/**
 * A compressor that does not compress.
 *
 * `core` imports nothing, so its tests bring no DEFLATE either — and they do not need one:
 * everything in zip.ts except the two calls out to this interface is framing. An
 * implementation that returns its input unchanged is never smaller, so every entry is stored,
 * which exercises the store path end to end. The deflate path is covered where a real
 * compressor lives, in `tools/incudo/src/node-zip.test.ts`.
 */
const identity: ZipCompressor = {
  deflateRaw: (data) => data,
  inflateRaw: (data) => data,
};

/** Same shape, but slower to say so — proves the "deflate only if it helps" branch. */
const alwaysBigger: ZipCompressor = {
  deflateRaw: (data) => new Uint8Array([...data, 0, 0, 0, 0]),
  inflateRaw: (data) => data.slice(0, data.length - 4),
};

function sample(): Map<string, Uint8Array> {
  return new Map([
    ['manifest.json', new TextEncoder().encode('{"formatVersion":1}')],
    ['character.json', new TextEncoder().encode('{"name":"Aelin"}')],
    ['assets/portrait.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
  ]);
}

test('the framing round-trips with any compressor', async () => {
  for (const compressor of [identity, alwaysBigger]) {
    const codec = createZipCodec(compressor);
    const back = await codec.unzip(await codec.zip(sample()));
    assert.deepEqual([...back.keys()], [...sample().keys()]);
    for (const [path, bytes] of sample()) {
      assert.deepEqual([...back.get(path)!], [...bytes], path);
    }
  }
});

test('an entry only deflates when deflating helps', async () => {
  // `alwaysBigger` makes every entry four bytes longer, so the writer must store instead —
  // and storing means its `inflateRaw` is never called, which is why the round-trip above
  // works at all with a compressor whose two halves do not agree.
  const written = await writeZip(sample(), alwaysBigger);
  const back = await readZip(written, {
    deflateRaw: () => {
      throw new Error('not reached');
    },
    inflateRaw: () => {
      throw new Error('this container should hold no deflated entries');
    },
  });
  assert.equal(back.size, 3);
});

test('a path that escapes the container is refused on read', async () => {
  const codec = createZipCodec(identity);
  const hostile = await codec.zip(new Map([['../../.ssh/authorized_keys', new Uint8Array([1])]]));
  await assert.rejects(codec.unzip(hostile), /unsafe path/);

  const absolute = await codec.zip(new Map([['C:/Windows/System32/evil.dll', new Uint8Array([1])]]));
  await assert.rejects(codec.unzip(absolute), /unsafe path/);
});

test('backslashes are normalized, so a Windows-written container reads anywhere', async () => {
  const codec = createZipCodec(identity);
  const back = await codec.unzip(await codec.zip(new Map([['assets\\portrait.png', new Uint8Array([1])]])));
  assert.deepEqual([...back.keys()], ['assets/portrait.png']);
});

test('an empty container is still a valid zip', async () => {
  const codec = createZipCodec(identity);
  assert.deepEqual([...(await codec.unzip(await codec.zip(new Map()))).keys()], []);
});

test('something that is not a zip says so', async () => {
  const codec = createZipCodec(identity);
  await assert.rejects(
    codec.unzip(new TextEncoder().encode('this is a character sheet, honest')),
    /does not look like a zip/,
  );
});

/**
 * The published check vectors. A CRC that is subtly wrong produces containers every other
 * tool rejects, and nothing in a round-trip test would notice because it would be wrong in
 * both directions.
 */
test('crc32 agrees with the published vectors', () => {
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('a container written twice is byte-identical', async () => {
  const codec = createZipCodec(identity);
  assert.deepEqual([...(await codec.zip(sample()))], [...(await codec.zip(sample()))]);
});
