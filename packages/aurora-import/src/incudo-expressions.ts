/**
 * What Aurora's app read into its expressions at run time, written down as Incudo's own — ADR 0119 decision 3.
 *
 * Each of these used to be read by the engine where an expression was evaluated, so a save that embedded the parsed
 * element read it too (ADR 0046's reason). The converter writes them once instead, and the engine knows none of them:
 *
 *  - **`:half` and `:half:up`** on a stat reference (`level:paladin:half`, 61 in the corpus): half the stat, rounded down
 *    or up, written as `floor(level:paladin / 2)` or `ceil(...)`. Five of these are prepared-spell limits Aurora's own
 *    screen showed, and all five round down.
 *  - **`[character:N]`** in a requirement (55): Aurora's name for the character's level, written as the requirement on
 *    `level` Incudo's 5e definition publishes, where 5e had to declare a `character` stat to answer it.
 *  - **`isRitual`** on a spell (69): Aurora's app offers such a spell to a filter naming `Ritual`, so the converter gives it
 *    that support tag, where 5e declared a `setterTags` pair to say so.
 *
 * Each walks the parsed tree and changes nothing else.
 */

import type { Element, ElementExtension, RequirementExpr, Rule, StatExpr } from '@incudo/core';

/** Aurora's name for the character's level in a requirement, and the stat Incudo's 5e definition publishes it as. */
const CHARACTER_LEVEL = 'character';
const LEVEL = 'level';
/** The setter that marks a ritual, and the tag Aurora's app read it as. */
const RITUAL_SETTER = 'isRitual';
const RITUAL_TAG = 'Ritual';

function halved(stat: string): StatExpr | undefined {
  const lower = stat.toLowerCase();
  const up = lower.endsWith(':half:up');
  if (!up && !lower.endsWith(':half')) return undefined;
  const base = stat.slice(0, stat.length - (up ? ':half:up' : ':half').length).trim();
  if (!base) return undefined;
  return {
    kind: 'call',
    fn: up ? 'ceil' : 'floor',
    args: [{ kind: 'binary', op: '/', left: { kind: 'ref', stat: base }, right: { kind: 'number', value: 2 } }],
  };
}

/** A stat expression with every `:half` reference written as the arithmetic it means. */
export function withoutHalves(expr: StatExpr): StatExpr {
  switch (expr.kind) {
    case 'ref':
      return halved(expr.stat) ?? expr;
    case 'binary':
      return { ...expr, left: withoutHalves(expr.left), right: withoutHalves(expr.right) };
    case 'call':
      return { ...expr, args: expr.args.map(withoutHalves) };
    case 'table':
      return { ...expr, index: withoutHalves(expr.index) };
    default:
      return expr;
  }
}

/** A requirement with `[character:N]` written as the level it means. */
export function withLevels(expr: RequirementExpr): RequirementExpr {
  switch (expr.kind) {
    case 'and':
    case 'or':
      return { ...expr, children: expr.children.map(withLevels) };
    case 'not':
      return { ...expr, child: withLevels(expr.child) };
    case 'atLeast':
    case 'equals':
      return expr.stat.toLowerCase() === CHARACTER_LEVEL ? { ...expr, stat: LEVEL } : expr;
    default:
      return expr;
  }
}

function ruleInIncudo(rule: Rule): Rule {
  const out: Rule = { ...rule };
  if (out.requirements) out.requirements = withLevels(out.requirements);
  if ((out.kind === 'stat' || out.kind === 'grant') && out.equipped) out.equipped = withLevels(out.equipped);
  if (out.kind === 'stat') out.value = withoutHalves(out.value);
  return out;
}

/** An element as Incudo reads it: its rules', requirements' and tags' Aurora spellings written as Incudo's. */
export function incudoElement(element: Element): Element {
  const out: Element = { ...element, rules: element.rules.map(ruleInIncudo) };
  if (element.requirements) out.requirements = withLevels(element.requirements);
  if (element.multiclass) {
    out.multiclass = {
      ...element.multiclass,
      rules: element.multiclass.rules.map(ruleInIncudo),
      ...(element.multiclass.requirements ? { requirements: withLevels(element.multiclass.requirements) } : {}),
    };
  }
  const ritual = element.setters[RITUAL_SETTER]?.value.trim().toLowerCase() === 'true';
  if (ritual && !element.supports.some((tag) => tag.toLowerCase() === RITUAL_TAG.toLowerCase())) {
    out.supports = [...element.supports, RITUAL_TAG];
  }
  return out;
}

/** An extension as Incudo reads it, as an element's rules are. */
export function incudoExtension(extension: ElementExtension): ElementExtension {
  return { ...extension, rules: extension.rules.map(ruleInIncudo) };
}
