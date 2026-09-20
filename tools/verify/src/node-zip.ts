/**
 * The Node half of the zip codec: `node:zlib`, and nothing else.
 *
 * The framing — headers, the central directory, CRC-32, the unsafe-path check — lives in
 * `@incudo/core`'s zip.ts, because it is arithmetic over bytes and the mobile and desktop
 * shells need exactly the same arithmetic. What is platform-shaped is DEFLATE, so that is
 * what this file supplies (CODE-REUSE-POLICY rule 1).
 *
 * This used to be the whole implementation. It was moved when the desktop shell needed a
 * `ZipCodec` of its own and the alternative was a second 200-line zip writer in `apps/`.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createZipCodec, type ZipCodec, type ZipCompressor } from '@incudo/core';

/** Level 9: a save is written rarely and read often, and it lives in someone's git history. */
export const nodeZipCompressor: ZipCompressor = {
  deflateRaw(data) {
    return new Uint8Array(deflateRawSync(data, { level: 9 }));
  },
  inflateRaw(data) {
    return new Uint8Array(inflateRawSync(data));
  },
};

export const nodeZipCodec: ZipCodec = createZipCodec(nodeZipCompressor);

export class NodeZipCodec implements ZipCodec {
  async zip(files: Map<string, Uint8Array>): Promise<Uint8Array> {
    return nodeZipCodec.zip(files);
  }

  async unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    return nodeZipCodec.unzip(bytes);
  }
}
