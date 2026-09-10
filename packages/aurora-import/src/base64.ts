/**
 * Base64, decoded by hand.
 *
 * Aurora inlines the whole portrait PNG as base64 inside the save's XML — up to 5.2 MB of
 * it. Getting those bytes back out is the entire job of the portrait importer, and it has
 * to happen in this package, which may not touch anything platform-shaped
 * (docs/CODE-REUSE-POLICY.md). `atob` is a browser API and `Buffer` is a Node one, so
 * neither is available here; this is twenty lines of arithmetic instead.
 *
 * Decoding only. Incudo never writes base64 — a portrait leaves here as bytes and lands in
 * the container's `assets/` as a real file (ADR 0007, ADR 0012).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Reverse lookup, built once. -1 means "not a base64 digit". */
const VALUES = buildValues();

function buildValues(): Int8Array {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  // Aurora's own writer emits standard base64, but saves get edited and mailed around.
  // Accepting the URL-safe alphabet costs two lines and removes a whole class of report.
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
}

export interface Base64Result {
  bytes: Uint8Array;
  /**
   * Characters skipped because they are not base64 digits. Whitespace is expected — the XML
   * wraps the payload across lines — so this counts only what is left after ignoring it.
   */
  skipped: number;
}

/**
 * Decode base64 text to bytes, tolerating the whitespace XML text nodes are full of.
 *
 * Returns what it could decode rather than throwing: a save with a truncated portrait
 * should still open, with a diagnostic, and lose only the picture.
 */
export function decodeBase64(text: string): Base64Result {
  let skipped = 0;
  // 3 bytes per 4 digits, rounded up. Over-allocating by a couple of bytes and slicing at
  // the end beats growing an array 5 million times.
  const out = new Uint8Array(Math.ceil((text.length * 3) / 4) + 3);
  let length = 0;
  let accumulator = 0;
  let bits = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x3d) break; // '=' — padding, and nothing meaningful follows it.
    const value = code < 128 ? VALUES[code]! : -1;
    if (value < 0) {
      // \t \n \v \f \r and space are how the XML formats the payload, not corruption.
      if (code !== 0x20 && (code < 0x09 || code > 0x0d)) skipped++;
      continue;
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[length++] = (accumulator >> bits) & 0xff;
    }
  }

  return { bytes: out.subarray(0, length), skipped };
}

/**
 * The file extension a byte string's magic number implies.
 *
 * Aurora stores the original path beside the base64, but that path is a Windows absolute
 * path to a file on someone else's machine and is often wrong or gone. The bytes are the
 * only thing that is definitely true, so the extension comes from them. Anything
 * unrecognised gets no extension rather than a guessed one.
 */
export function imageExtension(bytes: Uint8Array): string | undefined {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'jpg';
  if (starts(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (starts(bytes, [0x42, 0x4d])) return 'bmp';
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return 'webp';
  }
  return undefined;
}

function starts(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
  return true;
}
