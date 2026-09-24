/**
 * The `supports` filter language used by `<select supports="...">`.
 *
 *   "Skill"                      -> must carry the tag "Skill"
 *   "Skill,Rogue"                -> must carry both                        (AND)
 *   "Standard||Exotic"           -> must carry either                      (OR)
 *   "1,(Druid||Wizard)"          -> parentheses group                      (ADR 0030)
 *   "1,Wizard||Arms of Hadar"    -> `,` binds tighter than `||`            (ADR 0030)
 *   "ID_A|ID_B"                  -> bare element ids are legal operands too
 *   "0"                          -> a setter's value is an operand too     (ADR 0030)
 *   "$(spellcasting:list), 0"    -> $(...) expands to a sub-expression before matching
 *   "Artificer Infusion, !TCOE Base" -> a leading `!` on an operand negates it   (ADR 0048)
 *
 * The `$(...)` form is the ugliest corner of the Aurora format and the usual place a
 * naive importer breaks: the filter is not knowable until the character is being built,
 * because it depends on which declared block the select belongs to and on what the
 * derivation published for it. So the parsed form keeps interpolations as nodes and
 * resolves them at evaluation time — see `blockFilters` in `system.ts` for who supplies
 * the expansion, and ADR 0030 for why it is the system definition and not this file.
 *
 * Three things here were measured against the 740-file AuroraLegacy corpus rather than
 * read off the format, and all three were wrong before ADR 0030:
 *
 *  - **`||` is the looser operator.** `"1,(Divination||Enchantment),(Sorcerer||Warlock||
 *    Wizard)||Arms of Hadar"` reads "a 1st-level div/ench sorcerer/warlock/wizard spell, *or*
 *    Arms of Hadar" — and content proves it, by appending a bespoke `<supports>Arms of
 *    Hadar</supports>` tag to that one spell for the operand to find. Arms of Hadar is a
 *    Conjuration, so under the other precedence the school clause would exclude the very
 *    spell the clause was written to add. Same reading as `requirements`, where
 *    `parseRequirements` has always had it right.
 *  - **Parentheses group.** 131 `supports=` attributes in the corpus contain a bare `(`,
 *    and none of them parsed. Note the asymmetry with element-level `<supports>`, which is
 *    a comma-separated list of *literal* tags where a paren is just a character —
 *    `Fighter (Eldritch Knight)` is one tag, and 16 elements carry one like it. A filter
 *    naming such a tag could not be written in this language; the corpus contains no
 *    attempt to (measured: zero `supports=` operands have a `(` after a word character).
 *  - **An operand may name a setter's value.** A spell's level and school are setters, not
 *    tags, so `"$(spellcasting:list), 0"` can never match a cantrip on tags alone. This is
 *    unconditional across every setter rather than narrowed to a list of names, because
 *    narrowing would be a guess and the corpus says it buys nothing: over operands 0–9,
 *    matching any setter and matching only `level` select exactly the same spells.
 */

export type SupportsExpr =
  | { kind: 'and'; children: SupportsExpr[] }
  | { kind: 'or'; children: SupportsExpr[] }
  | { kind: 'tag'; tag: string }
  | { kind: 'interpolate'; key: string };

/**
 * How deep a resolved interpolation may nest before it is treated as unresolved.
 *
 * An expansion comes from a system definition, and a system definition comes from the
 * internet (ADR 0011), so `$(a)` expanding to something containing `$(a)` is reachable.
 * Same reasoning as the engine's `MAX_PASSES`: cap it rather than hang the UI.
 */
const MAX_INTERPOLATION_DEPTH = 8;

export function parseSupports(input: string | undefined | null): SupportsExpr | undefined {
  if (input == null) return undefined;
  const text = input.trim();
  if (text === '') return undefined;
  return parseOrGroup(text, 0)[0];
}

/** `or := and ( "|" "|"? and )*` — the loosest binding. */
function parseOrGroup(text: string, at: number): [SupportsExpr | undefined, number] {
  const children: SupportsExpr[] = [];
  let [first, position] = parseAndGroup(text, at);
  if (first) children.push(first);
  while (position < text.length && text[position] === '|') {
    position++;
    // "||" and "|" are the same separator; the corpus writes both.
    if (text[position] === '|') position++;
    const [child, next] = parseAndGroup(text, position);
    if (child) children.push(child);
    position = next;
  }
  return [collapse('or', children), position];
}

/** `and := atom ( "," atom )*` */
function parseAndGroup(text: string, at: number): [SupportsExpr | undefined, number] {
  const children: SupportsExpr[] = [];
  let [first, position] = parseAtom(text, at);
  if (first) children.push(first);
  while (position < text.length && text[position] === ',') {
    position++;
    const [child, next] = parseAtom(text, position);
    if (child) children.push(child);
    position = next;
  }
  return [collapse('and', children), position];
}

/** `atom := "$(" key ")" | "(" or ")" | tag` */
function parseAtom(text: string, at: number): [SupportsExpr | undefined, number] {
  let position = at;
  while (position < text.length && /\s/.test(text[position]!)) position++;

  if (text[position] === '$' && text[position + 1] === '(') {
    position += 2;
    const start = position;
    let depth = 1;
    while (position < text.length && depth > 0) {
      if (text[position] === '(') depth++;
      else if (text[position] === ')') {
        depth--;
        if (depth === 0) break;
      }
      position++;
    }
    const key = text.slice(start, position).trim().toLowerCase();
    // Skip the closing paren when there was one; an unterminated `$(` runs to the end.
    if (text[position] === ')') position++;
    return [key === '' ? undefined : { kind: 'interpolate', key }, position];
  }

  if (text[position] === '(') {
    const [group, next] = parseOrGroup(text, position + 1);
    // A missing `)` is malformed content, not a reason to lose the rest of the filter.
    return [group, text[next] === ')' ? next + 1 : next];
  }

  const start = position;
  while (position < text.length && !isSeparator(text[position]!)) position++;
  const tag = text.slice(start, position).trim();
  return [tag === '' ? undefined : { kind: 'tag', tag }, position];
}

function isSeparator(ch: string): boolean {
  return ch === ',' || ch === '|' || ch === ')';
}

function collapse(kind: 'and' | 'or', children: SupportsExpr[]): SupportsExpr | undefined {
  if (children.length === 0) return undefined;
  return children.length === 1 ? children[0]! : { kind, children };
}

/**
 * An expression that matches nothing, and the shape a resolved-but-empty expansion takes.
 *
 * Distinct from `undefined`, which means *unresolved*. A level 1 paladin has no spell slots,
 * so `$(spellcasting:slots)` legitimately expands to no tags at all; reporting that as a
 * filter Incudo cannot evaluate would be the wrong sentence on screen, and it is exactly the
 * confusion `supportsInterpolations` exists to prevent.
 */
export const NEVER_MATCHES: SupportsExpr = { kind: 'or', children: [] };

export interface SupportsContext {
  /** Tags carried by the candidate element, lowercased. */
  tags: ReadonlySet<string>;
  /**
   * The candidate's setter *values*, lowercased.
   *
   * A spell's level and school live here, not in `tags`, which is why a levelled select
   * matched nothing before ADR 0030. Values rather than `name=value` pairs because that is
   * all the filter language can express: `"0"` says nothing about which setter it means.
   */
  setterValues?: ReadonlySet<string>;
  /** The candidate's own id, so bare-id operands work. */
  id: string;
  /**
   * Expands `$(key)` into a sub-expression, or `undefined` when nothing resolves it.
   *
   * An expression rather than a tag because neither of the corpus's two keys is one tag.
   * `$(spellcasting:list)` is `Wizard,(Abjuration||Evocation)` for an Eldritch Knight — an
   * AND over a nested OR — and `$(spellcasting:slots)` is "any level you have slots for",
   * which is an OR whose width changes as the character levels.
   */
  resolve(key: string): SupportsExpr | undefined;
}

/**
 * The `$(key)` interpolations an expression contains, in order, deduplicated.
 *
 * Exists so a builder can tell "nothing in your content matches this filter" from "Incudo
 * cannot evaluate this filter yet" — two sentences that look identical on screen and mean
 * completely different things. An unresolved interpolation matches nothing (below), so a
 * select carrying one silently offers an empty list, and that emptiness is indistinguishable
 * from a missing content source. It cost one wrong diagnosis already.
 */
export function supportsInterpolations(
  expr: SupportsExpr | undefined,
  into = new Set<string>(),
): Set<string> {
  if (!expr) return into;
  switch (expr.kind) {
    case 'interpolate':
      into.add(expr.key);
      break;
    case 'and':
    case 'or':
      for (const child of expr.children) supportsInterpolations(child, into);
      break;
    default:
      break;
  }
  return into;
}

/** Whether the candidate answers to one operand: a tag, its own id, or the value of one of its setters. */
function hasOperand(operand: string, ctx: SupportsContext): boolean {
  const tag = operand.toLowerCase();
  return ctx.tags.has(tag) || ctx.id === operand || (ctx.setterValues?.has(tag) ?? false);
}

export function matchesSupports(
  expr: SupportsExpr | undefined,
  ctx: SupportsContext,
  depth = 0,
): boolean {
  if (!expr) return true;
  switch (expr.kind) {
    case 'and':
      return expr.children.every((c) => matchesSupports(c, ctx, depth));
    case 'or':
      return expr.children.some((c) => matchesSupports(c, ctx, depth));
    case 'tag': {
      // A leading `!` negates one operand — ADR 0048. Read here and not in the parser, on purpose: a `.incu`
      // embeds *parsed* elements, so a parse-time reading would leave every character saved before it with the
      // literal tag `!TCOE Base` that nothing carries (the same reason `:half` is read where a reference is
      // evaluated, ADR 0046). A lone `!` is still a literal tag.
      if (expr.tag.length > 1 && expr.tag.startsWith('!')) {
        return !hasOperand(expr.tag.slice(1).trim(), ctx);
      }
      return hasOperand(expr.tag, ctx);
    }
    case 'interpolate': {
      if (depth >= MAX_INTERPOLATION_DEPTH) return false;
      const resolved = ctx.resolve(expr.key);
      // An unresolved interpolation must not silently match everything.
      if (resolved === undefined) return false;
      return matchesSupports(resolved, ctx, depth + 1);
    }
  }
}
