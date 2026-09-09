/**
 * A zip reader and writer, in Node, with no dependency.
 *
 * ADR 0012 chose zip because it is "a boring, universal format with a reader in every
 * language and on every platform". That argument only holds if using it stays boring, so
 * this implements the small, well-specified corner of the format the container needs —
 * stored and deflated entries, no encryption, no spanning, no zip64 — on top of
 * `node:zlib`, which already has DEFLATE and CRC-32.
 *
 * The alternative was a dependency for what turns out to be a couple of struct layouts.
 * That trade is worth revisiting the day a container needs zip64 (files ≥ 4 GB, or more
 * than 65,535 entries); until then, both limits are checked and refused loudly.
 *
 * Containers are written **reproducibly**: entries in the order given, a fixed DOS
 * timestamp, and no extra fields. Saving a character twice without changing it produces
 * byte-identical files, so a save in git does not churn.
 */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import type { ZipCodec } from '@incudo/core';

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

export class NodeZipCodec implements ZipCodec {
  async zip(files: Map<string, Uint8Array>): Promise<Uint8Array> {
    return zipSync(files);
  }

  async unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    return unzipSync(bytes);
  }
}

export function zipSync(files: Map<string, Uint8Array>): Uint8Array {
  if (files.size > MAX_ENTRIES) {
    throw new Error(`A container may hold at most ${MAX_ENTRIES} files; this one has ${files.size}.`);
  }

  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [path, content] of files) {
    const name = Buffer.from(normalize(path), 'utf8');
    const data = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    if (data.length > MAX_SIZE) {
      throw new Error(`"${path}" is too large for a zip container without zip64.`);
    }

    // Deflate unless it makes the entry bigger, which happens for small PNGs and JPEGs —
    // they are already compressed, and storing them keeps the container honest about size.
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const checksum = crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // no extra field
    local.push(header, name, payload);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(CENTRAL_HEADER, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed
    entry.writeUInt16LE(FLAG_UTF8, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // comment
    entry.writeUInt16LE(0, 34); // disk number
    entry.writeUInt16LE(0, 36); // internal attributes
    entry.writeUInt32LE(0, 38); // external attributes
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += header.length + name.length + payload.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the directory
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

export function unzipSync(bytes: Uint8Array): Map<string, Uint8Array> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);

  const files = new Map<string, Uint8Array>();

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER) {
      throw new Error('The container is damaged: its directory does not line up.');
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue; // a directory entry carries no bytes

    if (buffer.readUInt32LE(localOffset) !== LOCAL_HEADER) {
      throw new Error(`The container is damaged: no entry header for "${name}".`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(start, start + compressedSize);

    let data: Buffer;
    if (method === METHOD_STORE) data = Buffer.from(payload);
    else if (method === METHOD_DEFLATE) data = inflateRawSync(payload);
    else throw new Error(`"${name}" uses an unsupported compression method (${method}).`);

    if (data.length !== uncompressedSize || crc32(data) !== expectedCrc) {
      throw new Error(`"${name}" did not survive the trip — the container is corrupt.`);
    }

    files.set(safePath(name), new Uint8Array(data));
  }

  return files;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  // The record is 22 bytes plus a comment of up to 64 KB, so scan backwards over that range.
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= earliest; i--) {
    if (buffer.readUInt32LE(i) === EOCD) return i;
  }
  throw new Error('That does not look like a zip container.');
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
