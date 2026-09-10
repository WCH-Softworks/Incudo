/**
 * The content model.
 *
 * Everything a game system can express is an Element carrying Rules. There is no
 * `Spell` interface and no `Class` interface — a spell's level lives in `setters.level`.
 * That looks lossy and is deliberate: the moment this file knows what a spell is, it
 * knows what D&D is, and the second game system becomes a rewrite. See docs/adr/0003.
 */

import type { RequirementExpr } from './requirements.ts';
import type { SupportsExpr } from './supports.ts';
import type { StatExpr } from './expression.ts';

export type ElementId = string;

/** An element type name, e.g. "Race", "Class Feature", "Spell". Declared by the GameSystem. */
export type ElementType = string;

/** A namespaced stat key, e.g. "ac:armored:enhancement", "level:rogue". */
export type StatKey = string;

export interface Setter {
  value: string;
  /** Aurora carries extra attributes on <set> (currency, lb, addition, modifier, ...). */
  attrs?: Record<string, string>;
}

export type Rule = GrantRule | SelectRule | StatRule | SupportsRule;

export interface RuleBase {
  /** Stable identity for this rule within its element; used to key user choices. */
  key: string;
  requirements?: RequirementExpr;
  /** Only applies at or above this level of the granting progression. */
  level?: number;
}

/** Give the character another element. */
export interface GrantRule extends RuleBase {
  kind: 'grant';
  type: ElementType;
  id: ElementId;
  /** Attach to a named spellcasting block (system-defined meaning). */
  spellcasting?: string;
  prepared?: boolean;
  equipped?: boolean;
  allowReplace?: boolean;
  /** Aurora allows overriding the displayed name of a granted element. */
  name?: string;
}

/** The character must choose `number` elements matching the filter. */
export interface SelectRule extends RuleBase {
  kind: 'select';
  type: ElementType;
  name: string;
  supports?: SupportsExpr;
  number: number;
  optional?: boolean;
  default?: ElementId;
  spellcasting?: string;
  prepared?: boolean;
  allowReplace?: boolean;
}

/** Contribute to a named stat. */
export interface StatRule extends RuleBase {
  kind: 'stat';
  name: StatKey;
  value: StatExpr;
  /**
   * Named bonus bucket. Two contributions sharing a bucket do not stack — the largest
   * wins. This models "you can't benefit from the same bonus twice" without core
   * knowing which game that rule comes from.
   */
  bonus?: string;
  /** Upper clamp applied after summing. */
  max?: number;
  /** Only counts while the granting element is equipped (system-defined meaning). */
  equipped?: boolean;
  /** Alternative display value, shown instead of the computed number. */
  alt?: string;
  /** Rendered inline in descriptions rather than on the sheet. */
  inline?: boolean;
}

/** Tag this element so `select` filters can find it. */
export interface SupportsRule extends RuleBase {
  kind: 'supports';
  tag: string;
}

export interface SheetHints {
  display?: boolean;
  alt?: string;
  usage?: string;
  action?: string;
  name?: string;
  description?: string;
}

export interface MulticlassBlock {
  id: ElementId;
  prerequisite?: string;
  requirements?: RequirementExpr;
  setters: Record<string, Setter>;
  rules: Rule[];
}

/**
 * A named block of context an element declares, alongside its rules.
 *
 * The field is called `spellcasting` because Aurora's tag is, and because the `.incu`
 * content bundle serializes an Element verbatim — renaming it would move a format users
 * already have files in, for no behaviour at all (ADR 0020). What the *engine* sees is the
 * neutral shape {@link DeclaredBlock} below: a name and some attributes.
 */
export interface SpellcastingBlock {
  name: string;
  ability?: string;
  prepare?: string;
  extend?: string;
  all?: boolean;
  allowReplace?: boolean;
}

/**
 * The neutral view of the blocks an element declares — ADR 0020.
 *
 * A block is *a name plus attributes*, and nothing else. That is the whole of what a
 * character kind's `blockStats` iterates, and it is why the mechanism can be described
 * without saying "spell": 5e keys a save DC on the block's name and reads the ability it is
 * built from out of an attribute, and a system keying a resonance threshold on the name of
 * an attuned relic would use the identical machinery.
 */
export interface DeclaredBlock {
  /** As written by content. Never empty — a nameless block declares no namespace. */
  name: string;
  /** Everything else the block said, as strings. A `{key}` placeholder reads this. */
  attributes: Record<string, string>;
}

/**
 * The blocks an element declares, in declaration order, skipping nameless ones.
 *
 * The one place core translates the Aurora-shaped field into the neutral shape. A native
 * format that grows its own way of declaring blocks adds a branch here and nothing else.
 */
export function declaredBlocks(element: Element): DeclaredBlock[] {
  const blocks: DeclaredBlock[] = [];
  for (const block of element.spellcasting ?? []) {
    const name = block.name.trim();
    // `<spellcasting all="true" extend="true">` is how the corpus extends a list rather
    // than declaring a namespace, and it names nothing at all — 91 of the 118 blocks in
    // the corpus. A block with no name yields no stat key, so there is nothing to do.
    if (!name) continue;
    const attributes: Record<string, string> = {};
    if (block.ability !== undefined) attributes['ability'] = block.ability;
    if (block.prepare !== undefined) attributes['prepare'] = block.prepare;
    if (block.extend !== undefined) attributes['extend'] = block.extend;
    if (block.all) attributes['all'] = 'true';
    if (block.allowReplace) attributes['allowreplace'] = 'true';
    blocks.push({ name, attributes });
  }
  return blocks;
}

export interface ElementOrigin {
  /** Which content source this came from. */
  sourceId: string;
  fileUrl?: string;
  format: 'aurora' | 'incudo';
}

export interface Element {
  id: ElementId;
  type: ElementType;
  name: string;
  source: string;
  setters: Record<string, Setter>;
  rules: Rule[];
  supports: string[];
  /**
   * A prerequisite on the element itself, not on one of its rules: the Human Variant is
   * only available when the campaign uses feats. Filters candidate lists; it does not make
   * an element the character already has disappear, because vanishing content is worse for
   * the user than content that reports why it should not be there.
   */
  requirements?: RequirementExpr;
  /** Rich text, stored as HTML. Not normalized — see docs/AURORA-FORMAT.md. */
  description?: string;
  sheet?: SheetHints;
  multiclass?: MulticlassBlock;
  spellcasting?: SpellcastingBlock[];
  origin: ElementOrigin;
}

/** A queryable collection of elements. The engine only ever sees this, never a source. */
export interface ElementIndex {
  get(id: ElementId): Element | undefined;
  all(): Iterable<Element>;
  byType(type: ElementType): Element[];
  /** Elements carrying every one of the given support tags. */
  bySupport(tag: string): Element[];
}

export class MapElementIndex implements ElementIndex {
  private readonly byId = new Map<ElementId, Element>();
  private readonly typeIdx = new Map<ElementType, Element[]>();
  private readonly supportIdx = new Map<string, Element[]>();

  /**
   * Add an element, replacing any earlier one with the same id.
   *
   * Replacing matters, and used not to happen: two sources defining one id, or an
   * `<append>` folding rules into an element already loaded, would leave the stale copy in
   * the type and support lists. `byType` would then hand a builder the same element twice,
   * once with the rules and once without.
   */
  add(element: Element): void {
    const previous = this.byId.get(element.id);
    if (previous) {
      remove(this.typeIdx, previous.type, previous);
      for (const tag of previous.supports) remove(this.supportIdx, tag.toLowerCase(), previous);
    }
    this.byId.set(element.id, element);
    push(this.typeIdx, element.type, element);
    for (const tag of element.supports) push(this.supportIdx, tag.toLowerCase(), element);
  }

  addAll(elements: Iterable<Element>): void {
    for (const e of elements) this.add(e);
  }

  get(id: ElementId): Element | undefined {
    return this.byId.get(id);
  }
  all(): Iterable<Element> {
    return this.byId.values();
  }
  byType(type: ElementType): Element[] {
    return this.typeIdx.get(type) ?? [];
  }
  bySupport(tag: string): Element[] {
    return this.supportIdx.get(tag.toLowerCase()) ?? [];
  }
  get size(): number {
    return this.byId.size;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function remove<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (!existing) return;
  const at = existing.indexOf(value);
  if (at >= 0) existing.splice(at, 1);
}
