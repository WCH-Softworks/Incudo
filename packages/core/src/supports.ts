/**
 * The `supports` filter language used by `<select supports="...">`.
 *
 *   "Skill"                    -> must carry the tag "Skill"
 *   "Skill,Rogue"              -> must carry both              (AND)
 *   "Standard||Exotic"         -> must carry either            (OR)
 *   "ID_A|ID_B"                -> bare element ids are legal operands too
 *   "$(spellcasting:list), 0"  -> $(...) interpolates a context value before matching
 *
 * The `$(...)` form is the ugliest corner of the Aurora format and the usual place a
 * naive importer breaks: the filter is not knowable until the character is being built,
 * because it depends on which spellcasting block the select belongs to. So the parsed
 * form keeps interpolations as nodes and resolves them at evaluation time.
 */

export type SupportsExpr =
  | { kind: 'and'; children: SupportsExpr[] }
  | { kind: 'or'; children: SupportsExpr[] }
  | { kind: 'tag'; tag: string }
  | { kind: 'interpolate'; key: string };

export function parseSupports(input: string | undefined | null): SupportsExpr | undefined {
  if (input == null) return undefined;
  const text = input.trim();
  if (text === '') return undefined;

  const andParts = splitTopLevel(text, ',');
  const andChildren = andParts.map(parseOrGroup).filter((x): x is SupportsExpr => x !== undefined);
  if (andChildren.length === 0) return undefined;
  return andChildren.length === 1 ? andChildren[0]! : { kind: 'and', children: andChildren };
}

function parseOrGroup(text: string): SupportsExpr | undefined {
  const parts = splitTopLevel(text, '|').filter((p) => p.trim() !== '');
  const children = parts.map(parseAtom);
  if (children.length === 0) return undefined;
  return children.length === 1 ? children[0]! : { kind: 'or', children };
}

function parseAtom(text: string): SupportsExpr {
  const t = text.trim();
  const interp = /^\$\((.+)\)$/.exec(t);
  if (interp) return { kind: 'interpolate', key: interp[1]!.trim().toLowerCase() };
  return { kind: 'tag', tag: t };
}

/** Split on a separator, ignoring separators inside `$(...)`. Collapses `||` into `|`. */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '$' && text[i + 1] === '(') {
      depth++;
      current += '$(';
      i++;
      continue;
    }
    if (ch === ')' && depth > 0) {
      depth--;
      current += ch;
      continue;
    }
    if (depth === 0 && ch === sep) {
      // treat "||" as a single separator
      if (sep === '|' && text[i + 1] === '|') i++;
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

export interface SupportsContext {
  /** Tags carried by the candidate element, lowercased. */
  tags: ReadonlySet<string>;
  /** The candidate's own id, so bare-id operands work. */
  id: string;
  /** Resolves `$(key)` to a concrete tag, or undefined when unknown. */
  resolve(key: string): string | undefined;
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

export function matchesSupports(expr: SupportsExpr | undefined, ctx: SupportsContext): boolean {
  if (!expr) return true;
  switch (expr.kind) {
    case 'and':
      return expr.children.every((c) => matchesSupports(c, ctx));
    case 'or':
      return expr.children.some((c) => matchesSupports(c, ctx));
    case 'tag':
      return ctx.tags.has(expr.tag.toLowerCase()) || ctx.id === expr.tag;
    case 'interpolate': {
      const resolved = ctx.resolve(expr.key);
      // An unresolved interpolation must not silently match everything.
      if (resolved === undefined) return false;
      return ctx.tags.has(resolved.toLowerCase()) || ctx.id === resolved;
    }
  }
}
