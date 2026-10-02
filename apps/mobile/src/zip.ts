/**
 * DEFLATE for the `.incu` container on a phone — ADR 0083.
 *
 * A port's implementation (`ZipCodec`, `packages/core/src/platform.ts`): `core` owns the zip layout and asks a platform
 * only for raw DEFLATE. The desktop uses the web platform's `CompressionStream`; Hermes, React Native's engine, has
 * none, so this is fflate, a dependency-free JavaScript implementation, in the shell and never in `core` (adding one
 * there would need an ADR and would put a compressor in every platform's bundle).
 *
 * Its own file, with nothing from Expo in it, so `tools/verify` can run it under Node and hold it to the desktop's
 * containers in both directions (`mobile-zip.test.ts`).
 */

import { deflateSync, inflateSync } from 'fflate';

import { createZipCodec, type ZipCodec, type ZipCompressor } from '@incudo/core';

export const mobileCompressor: ZipCompressor = {
  // Level 9, as the desktop's tests write: a save is written rarely and read often.
  deflateRaw(data) {
    return deflateSync(data, { level: 9 });
  },
  // The size the zip's directory claims is not used to allocate: a file someone sent could claim four gigabytes. fflate
  // grows its buffer as it goes, and `core` checks the result against that size and the CRC either way.
  inflateRaw(data) {
    return inflateSync(data);
  },
};

export function createMobileZipCodec(): ZipCodec {
  return createZipCodec(mobileCompressor);
}
