/**
 * A JSON reader that remembers where each value starts — ADR 0103.
 *
 * `JSON.parse` reads a value and forgets the text. A system definition's errors need the text: a line to go to, and a
 * sentence for the syntax slips people make (a comma before `}`, a comment, a single quote), which V8 words as "Expected
 * double-quoted property name in JSON at position 10" and Hermes words differently again. This reads the same grammar
 * (RFC 8259, plus a leading byte order mark, which Windows editors write) and records the line and column of every value
 * under the path the validator renders (`characterKinds[0].buildSteps[2].types`), so an error's path finds its line.
 *
 * It is held to `JSON.parse` by tests: the same value on every JSON file the repository has, and the same verdict on
 * thousands of broken variants of them. Nothing else should use it to read a value; it exists to locate.
 */

export interface JsonPosition {
  /** 1-based. */
  line: number;
  /** 1-based, in UTF-16 code units, as an editor's column counts them for text without astral characters. */
  column: number;
}

export type JsonTextResult =
  | {
      ok: true;
      value: unknown;
      /**
       * Where each value starts, by path: `''` the root, `a.b` a member (its name's position, which is the line the
       * author reads it on), `a[0]` an array's first entry.
       */
      positions: Map<string, JsonPosition>;
    }
  | { ok: false; message: string; line: number; column: number };

class JsonTextError extends Error {
  readonly at: number;
  constructor(message: string, at: number) {
    super(message);
    this.at = at;
  }
}

export function readJsonText(text: string): JsonTextResult {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const position = (at: number): JsonPosition => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= at) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: at - lineStarts[lo]! + 1 };
  };
  const reader = new Reader(text, (path, at) => positions.set(path, position(at)));
  const positions = new Map<string, JsonPosition>();
  try {
    const value = reader.document();
    return { ok: true, value, positions };
  } catch (error) {
    if (!(error instanceof JsonTextError)) throw error;
    return { ok: false, message: error.message, ...position(error.at) };
  }
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

class Reader {
  private readonly text: string;
  private readonly record: (path: string, at: number) => void;
  private at = 0;

  constructor(text: string, record: (path: string, at: number) => void) {
    this.text = text;
    this.record = record;
  }

  document(): unknown {
    if (this.text.charCodeAt(0) === 0xfeff) this.at = 1;
    this.space();
    if (this.at >= this.text.length) throw new JsonTextError('The file is empty.', this.at);
    this.record('', this.at);
    const value = this.value('');
    this.space();
    if (this.at < this.text.length) {
      throw new JsonTextError('There is more after the end: everything must be inside the one outer { … }.', this.at);
    }
    return value;
  }

  private space(): void {
    while (this.at < this.text.length) {
      const c = this.text[this.at]!;
      if (WHITESPACE.has(c)) this.at++;
      else if (c === '/' && (this.text[this.at + 1] === '/' || this.text[this.at + 1] === '*')) {
        throw new JsonTextError('JSON does not allow comments. Remove this one, or put the note in a "description".', this.at);
      } else return;
    }
  }

  private value(path: string): unknown {
    const c = this.text[this.at];
    if (c === '{') return this.object(path);
    if (c === '[') return this.array(path);
    if (c === '"') return this.string();
    if (c === "'") throw new JsonTextError('Text must be in double quotes ("…"), not single quotes.', this.at);
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return this.number();
    for (const [word, literal] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.text.startsWith(word, this.at)) {
        this.at += word.length;
        return literal;
      }
    }
    if (c === undefined) throw new JsonTextError('The file ends where a value should be.', this.at);
    if (c === '}' || c === ']') throw new JsonTextError(`A value is missing before this ${c}.`, this.at);
    if (c === ',') throw new JsonTextError('A value is missing before this comma.', this.at);
    if (/[A-Za-z_]/.test(c)) throw new JsonTextError('Text must be in double quotes ("…"); only true, false and null are written bare.', this.at);
    throw new JsonTextError('This is not valid JSON here.', this.at);
  }

  private object(path: string): Record<string, unknown> {
    const open = this.at;
    this.at++;
    const out: Record<string, unknown> = {};
    this.space();
    if (this.text[this.at] === '}') {
      this.at++;
      return out;
    }
    for (;;) {
      this.space();
      const c = this.text[this.at];
      if (c === undefined) throw new JsonTextError('This { is never closed with a }.', open);
      if (c === "'") throw new JsonTextError('Names must be in double quotes ("…"), not single quotes.', this.at);
      if (c !== '"') {
        if (/[A-Za-z_$]/.test(c)) throw new JsonTextError('Names must be in double quotes ("…").', this.at);
        throw new JsonTextError('A name in double quotes is expected here.', this.at);
      }
      const keyAt = this.at;
      const key = this.string();
      this.space();
      if (this.text[this.at] !== ':') {
        if (this.at >= this.text.length) throw new JsonTextError('This { is never closed with a }.', open);
        throw new JsonTextError(`A colon is missing after "${key}".`, this.at);
      }
      this.at++;
      this.space();
      const child = path === '' ? key : `${path}.${key}`;
      this.record(child, keyAt);
      Object.defineProperty(out, key, { value: this.value(child), enumerable: true, writable: true, configurable: true });
      this.space();
      const next = this.text[this.at];
      if (next === '}') {
        this.at++;
        return out;
      }
      if (next === ',') {
        const comma = this.at;
        this.at++;
        this.space();
        if (this.text[this.at] === '}') {
          throw new JsonTextError('There is a comma after the last entry, before the }. JSON does not allow one: remove it.', comma);
        }
        continue;
      }
      if (next === undefined) throw new JsonTextError('This { is never closed with a }.', open);
      if (next === '"') throw new JsonTextError('A comma is missing before this entry.', this.at);
      if (next === ']') throw new JsonTextError('This ] closes a { : it should be }.', this.at);
      throw new JsonTextError('A comma or a } is expected here.', this.at);
    }
  }

  private array(path: string): unknown[] {
    const open = this.at;
    this.at++;
    const out: unknown[] = [];
    this.space();
    if (this.text[this.at] === ']') {
      this.at++;
      return out;
    }
    for (;;) {
      this.space();
      if (this.at >= this.text.length) throw new JsonTextError('This [ is never closed with a ].', open);
      const child = `${path}[${out.length}]`;
      this.record(child, this.at);
      out.push(this.value(child));
      this.space();
      const next = this.text[this.at];
      if (next === ']') {
        this.at++;
        return out;
      }
      if (next === ',') {
        const comma = this.at;
        this.at++;
        this.space();
        if (this.text[this.at] === ']') {
          throw new JsonTextError('There is a comma after the last entry, before the ]. JSON does not allow one: remove it.', comma);
        }
        continue;
      }
      if (next === undefined) throw new JsonTextError('This [ is never closed with a ].', open);
      if (next === '}') throw new JsonTextError('This } closes a [ : it should be ].', this.at);
      throw new JsonTextError('A comma is missing before this entry.', this.at);
    }
  }

  private string(): string {
    const start = this.at;
    this.at++;
    for (;;) {
      const c = this.text[this.at];
      if (c === undefined) throw new JsonTextError('This text is never closed with a ".', start);
      if (c === '"') break;
      if (c === '\\') {
        const e = this.text[this.at + 1];
        if (e === 'u') {
          if (!/^[0-9A-Fa-f]{4}$/.test(this.text.slice(this.at + 2, this.at + 6))) {
            throw new JsonTextError('\\u must be followed by four hexadecimal digits.', this.at);
          }
          this.at += 6;
          continue;
        }
        if (e === undefined || !'"\\/bfnrt'.includes(e)) {
          throw new JsonTextError(`\\${e ?? ''} is not something JSON can write after a backslash. A backslash itself is written \\\\.`, this.at);
        }
        this.at += 2;
        continue;
      }
      if (c.charCodeAt(0) < 0x20) {
        throw new JsonTextError(
          c === '\n' || c === '\r' ? 'This text is never closed with a " on its line (a line break inside text is written \\n).' : 'Text cannot hold a control character; write it with \\u.',
          c === '\n' || c === '\r' ? start : this.at,
        );
      }
      this.at++;
    }
    this.at++;
    return JSON.parse(this.text.slice(start, this.at)) as string;
  }

  private number(): number {
    NUMBER.lastIndex = this.at;
    const match = NUMBER.exec(this.text);
    if (!match || match[0] === '-' || match[0].length === 0) throw new JsonTextError('This is not a number JSON can read.', this.at);
    const after = this.text[this.at + match[0].length];
    if (after !== undefined && /[0-9A-Za-z.+]/.test(after)) {
      throw new JsonTextError('This is not a number JSON can read (no leading zeros, no + sign, digits after a point).', this.at);
    }
    this.at += match[0].length;
    return Number(match[0]);
  }
}
