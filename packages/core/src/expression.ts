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
  | { kind: 'call'; fn: 'floor' | 'ceil' | 'round' | 'min' | 'max' | 'abs'; args: StatExpr[] };

export interface ExpressionContext {
  statNumber(stat: string): number;
  statString(stat: string): string | undefined;
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

export function evaluateExpr(expr: StatExpr, ctx: ExpressionContext): number {
  switch (expr.kind) {
    case 'number':
      return expr.value;
    case 'literal': {
      const n = Number(expr.value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'ref':
      return ctx.statNumber(expr.stat);
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
      return ctx.statString(expr.stat) ?? String(ctx.statNumber(expr.stat));
    default:
      return String(evaluateExpr(expr, ctx));
  }
}
