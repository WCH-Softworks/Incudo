import { test } from 'node:test';
import assert from 'node:assert/strict';

import { integrityOf, sha256Hex } from './sha256.ts';

/**
 * Published FIPS 180-4 vectors, plus the block-boundary cases a hand-written padding
 * routine gets wrong: exactly 55, 56, 63, 64 and 65 bytes, where the length field either
 * just fits or forces an extra block.
 */
test('known vectors', () => {
  const hash = (s: string) => sha256Hex(new TextEncoder().encode(s));

  assert.equal(hash(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    hash('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
  assert.equal(
    sha256Hex(new TextEncoder().encode('a'.repeat(1000000))),
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
  );
});

test('block boundaries', () => {
  // 55 fits the length field in the same block; 56 does not and forces a second one.
  const expected: Record<number, string> = {
    55: '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
    56: 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
    63: '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34',
    64: 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    65: '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0',
  };
  for (const [length, digest] of Object.entries(expected)) {
    assert.equal(sha256Hex(new TextEncoder().encode('a'.repeat(Number(length)))), digest, length);
  }
});

test('bytes, not text — the container hashes PNGs too', () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  assert.match(sha256Hex(bytes), /^[0-9a-f]{64}$/);
  assert.notEqual(sha256Hex(bytes), sha256Hex(new Uint8Array([...bytes, 0])));
});

test('a view into a larger buffer hashes only its own window', () => {
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
  const window = backing.subarray(2, 5);
  assert.equal(sha256Hex(window), sha256Hex(new Uint8Array([1, 2, 3])));
});

test('the integrity form the manifest records', () => {
  assert.equal(
    integrityOf(new Uint8Array()),
    'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});
