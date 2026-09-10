import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeBase64, imageExtension } from './base64.ts';

/**
 * The bytes come from `Buffer` here purely to have a known-good encoder to compare against.
 * `base64.ts` itself may not use it — this package runs wherever the engine runs, and
 * `Buffer` is Node's.
 */
function encode(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}

test('decodes what a standard encoder produced, at every padding length', () => {
  for (let length = 0; length < 12; length++) {
    const bytes = Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
    const { bytes: decoded, skipped } = decodeBase64(encode(bytes));
    assert.deepEqual([...decoded], bytes, `length ${length}`);
    assert.equal(skipped, 0);
  }
});

test('the whole byte range survives the round trip', () => {
  const all = Array.from({ length: 256 }, (_, i) => i);
  assert.deepEqual([...decodeBase64(encode(all)).bytes], all);
});

test('whitespace is how the XML formats the payload, not corruption', () => {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5];
  const wrapped = encode(bytes).replace(/(.{4})/g, '$1\n\t  ');
  const { bytes: decoded, skipped } = decodeBase64(`\n\t${wrapped}\r\n  `);
  assert.deepEqual([...decoded], bytes);
  assert.equal(skipped, 0, 'whitespace must not be counted as skipped');
});

test('junk is counted rather than thrown, so a damaged portrait costs only the portrait', () => {
  const { bytes, skipped } = decodeBase64('QUJD!!!REVG');
  assert.equal(skipped, 3);
  assert.equal(Buffer.from(bytes).toString('utf8'), 'ABCDEF');
});

test('the URL-safe alphabet decodes too', () => {
  const bytes = [0xfb, 0xff, 0xbe];
  assert.deepEqual([...decodeBase64(encode(bytes).replace(/\+/g, '-').replace(/\//g, '_')).bytes], bytes);
});

test('empty in, empty out', () => {
  assert.equal(decodeBase64('').bytes.length, 0);
  assert.equal(decodeBase64('   \n  ').bytes.length, 0);
});

test('the extension comes from the bytes, because the recorded path is another machine', () => {
  assert.equal(imageExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9])), 'png');
  assert.equal(imageExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageExtension(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39])), 'gif');
  assert.equal(imageExtension(new Uint8Array([0x42, 0x4d, 0x00])), 'bmp');

  const webp = new Uint8Array(16);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);
  assert.equal(imageExtension(webp), 'webp');
});

test('an unrecognised payload gets no extension rather than a guessed one', () => {
  assert.equal(imageExtension(new Uint8Array([1, 2, 3, 4])), undefined);
  assert.equal(imageExtension(new Uint8Array([])), undefined);
  // Truncated PNG magic: close is not the same as right.
  assert.equal(imageExtension(new Uint8Array([0x89, 0x50, 0x4e])), undefined);
});
