/**
 * The `requirements` expression language.
 *
 * Reverse-engineered from the AuroraLegacy corpus (see docs/AURORA-FORMAT.md).
 * Grammar, lowest precedence first:
 *
 *   or   := and ( ('||' | '|') and )*
 *   and  := unary ( ',' unary )*
 *   unary:= '!' unary | primary
 *   prim := '(' or ')' | '[' check ']' | IDENTIFIER
 *
 * A bracketed check is `[<namespaced stat>:<threshold>]`:
 *   [dex:13]              -> stat "dex" >= 13
 *   [level:warlock:2]     -> stat "level:warlock" >= 2
 *   [innate speed:swim:1] -> stat "innate speed:swim" >= 1
 *   [armor:heavy]         -> stat "armor" equals "heavy"   (non-numeric tail; a stat that
 *                            publishes tags answers this by membership instead — ADR 0025)
 *   [d10s]                -> flag "d10s" is set            (single segment)
 *
 * Parsing happens once, at import. The engine evaluates the tree, never the string.
 */

export type RequirementExpr =
  | { kind: 'and'; children: RequirementExpr[] }
  | { kind: 'or'; children: RequirementExpr[] }
  | { kind: 'not'; child: RequirementExpr }
  | { kind: 'has'; id: string }
  | { kind: 'atLeast'; stat: string; value: number }
  | { kind: 'equals'; stat: string; value: string }
  | { kind: 'flag'; name: string }
  | { kind: 'always' };

export class RequirementParseError extends Error {
  readonly source: string;
  readonly position: number;

  constructor(message: string, source: string, position: number) {
    super(`${message} (at ${position} in ${JSON.stringify(source)})`);
    this.name = 'RequirementParseError';
    this.source = source;
    this.position = position;
  }
}

export function parseRequirements(input: string | undefined | null): RequirementExpr | undefined {
  if (input == null) return undefined;
  const text = input.trim();
  if (text === '') return undefined;
  const parser = new Parser(text);
  const expr = parser.parseOr();
  parser.expectEnd();
  return expr;
}

class Parser {
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  parseOr(): RequirementExpr {
    const children = [this.parseAnd()];
    while (this.eatOr()) children.push(this.parseAnd());
    return children.length === 1 ? children[0]! : { kind: 'or', children };
  }

  private parseAnd(): RequirementExpr {
    const children = [this.parseUnary()];
    while (this.eat(',')) children.push(this.parseUnary());
    return children.length === 1 ? children[0]! : { kind: 'and', children };
  }

  private parseUnary(): RequirementExpr {
    this.skipSpace();
    if (this.eat('!')) return { kind: 'not', child: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): RequirementExpr {
    this.skipSpace();
    if (this.eat('(')) {
      const inner = this.parseOr();
      this.skipSpace();
      if (!this.eat(')')) throw this.error('expected ")"');
      return inner;
    }
    if (this.eat('[')) {
      const start = this.pos;
      while (this.pos < this.src.length && this.src[this.pos] !== ']') this.pos++;
      if (this.pos >= this.src.length) throw this.error('unterminated "["');
      const body = this.src.slice(start, this.pos);
      this.pos++; // ']'
      return parseCheck(body);
    }
    const start = this.pos;
    while (this.pos < this.src.length && isIdentChar(this.src[this.pos]!)) this.pos++;
    if (this.pos === start) throw this.error('expected an identifier');
    return { kind: 'has', id: this.src.slice(start, this.pos).trim() };
  }

  private eatOr(): boolean {
    this.skipSpace();
    // "||" and "|" both mean or; check the two-char form first.
    if (this.src.startsWith('||', this.pos)) {
      this.pos += 2;
      return true;
    }
    return this.eat('|');
  }

  private eat(ch: string): boolean {
    this.skipSpace();
    if (this.src[this.pos] === ch) {
      this.pos++;
      return true;
    }
    return false;
  }

  private skipSpace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos]!)) this.pos++;
  }

  expectEnd(): void {
    this.skipSpace();
    if (this.pos < this.src.length) throw this.error('unexpected trailing input');
  }

  private error(message: string): RequirementParseError {
    return new RequirementParseError(message, this.src, this.pos);
  }
}

function parseCheck(body: string): RequirementExpr {
  const segments = body.split(':').map((s) => s.trim());
  if (segments.length === 1) return { kind: 'flag', name: segments[0]!.toLowerCase() };

  const tail = segments[segments.length - 1]!;
  const stat = segments.slice(0, -1).join(':').toLowerCase();
  const asNumber = Number(tail);
  if (tail !== '' && Number.isFinite(asNumber)) {
    return { kind: 'atLeast', stat, value: asNumber };
  }
  return { kind: 'equals', stat, value: tail.toLowerCase() };
}

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_\-.#]/.test(ch);
}

/** What an expression needs in order to be evaluated. Supplied by the engine. */
export interface RequirementContext {
  hasElement(id: string): boolean;
  statNumber(stat: string): number;
  statString(stat: string): string | undefined;
  /**
   * The tags a stat publishes, when it is one that publishes tags rather than a value — a
   * character kind's equipment slots are the only source today (ADR 0025).
   *
   * Optional, and the branch `equals` takes: a slot answers `[armor:medium]` by membership,
   * and everything else answers it by string equality. That split is what lets one syntax
   * carry three kinds of question — `[armor:heavy]` is a setter's value, `[primary:versatile]`
   * is a setter's *presence*, `[primary:double-bladed scimitar]` is an element's name — while
   * the corpus's eight `[type:spell]` checks keep comparing a string.
   */
  statTags?(stat: string): ReadonlySet<string> | undefined;
  hasFlag(name: string): boolean;
}

export function evaluateRequirements(
  expr: RequirementExpr | undefined,
  ctx: RequirementContext,
): boolean {
  if (!expr) return true;
  switch (expr.kind) {
    case 'always':
      return true;
    case 'and':
      return expr.children.every((c) => evaluateRequirements(c, ctx));
    case 'or':
      return expr.children.some((c) => evaluateRequirements(c, ctx));
    case 'not':
      return !evaluateRequirements(expr.child, ctx);
    case 'has':
      return ctx.hasElement(expr.id);
    case 'atLeast':
      return ctx.statNumber(expr.stat) >= expr.value;
    case 'equals': {
      const tags = ctx.statTags?.(expr.stat);
      if (tags) return tags.has(expr.value);
      return (ctx.statString(expr.stat) ?? '').toLowerCase() === expr.value;
    }
    case 'flag':
      return ctx.hasFlag(expr.name);
  }
}

/** Every element id an expression mentions. Used to validate that content resolves. */
export function referencedIds(expr: RequirementExpr | undefined, into = new Set<string>()): Set<string> {
  if (!expr) return into;
  switch (expr.kind) {
    case 'has':
      into.add(expr.id);
      break;
    case 'and':
    case 'or':
      for (const c of expr.children) referencedIds(c, into);
      break;
    case 'not':
      referencedIds(expr.child, into);
      break;
    default:
      break;
  }
  return into;
}
