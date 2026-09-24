/**
 * Stat value expressions.
 *
 * A `<stat value="...">` is one of:
 *   - a number                       value="3"
 *   - a literal string               value="Fire"
 *   - a reference to another stat    value="charisma:modifier", value="level:ranger"
 *
 * Systems additionally declare *derived* stats with small arithmetic expressions
 * (5e's proficiency bonus is `2 + floor((level - 1) / 4)`). That is the same evaluator,
 * extended with operators. It is deliberately not a scripting language: no loops, no
 * calls other than a fixed function set, no I/O. Content comes from the internet.
 */

export type StatExpr =
  | { kind: 'number'; value: number }
  | { kind: 'literal'; value: string }
  | { kind: 'ref'; stat: string }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '%'; left: StatExpr; right: StatExpr }
  | { kind: 'call'; fn: 'floor' | 'ceil' | 'round' | 'min' | 'max' | 'abs'; args: StatExpr[] }
  /**
   * A number read out of a declared row, indexed by another expression — ADR 0018.
   *
   * Some published numbers are a table and have no closed form: 5e's multiclass spell slots
   * are twenty rows of nine, and every attempt to write them as arithmetic is a worse
   * description than the table itself. The index is floored and clamped to the array, so a
   * value below the row reads its first entry and one above reads its last.
   */
  | { kind: 'table'; index: StatExpr; values: number[] }
  /**
   * The sum of the character's recorded results matching a pattern, one per point of
   * progression — ADR 0019. `"hp:level:{n}"` at level 8 sums `hp:level:1` … `hp:level:8`.
   *
   * Reading only, and only what is recorded: core does not roll and must never learn how.
   * A roll is an input because it has no formula (ADR 0007), and an engine that could
   * produce one could silently reroll it.
   */
  | { kind: 'rolls'; pattern: string }
  /**
   * A setter read off the root element of the track being evaluated, as a number — ADR 0044.
   *
   * `as: "dieSides"` takes the face count of a `dN` value (`d8` is 8), the one parsing rule;
   * any other value, or none, reads 0. Only meaningful inside a `trackStats` value, where the
   * context knows a track; anywhere else it reads 0 and the engine reports a warning. Core names
   * no setter: a system says which one (5e's `hd`).
   */
  | { kind: 'setter'; name: string; as: 'dieSides' };

export interface ExpressionContext {
  statNumber(stat: string): number;
  statString(stat: string): string | undefined;
  /**
   * The sum of the recorded results matching a pattern, over the character's progression
   * (ADR 0019). Optional: a context with no character behind it — a bare evaluator in a
   * test, a validator checking that an expression parses — has no rolls to read and sums
   * nothing.
   */
  rollSum?(pattern: string): number;
  /**
   * The text of a setter on the element rooting the track being evaluated (ADR 0044). Only a
   * per-track context has one; everywhere else it is absent and a `setter` expression reads 0.
   */
  trackSetter?(name: string): string | undefined;
}

/** The face count of a `dN` die value, or 0 when the text is not one. */
export function dieSides(text: string | undefined): number {
  const match = /^d(\d+)$/i.exec((text ?? '').trim());
  return match ? Number(match[1]) : 0;
}

/** Whether an expression reads a setter — the one kind only a per-track context can answer. */
export function readsSetter(expr: StatExpr): boolean {
  switch (expr.kind) {
    case 'setter': return true;
    case 'binary': return readsSetter(expr.left) || readsSetter(expr.right);
    case 'call': return expr.args.some(readsSetter);
    case 'table': return readsSetter(expr.index);
    default: return false;
  }
}

/**
 * Parse the value of a content `<stat value="...">`.
 * Content values are never arithmetic in the Aurora corpus, so this stays simple:
 * a number, or a stat reference, or a literal.
 *
 * With one exception, and it is arithmetic only in the loosest sense: a reference may be
 * negated. `value="-warlock:spellcasting:slots:count"` is how the warlock's pact table takes
 * back the slots of the previous tier, and reading it as a reference to a stat *named* with a
 * leading minus resolves it to zero — so nothing is taken back and a warlock ends up with
 * every tier of slots at once. Eight values in the corpus depend on this, all of them that
 * one table.
 */
export function parseStatValue(raw: string): StatExpr {
  const text = raw.trim();
  const asNumber = Number(text);
  if (text !== '' && Number.isFinite(asNumber)) return { kind: 'number', value: asNumber };
  if (text.startsWith('-') && looksLikeStatRef(text.slice(1).trim())) {
    return {
      kind: 'binary',
      op: '-',
      left: { kind: 'number', value: 0 },
      right: { kind: 'ref', stat: text.slice(1).trim().toLowerCase() },
    };
  }
  if (looksLikeStatRef(text)) return { kind: 'ref', stat: text.toLowerCase() };
  return { kind: 'literal', value: text };
}

/**
 * Stat references are lowercase words and spaces separated by ':' — "charisma:modifier",
 * "innate speed", "companion:hp:max". A literal like "Fire" or "1d6 fire damage" is not.
 * The heuristic: a reference contains no uppercase-led sentence and no digits-with-letters.
 */
function looksLikeStatRef(text: string): boolean {
  if (text.includes(':')) return true;
  return /^[a-z][a-z \-]*$/.test(text);
}

/**
 * A stat's number, reading a `:half` or `:half:up` suffix as "half of this" — ADR 0046.
 *
 * `level:paladin:half` and `proficiency:half:up` used to name a stat nothing publishes and resolve to
 * zero; the corpus has 61 of them (Jack of All Trades' bonus, a Paladin's and an Artificer's prepared-spell
 * limit). Five of those limits are checked against Aurora's own screen and all five read `:half` as
 * rounding down.
 *
 * Read **here, when a reference is evaluated**, and not where a value is parsed, for a reason that is about
 * stored copies: a `.incu` embeds the *parsed* elements it uses (ADR 0012), so a reading at parse time
 * would leave every character saved before this reading a Paladin's limit of zero until it was saved again.
 * Evaluating applies the same rule to a fresh parse and to an embedded one.
 *
 * Arithmetic and no game noun: the base is whatever content wrote. A stat that really is published under
 * the suffixed name wins by being non-zero, so nothing that declares one is overridden.
 */
function statNumber(stat: string, ctx: ExpressionContext): number {
  const direct = ctx.statNumber(stat);
  if (direct !== 0) return direct;
  const lower = stat.toLowerCase();
  const up = lower.endsWith(':half:up');
  if (!up && !lower.endsWith(':half')) return direct;
  const base = lower.slice(0, lower.length - (up ? ':half:up' : ':half').length).trim();
  if (base === '') return direct;
  const half = ctx.statNumber(base) / 2;
  return up ? Math.ceil(half) : Math.floor(half);
}

export function evaluateExpr(expr: StatExpr, ctx: ExpressionContext): number {
  switch (expr.kind) {
    case 'number':
      return expr.value;
    case 'literal': {
      const n = Number(expr.value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'ref':
      return statNumber(expr.stat, ctx);
    case 'binary': {
      const l = evaluateExpr(expr.left, ctx);
      const r = evaluateExpr(expr.right, ctx);
      switch (expr.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? 0 : l / r;
        case '%': return r === 0 ? 0 : l % r;
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'rolls':
      return ctx.rollSum?.(expr.pattern) ?? 0;
    case 'setter':
      return dieSides(ctx.trackSetter?.(expr.name));
    case 'table': {
      if (!expr.values.length) return 0;
      const raw = Math.floor(evaluateExpr(expr.index, ctx));
      const at = Math.min(Math.max(Number.isFinite(raw) ? raw : 0, 0), expr.values.length - 1);
      return expr.values[at] ?? 0;
    }
    case 'call': {
      const args = expr.args.map((a) => evaluateExpr(a, ctx));
      switch (expr.fn) {
        case 'floor': return Math.floor(args[0] ?? 0);
        case 'ceil': return Math.ceil(args[0] ?? 0);
        case 'round': return Math.round(args[0] ?? 0);
        case 'abs': return Math.abs(args[0] ?? 0);
        case 'min': return args.length ? Math.min(...args) : 0;
        case 'max': return args.length ? Math.max(...args) : 0;
      }
    }
  }
}

/** The display form of a stat value, for stats that hold text rather than numbers. */
export function evaluateExprAsString(expr: StatExpr, ctx: ExpressionContext): string {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'ref':
      return ctx.statString(expr.stat) ?? String(statNumber(expr.stat, ctx));
    default:
      return String(evaluateExpr(expr, ctx));
  }
}
