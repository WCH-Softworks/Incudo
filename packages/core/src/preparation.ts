/**
 * Prepared lists — ADR 0046.
 *
 * A block may let the player put a limited number of what it holds, or could hold, on a prepared list.
 * Most of that has a formula and is derived here: how many may be prepared (a stat content already
 * publishes), which elements are always on the list (a grant or a pick content marks), which of what the
 * player recorded counts, and how far over the limit it is. What has no formula is *which* the player
 * picked, and that is the one input, `Character.prepared`.
 *
 * Kept apart from the engine because it is pure: the engine works out what a block holds and hands that
 * over with a way to ask "does this element pass this filter for this block?", and everything here follows
 * from those. Core names no game noun; a system says which blocks, which stat and which filters
 * (`PreparationDef`).
 */

import type { Character } from './character.ts';
import type { DeclaredBlock, Element, ElementId, StatKey } from './model.ts';
import { substituteBlockPlaceholders, type PreparationDef } from './system.ts';
import { parseSupports, type SupportsExpr } from './supports.ts';

/** Where a block's player prepares from — ADR 0046 decision 3. */
export type PreparationMode = 'held' | 'list';

/** One preparing block of a character, with everything a screen or a comparison needs. */
export interface PreparedBlock {
  /** The lowercased block name: the key `Character.prepared` files this block's list under. */
  key: string;
  /** The block's name as content wrote it. */
  name: string;
  /** How many the player may prepare, from the stat the kind names. Not counting what is always prepared. */
  limit: number;
  /** `held`: from what the block holds (a book). `list`: from the whole list it could hold. */
  mode: PreparationMode;
  /** Elements content puts on the list unconditionally, at the levels its tracks say. */
  always: ElementId[];
  /**
   * `held` blocks only: what the block holds that could be prepared, less what is always prepared. Every
   * element in it passes the block's filter, so "of a level you have slots for" is decided once.
   */
  held: ElementId[];
  /** What the player recorded that counts: not always prepared, once each, and something the block may prepare. */
  chosen: ElementId[];
  /** What the player recorded that the block cannot prepare, so it counts for nothing and can be removed. */
  unavailable: ElementId[];
  /** How many `chosen` are past `limit`. Zero at or under it. A report, never a refusal. */
  over: number;
}

/** What the engine found attached to one block by the rules that are active. */
export interface BlockAttachments {
  /** Every element a grant or a recorded pick attached to the block. */
  attached: Set<ElementId>;
  /** The subset attached with the `prepared` marker: always on the list. */
  always: Set<ElementId>;
  /** An active select attached to the block has a name starting with the kind's `heldSelect`. */
  book: boolean;
}

export interface PreparationProblem {
  level: 'error' | 'warning';
  code: 'over-prepared' | 'not-preparable';
  message: string;
  elementId?: ElementId;
}

export interface PreparationInput {
  def: PreparationDef;
  /** Only the blocks that prepare. */
  blocks: DeclaredBlock[];
  attachments: Map<string, BlockAttachments>;
  character: Character;
  /** The derivation's settled stats, by lowercased name. */
  stats: ReadonlyMap<StatKey, { value: number }>;
  /** An element by id, from what the character holds and then from the index. */
  lookup(id: ElementId): Element | undefined;
  /** Whether an element passes a filter for a block; the engine owns how a `$(key)` expands. */
  accepts(block: DeclaredBlock, filter: SupportsExpr, element: Element): boolean;
}

interface ParsedFilters {
  list: SupportsExpr | undefined;
  held: SupportsExpr | undefined;
}

// Parsing is cheap and a derivation is not rare; a definition object is parsed once.
const parsed = new WeakMap<PreparationDef, ParsedFilters>();

export function preparationFilters(def: PreparationDef): ParsedFilters {
  let cached = parsed.get(def);
  if (!cached) {
    cached = { list: parseSupports(def.listFilter), held: parseSupports(def.heldFilter) };
    parsed.set(def, cached);
  }
  return cached;
}

/** The blocks that prepare: the ones whose declared attribute reads `true`. */
export function preparingBlocks(def: PreparationDef, blocks: Iterable<DeclaredBlock>): DeclaredBlock[] {
  const attribute = def.blockAttribute.trim().toLowerCase();
  return [...blocks].filter(
    (block) => block.attributes[attribute]?.trim().toLowerCase() === 'true',
  );
}

/** The lowercased key a block's list is recorded under. */
export function preparationKey(block: DeclaredBlock): string {
  return block.name.trim().toLowerCase();
}

/**
 * One entry per preparing block, and the problems the recorded lists raise.
 *
 * `over-prepared` is an error and never a refusal, in `over-attuned`'s family: a character is edited
 * constantly, and the one real case in the sample saves is over its limit. `not-preparable` is a
 * warning: something recorded that the block cannot prepare (a spell of a level it has no slots for, or
 * one it no longer holds) is left alone and counted for nothing, so the player decides.
 */
export function derivePreparation(
  input: PreparationInput,
  problems: PreparationProblem[],
): PreparedBlock[] {
  const { def, character } = input;
  const filters = preparationFilters(def);
  const out: PreparedBlock[] = [];

  for (const block of input.blocks) {
    const key = preparationKey(block);
    const attach = input.attachments.get(key) ?? { attached: new Set(), always: new Set(), book: false };
    const mode: PreparationMode = attach.book ? 'held' : 'list';
    const limitStat = substituteBlockPlaceholders(def.limit, block)?.toLowerCase();
    const limit = limitStat === undefined ? 0 : Math.max(0, input.stats.get(limitStat)?.value ?? 0);
    const always = [...attach.always];

    const passes = (id: ElementId, filter: SupportsExpr | undefined): boolean => {
      const element = input.lookup(id);
      return (
        element !== undefined &&
        element.type === def.elementType &&
        filter !== undefined &&
        input.accepts(block, filter, element)
      );
    };

    // What a book holds that is worth preparing. Anything always prepared is on the list already.
    const held: ElementId[] = [];
    if (mode === 'held') {
      for (const id of attach.attached) {
        if (!attach.always.has(id) && passes(id, filters.held)) held.push(id);
      }
    }
    const heldSet = new Set(held);

    const chosen: ElementId[] = [];
    const unavailable: ElementId[] = [];
    for (const id of new Set(character.prepared?.[key] ?? [])) {
      if (attach.always.has(id)) continue;
      const ok = mode === 'held' ? heldSet.has(id) : passes(id, filters.list);
      (ok ? chosen : unavailable).push(id);
    }

    const over = Math.max(0, chosen.length - limit);
    if (over > 0) {
      problems.push({
        level: 'error',
        code: 'over-prepared',
        message: `${chosen.length} prepared for "${block.name}", which allows ${limit}. Unprepare ${over} of them, or expect a list the rules do not permit.`,
      });
    }
    for (const id of unavailable) {
      problems.push({
        level: 'warning',
        code: 'not-preparable',
        message: `"${id}" is on the prepared list of "${block.name}", which cannot prepare it: it is not something the block holds, or not a level it has slots for.`,
        elementId: id,
      });
    }

    out.push({ key, name: block.name, limit, mode, always, held, chosen, unavailable, over });
  }
  return out;
}
