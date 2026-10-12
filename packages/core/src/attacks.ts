/**
 * A character's attacks — ADR 0093.
 *
 * An attack is a bag entry of a type the kind names, carried or equipped, as Aurora's sheet lists one and a printed sheet's
 * attack rows are written. Its numbers are the kind's `attacks.stats`, contributions evaluated once per attack after the
 * derivation's fixed point, in a scope of their own: the attack's tags (its element's and its adornments' support tags and
 * names) are published under the kind's `tagStat`, `{name}` and `{<setter>}` are filled from the attack's element, and a
 * `setter` expression reads the element and its adornments. Everything else reads the character. No stat of the character
 * moves.
 *
 * Its die, damage type, other dice, range and properties are read off the element as content writes them and parsed not
 * at all (ADR 0005): "1d8", "slashing", "150/600". Core names no ability, property or kind of weapon: the system says
 * all of them.
 */

import type { Character, InventoryEntry } from './character.ts';
import { evaluateExpr, type ExpressionContext, type StatExpr } from './expression.ts';
import type { Element, ElementId, ElementIndex, StatKey } from './model.ts';
import { evaluateRequirements, parseRequirements, type RequirementContext, type RequirementExpr } from './requirements.ts';
import type { AttacksDef, AttackStatDef, InnateAttackDef, InventoryDef } from './system.ts';

/** One attack, with everything a sheet writes of it. */
export interface DerivedAttack {
  /** The bag entry it is; absent for a row the kind always has (ADR 0110). */
  instanceId?: string;
  /** Absent for a row the kind always has. */
  elementId?: ElementId;
  /** A row the kind always has, no item giving it: an unarmed strike (ADR 0110). */
  innate?: true;
  /** The user's name for the entry, else an adornment's naming setter, else the element's name. */
  name: string;
  equipped: boolean;
  /** The attack stat the kind shows as its bonus. */
  bonus: number;
  /** The attack stat added to its die. */
  damageBonus: number;
  /** Its damage die as content writes it, when the element carries one. */
  dice?: string;
  damageType?: string;
  /**
   * Other ways it may be rolled: a versatile weapon's two-handed die, with the same modifier; or a variant of the attack
   * (ADR 0110), its own die and its own `damageBonus` (an off-hand attack's, with no positive ability modifier).
   */
  alternatives: Array<{ label: string; dice: string; damageBonus?: number }>;
  range?: string;
  /** What it is, by name, in order of name. */
  properties: string[];
  /** Every attack stat its contributions summed, lowercased keys. */
  stats: Record<StatKey, number>;
}

/** What an attack's scope reads of the finished derivation: the character's own context, its slots' tags included. */
export interface AttackReader extends RequirementContext, ExpressionContext {}

/** Parsed conditions, by the text after its placeholders are filled. A text that will not parse never holds. */
const conditions = new Map<string, RequirementExpr | undefined>();
const NEVER: RequirementExpr = { kind: 'not', child: { kind: 'always' } };

function condition(text: string): RequirementExpr | undefined {
  if (conditions.has(text)) return conditions.get(text);
  let expr: RequirementExpr | undefined;
  try {
    expr = parseRequirements(text);
  } catch {
    expr = NEVER;
  }
  conditions.set(text, expr);
  return expr;
}

/**
 * `{name}` and `{<setter>}` filled from an element: its name, or a setter's value, trimmed; `lower` for a stat key.
 * Undefined when a placeholder names nothing the element answers, which drops the contribution, as an unanswered block
 * placeholder does (ADR 0020).
 */
export function fillAttackPlaceholders(text: string, element: Element, lower: boolean): string | undefined {
  let missing = false;
  const out = text.replace(/\{([^{}]*)\}/g, (_match, key: string) => {
    const name = key.trim().toLowerCase();
    const value = name === 'name' ? element.name : element.setters[name]?.value;
    if (value === undefined || value.trim() === '') {
      missing = true;
      return '';
    }
    return lower ? value.trim().toLowerCase() : value.trim();
  });
  return missing ? undefined : out;
}

/** The same expression with every reference's placeholders filled, or undefined when one names nothing. */
function fillExpr(expr: StatExpr, element: Element): StatExpr | undefined {
  switch (expr.kind) {
    case 'ref': {
      const stat = fillAttackPlaceholders(expr.stat, element, true);
      return stat === undefined ? undefined : { kind: 'ref', stat };
    }
    case 'binary': {
      const left = fillExpr(expr.left, element);
      const right = fillExpr(expr.right, element);
      return left && right ? { ...expr, left, right } : undefined;
    }
    case 'call': {
      const args = expr.args.map((arg) => fillExpr(arg, element));
      return args.every((arg): arg is StatExpr => arg !== undefined) ? { ...expr, args } : undefined;
    }
    case 'table': {
      const index = fillExpr(expr.index, element);
      return index ? { ...expr, index } : undefined;
    }
    default:
      return expr;
  }
}

/**
 * The elements an entry is read through: its own, then each adornment's whose rules apply. An adornment needing
 * attunement on an entry that is not attuned is left out (ADR 0023), carried or equipped, so an unattuned +3 sword is a
 * sword.
 */
function entryElements(entry: InventoryEntry, element: Element, index: ElementIndex, inventory: InventoryDef | undefined): Element[] {
  const attunement = inventory?.attunement;
  const requires = attunement?.requires.trim().toLowerCase();
  const adornments = (entry.adorners ?? []).flatMap((a) => {
    const adornment = index.get(a.elementId);
    if (!adornment) return [];
    const needs = attunement !== undefined && adornment.setters[attunement.setter]?.value.trim().toLowerCase() === requires;
    return needs && !entry.attuned ? [] : [adornment];
  });
  return [element, ...adornments];
}

/**
 * An adornment's naming setter filled (`{{parent}}`, `{{setter}}`), or undefined when it names nothing it answers. The
 * inventory editor names an adorned entry with it too (ADR 0098).
 */
export function adornedName(template: string, parent: Element, adornment: Element): string | undefined {
  let missing = false;
  const out = template.replace(/\{\{([^{}]*)\}\}/g, (_match, key: string) => {
    const name = key.trim().toLowerCase();
    const value = name === 'parent' ? parent.name : adornment.setters[name]?.value;
    if (value === undefined || value.trim() === '') {
      missing = true;
      return '';
    }
    return value.trim();
  });
  return missing || out.trim() === '' ? undefined : out.trim();
}

function attackName(entry: InventoryEntry, element: Element, read: readonly Element[], def: AttacksDef): string {
  const own = entry.name?.trim();
  if (own) return own;
  if (def.nameSetter) {
    for (const adornment of read.slice(1)) {
      const template = adornment.setters[def.nameSetter]?.value;
      const named = template ? adornedName(template, element, adornment) : undefined;
      if (named) return named;
    }
  }
  return element.name;
}

function propertiesOf(read: readonly Element[], def: AttacksDef, index: ElementIndex): string[] {
  const types = new Set(def.properties?.types ?? []);
  const labels = new Map(Object.entries(def.properties?.labels ?? {}).map(([tag, label]) => [tag.toLowerCase(), label]));
  const names = new Set<string>();
  for (const element of read) {
    for (const tag of element.supports) {
      const named = index.get(tag.trim());
      if (named && types.has(named.type)) names.add(named.name);
      else {
        const label = labels.get(tag.trim().toLowerCase());
        if (label !== undefined) names.add(label);
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * The character's attacks, in bag order, against a finished derivation (`reader`). Empty for a kind that declares none.
 * An entry naming an element no index holds is not an attack: the derivation already reports it unresolved.
 */
export function deriveAttacks(
  character: Character,
  index: ElementIndex,
  def: AttacksDef | undefined,
  reader: AttackReader,
  inventory: InventoryDef | undefined,
): DerivedAttack[] {
  if (!def) return [];
  const types = new Set(def.types);
  const tagKey = def.tagStat.trim().toLowerCase();
  const attacks: DerivedAttack[] = [];
  for (const entry of character.inventory ?? []) {
    const element = index.get(entry.elementId);
    if (!element || !types.has(element.type)) continue;
    const read = entryElements(entry, element, index, inventory);
    const tags = new Set<string>();
    for (const e of read) {
      tags.add(e.name.trim().toLowerCase());
      for (const tag of e.supports) tags.add(tag.trim().toLowerCase());
    }
    const own = new Map<StatKey, number>();
    const scope: AttackReader = {
      ...reader,
      hasElement: (id) => reader.hasElement(id),
      statNumber: (stat) => own.get(stat.toLowerCase()) ?? reader.statNumber(stat),
      statString: (stat) => reader.statString(stat),
      statTags: (stat) => (stat.toLowerCase() === tagKey ? tags : reader.statTags?.(stat)),
      hasFlag: (name) => reader.hasFlag(name),
      setterValues: (name) => read.flatMap((e) => (e.setters[name] !== undefined ? [e.setters[name]!.value] : [])),
    };
    for (const contribution of def.stats) addContribution(contribution, element, scope, own);
    const setter = (name: string | undefined): string | undefined => {
      const value = name ? element.setters[name]?.value.trim() : undefined;
      return value ? value : undefined;
    };
    const dice = setter(def.dice);
    const damageType = def.damageType ? element.setters[def.dice]?.attrs?.[def.damageType]?.trim() : undefined;
    // A range the element writes, else the first reach whose condition holds (ADR 0110): a melee weapon writes none.
    const range = setter(def.range) ?? (def.reach ?? []).find((r) => holds(r.requirements, element, scope))?.text;
    // A variant is a way to swing what is held: a carried weapon has none.
    const variants = dice === undefined || entry.equipped !== true ? [] : (def.variants ?? []).filter((v) => holds(v.requirements, element, scope));
    attacks.push({
      instanceId: entry.instanceId,
      elementId: element.id,
      name: attackName(entry, element, read, def),
      equipped: entry.equipped === true,
      bonus: own.get(def.bonus.toLowerCase()) ?? 0,
      damageBonus: own.get(def.damage.toLowerCase()) ?? 0,
      ...(dice !== undefined ? { dice } : {}),
      ...(damageType ? { damageType } : {}),
      alternatives: [
        ...(def.alternatives ?? []).flatMap((alternative) => {
          const other = setter(alternative.setter);
          return other !== undefined ? [{ label: alternative.label, dice: other }] : [];
        }),
        ...variants.map((variant) => ({ label: variant.label, dice: dice!, damageBonus: own.get(variant.damage.toLowerCase()) ?? 0 })),
      ],
      ...(range !== undefined ? { range } : {}),
      properties: propertiesOf(read, def, index),
      stats: Object.fromEntries(own),
    });
  }
  for (const innate of def.innate ?? []) attacks.push(innateAttack(innate, def, reader));
  return attacks;
}

/**
 * A row the kind always has (ADR 0110): its own contributions, `{name}` its name, no element or setter to read, its die's
 * sides worked out against the character.
 */
function innateAttack(innate: InnateAttackDef, def: AttacksDef, reader: AttackReader): DerivedAttack {
  const self: Element = { id: '', type: '', name: innate.name, source: '', setters: {}, rules: [], supports: [], origin: { sourceId: '', format: 'incudo' } };
  const own = new Map<StatKey, number>();
  const scope: AttackReader = {
    ...reader,
    hasElement: (id) => reader.hasElement(id),
    statNumber: (stat) => own.get(stat.toLowerCase()) ?? reader.statNumber(stat),
    statString: (stat) => reader.statString(stat),
    statTags: (stat) => reader.statTags?.(stat),
    hasFlag: (name) => reader.hasFlag(name),
    setterValues: () => [],
  };
  for (const contribution of innate.stats) addContribution(contribution, self, scope, own);
  const sides = innate.sides ? Math.floor(evaluateExpr(innate.sides, scope)) : 0;
  return {
    innate: true,
    name: innate.name,
    equipped: true,
    bonus: own.get(def.bonus.toLowerCase()) ?? 0,
    damageBonus: own.get(def.damage.toLowerCase()) ?? 0,
    ...(sides > 0 ? { dice: `1d${sides}` } : innate.flat ? { dice: innate.flat } : {}),
    ...(innate.damageType ? { damageType: innate.damageType } : {}),
    alternatives: [],
    ...(innate.range ? { range: innate.range } : {}),
    properties: [...(innate.properties ?? [])],
    stats: Object.fromEntries(own),
  };
}

/** A condition read in an attack's scope, its placeholders filled from the element; none always holds. */
function holds(requirements: string | undefined, element: Element, scope: AttackReader): boolean {
  if (requirements === undefined) return true;
  const text = fillAttackPlaceholders(requirements, element, false);
  return text !== undefined && evaluateRequirements(condition(text), scope);
}

function addContribution(contribution: AttackStatDef, element: Element, scope: AttackReader, own: Map<StatKey, number>): void {
  if (contribution.requirements !== undefined) {
    const text = fillAttackPlaceholders(contribution.requirements, element, false);
    if (text === undefined || !evaluateRequirements(condition(text), scope)) return;
  }
  const value = fillExpr(contribution.value, element);
  if (value === undefined) return;
  const key = contribution.stat.trim().toLowerCase();
  own.set(key, (own.get(key) ?? 0) + evaluateExpr(value, scope));
}
