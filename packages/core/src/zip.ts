/**
 * The zip *framing* for a `.incu` container — headers, the central directory, CRC-32 — with
 * the compressor injected.
 *
 * ADR 0012 chose zip because it is "a boring, universal format with a reader in every language
 * and on every platform". That argument only holds if using it stays boring, so this implements
 * the small, well-specified corner of the format a container needs — stored and deflated
 * entries, no encryption, no spanning, no zip64 — and nothing else.
 *
 * Why the split. Everything here is arithmetic over bytes and belongs in `core` with the rest of
 * the container (container.ts owns the *tree*; this turns that tree into one file). DEFLATE is
 * the one part that is genuinely platform-shaped: `node:zlib` in Node, `CompressionStream` in
 * a browser and in Tauri's webview, something else again on mobile. So the compressor is
 * injected, exactly like `Fetcher` and `Storage` (CODE-REUSE-POLICY rule 1), and there is one
 * zip implementation in the project rather than one per shell.
 *
 * Containers are written **reproducibly**: entries in the order given, a fixed DOS timestamp, no
 * extra fields. Saving a character twice without changing it produces byte-identical files, so a
 * save in git does not churn. That holds *per compressor* — zlib at level 9 and a browser's
 * `deflate-raw` make different bytes from the same input, which changes nothing about the
 * container's contents or its `integrity` hashes, because those are taken over the uncompressed
 * bytes.
 */

import type { ZipCodec } from './platform.ts';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD = 0x06054b50;

/** 1980-01-01 00:00, the earliest a DOS timestamp can express. Fixed, for reproducibility. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** Bit 11: the name is UTF-8. Every modern reader honours it; the container needs it. */
const FLAG_UTF8 = 0x0800;

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

/**
 * Raw DEFLATE, both ways. "Raw" means no zlib and no gzip wrapper — zip carries its own
 * framing, so a wrapped stream would be two headers deep and unreadable by every other tool.
 *
 * `inflateRaw` is told the size the directory claims, which lets an implementation that needs a
 * destination buffer allocate one. It may be ignored; the result is checked against both that
 * size and the CRC either way.
 */
export interface ZipCompressor {
  deflateRaw(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  inflateRaw(data: Uint8Array, uncompressedSize: number): Uint8Array | Promise<Uint8Array>;
}

/** Wrap a compressor as the {@link ZipCodec} port the container code takes. */
export function createZipCodec(compressor: ZipCompressor): ZipCodec {
  return {
    zip: (files) => writeZip(files, compressor),
    unzip: (bytes) => readZip(bytes, compressor),
  };
}

export async function writeZip(
  files: Map<string, Uint8Array>,
  compressor: ZipCompressor,
): Promise<Uint8Array> {
  if (files.size > MAX_ENTRIES) {
    throw new Error(
      `A container may hold at most ${MAX_ENTRIES} files; this one has ${files.size}.`,
    );
  }

  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [path, data] of files) {
    const name = new TextEncoder().encode(normalize(path));
    if (data.length > MAX_SIZE) {
      throw new Error(`"${path}" is too large for a zip container without zip64.`);
    }

    // Deflate unless it makes the entry bigger, which happens for small PNGs and JPEGs —
    // they are already compressed, and storing them keeps the container honest about size.
    const deflated = await compressor.deflateRaw(data);
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const checksum = crc32(data);

    const header = new Uint8Array(30);
    const h = new DataView(header.buffer);
    h.setUint32(0, LOCAL_HEADER, true);
    h.setUint16(4, 20, true); // version needed
    h.setUint16(6, FLAG_UTF8, true);
    h.setUint16(8, method, true);
    h.setUint16(10, DOS_TIME, true);
    h.setUint16(12, DOS_DATE, true);
    h.setUint32(14, checksum, true);
    h.setUint32(18, payload.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    h.setUint16(28, 0, true); // no extra field
    local.push(header, name, payload);

    const entry = new Uint8Array(46);
    const e = new DataView(entry.buffer);
    e.setUint32(0, CENTRAL_HEADER, true);
    e.setUint16(4, 20, true); // version made by
    e.setUint16(6, 20, true); // version needed
    e.setUint16(8, FLAG_UTF8, true);
    e.setUint16(10, method, true);
    e.setUint16(12, DOS_TIME, true);
    e.setUint16(14, DOS_DATE, true);
    e.setUint32(16, checksum, true);
    e.setUint32(20, payload.length, true);
    e.setUint32(24, data.length, true);
    e.setUint16(28, name.length, true);
    e.setUint16(30, 0, true); // extra
    e.setUint16(32, 0, true); // comment
    e.setUint16(34, 0, true); // disk number
    e.setUint16(36, 0, true); // internal attributes
    e.setUint32(38, 0, true); // external attributes
    e.setUint32(42, offset, true);
    central.push(entry, name);

    offset += header.length + name.length + payload.length;
  }

  const directory = concat(central);
  const end = new Uint8Array(22);
  const v = new DataView(end.buffer);
  v.setUint32(0, EOCD, true);
  v.setUint16(4, 0, true); // this disk
  v.setUint16(6, 0, true); // disk with the directory
  v.setUint16(8, files.size, true);
  v.setUint16(10, files.size, true);
  v.setUint32(12, directory.length, true);
  v.setUint32(16, offset, true);
  v.setUint16(20, 0, true); // comment length

  return concat([...local, directory, end]);
}

export async function readZip(
  bytes: Uint8Array,
  compressor: ZipCompressor,
): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);

  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER) {
      throw new Error('The container is damaged: its directory does not line up.');
    }
    const method = view.getUint16(cursor + 10, true);
    const expectedCrc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // a directory entry carries no bytes

    if (view.getUint32(localOffset, true) !== LOCAL_HEADER) {
      throw new Error(`The container is damaged: no entry header for "${name}".`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const payload = bytes.subarray(start, start + compressedSize);

    let data: Uint8Array;
    if (method === METHOD_STORE) data = payload.slice();
    else if (method === METHOD_DEFLATE) data = await compressor.inflateRaw(payload, uncompressedSize);
    else throw new Error(`"${name}" uses an unsupported compression method (${method}).`);

    if (data.length !== uncompressedSize || crc32(data) !== expectedCrc) {
      throw new Error(`"${name}" did not survive the trip — the container is corrupt.`);
    }

    files.set(safePath(name), data);
  }

  return files;
}

/**
 * CRC-32, the zip flavour (reflected, polynomial 0xEDB88320), table built on first use.
 *
 * Written out rather than reached for from a platform because `core` imports nothing, and
 * because a checksum is arithmetic, not I/O.
 */
export function crc32(data: Uint8Array): number {
  const table = crcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let TABLE: Uint32Array | undefined;

function crcTable(): Uint32Array {
  if (TABLE) return TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  TABLE = table;
  return table;
}

function findEndOfCentralDirectory(view: DataView): number {
  // The record is 22 bytes plus a comment of up to 64 KB, so scan backwards over that range.
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= earliest; i--) {
    if (view.getUint32(i, true) === EOCD) return i;
  }
  throw new Error('That does not look like a zip container.');
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Refuse an entry that would escape the container root.
 *
 * A `.incu` is a file people email to each other, so it is untrusted input even when it came
 * from a friend. `../../.ssh/authorized_keys` inside an archive is the oldest trick there is,
 * and the right time to stop it is while reading, before any caller can be tempted to write
 * the path out.
 */
function safePath(name: string): string {
  const normalized = normalize(name);
  if (/^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`The container holds an unsafe path: "${name}".`);
  }
  return normalized;
}
