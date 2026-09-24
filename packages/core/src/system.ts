/**
 * A game system definition.
 *
 * This is *data* (`systems/<id>/system.json`), never code. Everything Aurora hardcodes
 * about D&D — the element type vocabulary, the stat list, the build flow, the sheet —
 * lives here instead. That is the whole trick behind the system-agnostic claim.
 * See docs/adr/0003.
 *
 * A system declares one or more **character kinds** (ADR 0009). The kind owns everything
 * that differs per kind: how it progresses, which element types it may use, how it is
 * built, and how it is displayed. A PC has levels and a two-page sheet; a monster has a
 * challenge rating and a stat block; they share only the stats underneath.
 */

import type { DeclaredBlock, Element, ElementId, ElementType, StatKey } from './model.ts';
import { declaredBlocks } from './model.ts';
import type { StatExpr } from './expression.ts';
import { parseRequirements, type RequirementExpr } from './requirements.ts';
import { NEVER_MATCHES, parseSupports, type SupportsExpr } from './supports.ts';

export interface ElementTypeDef {
  /** The type name as it appears on elements, e.g. "Class Feature". */
  name: ElementType;
  /** Plural label for UI. */
  plural?: string;
  /** Types that may be nested under this one (a Class has Archetypes). */
  children?: ElementType[];
  /** Shown in the content browser as a browsable category. */
  browsable?: boolean;
  /** The user picks this directly during the build, rather than receiving it via a grant. */
  selectable?: boolean;
  /**
   * An element of this type is a publication, and its `name` is the string every other element carries in
   * `source` — ADR 0049. A character may be offered only some publications (`Character.publications`); an
   * element whose `source` names no loaded publication is always offered.
   */
  publication?: boolean;
  /**
   * The setter that, reading `true` on a publication, marks one every character is offered whatever it
   * records — ADR 0049. 5e names `core`: the one book carrying it holds the skills and languages every other
   * book refers to, so switching it off would leave a character offered no skill at all.
   */
  requiredWhen?: string;
}

export type StatValueKind = 'number' | 'string';

export interface StatDef {
  name: StatKey;
  label?: string;
  kind?: StatValueKind;
  default?: number | string;
  /**
   * A derived stat. Evaluated after contributed stats are summed.
   * Systems declare arithmetic here rather than shipping JavaScript.
   */
  derive?: StatExpr;
  /**
   * Bounds, applied to every stat — contributed, derived or both — after the contributions
   * and derivations have settled and before `overrides`, which still win over everything
   * (ADR 0016). A bound may be a plain number or an expression, because the interesting ones
   * are not constants: 5e's ability score maximum is `20 + strength:max`, where the 20 is the
   * system's and the delta is content's.
   *
   * Expressions here read the *unclamped* values of other stats, in one pass. A bound that
   * depends on a bounded stat therefore sees the number before its cap — stated rather than
   * fixed, because the alternative is a second fixed point in the resolver.
   */
  min?: number | StatExpr;
  max?: number | StatExpr;
}

/**
 * The reserved stat reference that reads the progression of the track being evaluated.
 *
 * Only meaningful inside a {@link TrackStatDef}'s `value`; anywhere else it is an ordinary
 * stat name nothing declares, and so reads 0.
 */
export const TRACK_PROGRESS_STAT = 'track:progress';

/**
 * The reserved stat reference that reads 1 when the track being evaluated holds the character's
 * first point of progression, and 0 otherwise — ADR 0044. Same scope as {@link TRACK_PROGRESS_STAT}.
 */
export const TRACK_FIRST_STAT = 'track:first';

/** The placeholder `trackStatPattern` and {@link TrackStatDef.stat} substitute. */
const TRACK_NAME_PLACEHOLDER = '{name}';

/**
 * A stat contributed once per track — ADR 0018.
 *
 * ADR 0015 gave every track a published count, which content reads by name (`level:warlock`).
 * What it could not do is *iterate*: "for each track, add half its count". A system definition
 * cannot enumerate the tracks, because content ships its own and there are 25 spellcasting
 * classes in the Aurora corpus alone.
 *
 * So: for every track the character has, if `when`'s element is in that track, evaluate
 * `value` — with {@link TRACK_PROGRESS_STAT} reading that track's own count — and contribute
 * it to `stat`. Nothing here is a class or a spell; it is "a track may contribute a number".
 */
export interface TrackStatDef {
  /**
   * The stat contributed to. `{name}` is replaced with the track element's lowercased name,
   * which turns an aggregate into a per-track stat: `"{name}:spellcasting:solo"` publishes
   * `warlock:spellcasting:solo`. Without it, every track's contribution sums into one stat.
   */
  stat: StatKey;
  /**
   * Only contribute for tracks containing this element. Omit to contribute for every track.
   *
   * This is the hook content already provides: a 5e casting class grants a marker saying which
   * weighting it uses, and the marker lands in that class's track.
   */
  when?: ElementId;
  /** Evaluated per track. Reads {@link TRACK_PROGRESS_STAT} for that track's own count. */
  value: StatExpr;
}

/** `"{name}:spellcasting:solo"` on a track rooted at Warlock -> `warlock:spellcasting:solo`. */
export function trackStatName(def: TrackStatDef, elementName: string): StatKey {
  return def.stat.replace(TRACK_NAME_PLACEHOLDER, elementName.trim().toLowerCase());
}

/**
 * A stat contributed once per declared block — ADR 0020.
 *
 * The third keying, after the character's own stats and ADR 0018's per-track ones, and it
 * exists because the other two cannot reach this. An element may declare named blocks
 * ({@link DeclaredBlock}), content keys stats on those names, and the name is *not* the
 * track's: an Eldritch Knight's block is called `eldritch knight` while its track is
 * `fighter`, so `trackStats`' `{name}` substitutes the wrong word and nothing else in the
 * engine substitutes the right one.
 *
 * Read as: **for every distinct block name the character's elements declare, evaluate
 * `value` and contribute it to `stat`.** Both are written with placeholders:
 *
 *  - `{name}` is the block's name, lowercased — `"{name}:spellcasting:dc"` publishes
 *    `bard:spellcasting:dc`, which is the key content already contributes item bonuses to;
 *  - `{anything else}` reads that attribute off the block, also lowercased, and it works
 *    inside a `ref` as well as in `stat`, so `"{ability}:modifier"` resolves to
 *    `charisma:modifier` for the Bard and `intelligence:modifier` for the Wizard.
 *
 * An entry whose placeholders do not all resolve contributes nothing and reports itself.
 * Guessing an ability for a block that declares none would be exactly the invention ADR
 * 0005 rules out.
 */
export interface BlockStatDef {
  /** The stat contributed to, after substitution. Usually carries `{name}`. */
  stat: StatKey;
  /** Evaluated once per block. Placeholders inside a `ref`'s stat name resolve too. */
  value: StatExpr;
}

/**
 * How a `$(key)` in a select's filter expands, for a rule attached to a declared block —
 * ADR 0030.
 *
 * The fourth thing a block does, after ADR 0020's three keyings of a stat, and the same
 * framing: a rule may be attached to a named block, and the filter it carries is written in
 * terms of what that block and the derivation publish. Core cannot own the keys — there are
 * exactly two in the Aurora corpus and both spell the word this package is not allowed to
 * know, so they are declared where the rest of 5e's vocabulary already lives.
 *
 * Two forms, because the corpus's two keys ask two different questions:
 *
 *  - `tags` asks *what is this block called, for filtering purposes?* A fallback chain over
 *    the block's own name and attributes, where the **first entry whose placeholders all
 *    resolve wins**. 5e's is `["{list}", "{name}"]`, and it is a fallback rather than an OR
 *    because the two disagree on purpose: an Eldritch Knight's block is named
 *    `Eldritch Knight` and its list is `Wizard,(Abjuration||Evocation)`, and OR-ing them
 *    would offer the whole wizard list. 17 blocks in the corpus declare a list and the other
 *    74 have only a name, which is why the chain has two entries rather than one.
 *  - `tagsFromStats` asks *what has the derivation published for this block?* A set, not a
 *    value. Each pattern is a stat name carrying one `*`, which matches a single
 *    `:`-delimited segment; every stat matching it whose value is **positive** contributes
 *    its captured segment as a tag, and the whole is an OR. That is how "any level you have
 *    slots for" is written without core learning what a slot is, and it widens on its own as
 *    the character levels, because it reads stats the derivation already settled (ADR 0018).
 *
 * `fillFrom` turns numeric captures into a contiguous range, and the corpus's own saves are
 * what forced it. A bard's slot table is cumulative, so its captures are already `1,2,3` and
 * a range changes nothing — but a **warlock's is not**. Aurora writes pact magic as
 * `+count` at one level and `-count` at the next, so a warlock 18 publishes exactly one
 * positive slot stat, at level 5, while the real save holds spells of levels 1 through 5
 * (and 6 through 9 from Mystic Arcanum, whose selects hardcode their level). Taking the
 * captures literally would offer that character 5th-level spells and nothing else.
 *
 * An expansion that legitimately finds no tags matches nothing and is **not** reported as
 * unresolved: a level 1 paladin has no slots, and that is an answer rather than a gap.
 */
export interface BlockFilterDef {
  /** The interpolation key, without the `$(` and the `)`. Compared lowercased. */
  key: string;
  /** Ordered alternatives over the block's name and attributes; the first to resolve wins. */
  tags?: string[];
  /** Stat-name patterns carrying one `*`. A positive match contributes its capture as a tag. */
  tagsFromStats?: string[];
  /**
   * Emit every integer from here up to the largest numeric capture, rather than the captures
   * themselves. Non-numeric captures are still emitted verbatim.
   *
   * The system's way of saying "a resource published at one level covers everything at or
   * below it", which is a statement about the game and not about the engine.
   */
  fillFrom?: number;
}

/**
 * A setter that, when it holds `true`, is a tag as far as a select's filter is concerned — ADR 0047.
 *
 * Aurora spells a spell's ritual-ness as `<set name="isRitual">true</set>` and filters on it as `Ritual`;
 * neither word is core's, so the system says both. It is a named pair and not a naming rule: one setter in
 * the corpus needs it, and a rule derived from one setter would tag the others with no operand asking for them.
 */
export interface SetterTagDef {
  /** The setter's name as content writes it. Compared lowercased. */
  setter: string;
  /** The filter operand it answers to. Compared lowercased. */
  tag: string;
}

/**
 * A short fact a picker prints beside a candidate of certain types — a spell's level, say.
 *
 * Which setter says it and how it reads are the system's business: core does not know that a
 * spell has a level, or that level 0 is called a cantrip, and a system where neither is true
 * simply declares no notes. The text is part of the picker's label, so it is also what a search
 * matches — typing "cantrip" narrows a spell list to cantrips without a filter control.
 */
export interface CandidateNoteDef {
  /** Element types this note is printed for. */
  types: ElementType[];
  /** The setter whose value is shown. A candidate without it gets no note. */
  setter: string;
  /** The text, with `{value}` standing for the setter's value. */
  label: string;
  /** Exact-value replacements, tried before `label` — `{ "0": "Cantrip" }`. */
  labels?: Record<string, string>;
}

/** One `:`-delimited segment — what a `*` in a `tagsFromStats` pattern captures. */
const STAT_SEGMENT = '[^:]+';

function statPatternToRegExp(pattern: string): RegExp | undefined {
  const star = pattern.indexOf('*');
  // Exactly one wildcard: none means the pattern names a single stat and should have been
  // written as one, and two would make the capture ambiguous.
  if (star < 0 || pattern.indexOf('*', star + 1) >= 0) return undefined;
  const quote = (text: string) => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return new RegExp(
    '^' + quote(pattern.slice(0, star)) + '(' + STAT_SEGMENT + ')' + quote(pattern.slice(star + 1)) + '$',
  );
}

/** `{5}` with `fillFrom` 1 becomes `{1,2,3,4,5}`; anything unparseable is kept as written. */
function filledRange(captured: Set<string>, from: number): Set<string> {
  const out = new Set<string>();
  let highest: number | undefined;
  for (const capture of captured) {
    const value = Number(capture);
    if (Number.isInteger(value)) highest = highest === undefined ? value : Math.max(highest, value);
    else out.add(capture);
  }
  if (highest !== undefined) for (let n = from; n <= highest; n++) out.add(String(n));
  return out;
}

/**
 * Expand one `$(key)` for one block, against the stats the derivation settled — ADR 0030.
 *
 * Returns `undefined` only when the definition cannot be evaluated at all: no alternative's
 * placeholders resolve, or no pattern carries a single `*`. An evaluation that legitimately
 * finds nothing returns {@link NEVER_MATCHES}, so a builder can tell "you have no spell slots
 * yet" from "Incudo cannot read this filter".
 */
export function expandBlockFilter(
  def: BlockFilterDef,
  block: DeclaredBlock,
  stats: Iterable<readonly [StatKey, number]>,
): SupportsExpr | undefined {
  for (const alternative of def.tags ?? []) {
    const text = substituteBlockPlaceholders(alternative, block);
    if (text === undefined) continue;
    const expr = parseSupports(text);
    if (expr !== undefined) return expr;
  }

  const patterns = def.tagsFromStats ?? [];
  if (patterns.length === 0) return undefined;
  const captured = new Set<string>();
  let usable = false;
  for (const pattern of patterns) {
    const substituted = substituteBlockPlaceholders(pattern, block);
    if (substituted === undefined) continue;
    // Stat keys are held lowercased, and a pattern is authored beside them.
    const regexp = statPatternToRegExp(substituted.toLowerCase());
    if (regexp === undefined) continue;
    usable = true;
    for (const [name, value] of stats) {
      if (value <= 0) continue;
      const match = regexp.exec(name.toLowerCase());
      if (match) captured.add(match[1]!);
    }
  }
  if (!usable) return undefined;
  if (captured.size === 0) return NEVER_MATCHES;
  const tags = def.fillFrom === undefined ? captured : filledRange(captured, def.fillFrom);
  // Sorted so an expansion is stable between derivations. Matching does not care.
  const children = [...tags].sort().map((tag) => ({ kind: 'tag', tag }) as SupportsExpr);
  return children.length === 1 ? children[0]! : { kind: 'or', children };
}

/**
 * A stat the *kind* contributes, optionally only when a condition holds — ADR 0022.
 *
 * The base case the other two are iterating specialisations of: `trackStats` contributes once
 * per track and `blockStats` once per declared block, and this contributes once, for a character
 * of this kind. What it adds over them is a `requirements`, which is what 5e's armour class
 * needed and neither of them could give it — "a character wearing no armour has an armour class
 * of 10" is a rule about the character, not about any element it holds.
 *
 * It lives in `system.json` and nowhere else, and that placement is the whole argument of
 * ADR 0022. A rule on an element the kind grants is **copied into every save** by
 * `collectCharacterContent`; `system.json` is the one thing a save deliberately does not embed.
 * Identity is embedded, mechanics are not.
 *
 * Nothing here is armour. It is "a kind may contribute a number, and may say when".
 */
export interface ContributionDef {
  stat: StatKey;
  value: StatExpr;
  /**
   * Named bonus bucket, exactly as on a content {@link StatRule}. Carried because without it
   * the `base` bucket cannot be joined, and Medium Armor Master could not raise a Dexterity cap
   * the system wrote and it did not.
   */
  bonus?: string;
  /**
   * A condition in content's own requirement language, as a string — `"[armor:medium]"`.
   *
   * Not a JSON tree: a system definition is authored by hand, and its author has already read
   * this spelling a thousand times in content. It is named `requirements` and not `when` so that
   * a reader who knows content knows it instantly; `trackStats.when` is an element id and means
   * something else. An expression that will not parse makes the system invalid — see
   * `checkSystemReferences` — which is ADR 0011's standing rule.
   */
  requirements?: string;
}

/**
 * The parsed form of a contribution's condition, cached on the definition object itself.
 *
 * Parsing is cheap and a derivation is not rare, so it happens once per definition rather than
 * once per pass of the fixed point. A definition that will not parse yields a condition that is
 * never true: the system is already invalid by the time this is reached, and reading a broken
 * condition as *satisfied* would contribute a number nobody asked for.
 */
const contributionConditions = new WeakMap<ContributionDef, { expr: RequirementExpr | undefined }>();
const NEVER: RequirementExpr = { kind: 'not', child: { kind: 'always' } };

export function contributionCondition(def: ContributionDef): RequirementExpr | undefined {
  const cached = contributionConditions.get(def);
  if (cached) return cached.expr;
  let expr: RequirementExpr | undefined;
  try {
    expr = parseRequirements(def.requirements);
  } catch {
    expr = NEVER;
  }
  contributionConditions.set(def, { expr });
  return expr;
}

/**
 * One place a character may put an item — ADR 0025.
 *
 * `id` is the value content's slot setter carries: 5e's content says `body` for armour and
 * `onehand` for a sword, and the two shields in the corpus say `onehand,secondary`. Core
 * compares the string and knows nothing about what any of them mean.
 *
 * **`stats` is the capacity.** They are the stats this slot publishes into, in fill order,
 * and an item takes the first one that is free — so `["armor"]` is one suit of armour and
 * `["primary", "secondary"]` is two hands. A slot with no `stats` publishes nothing and
 * holds any number of things, which is the honest answer for a slot whose system declares no
 * limit: 5e has no rule about how many cloaks you may wear, and one of a set of real saves
 * wears two.
 */
export interface SlotDef {
  /** The slot setter value that lands here, compared verbatim. */
  id: string;
  label?: string;
  /** Stats this slot publishes into, in fill order. One item per stat. */
  stats?: StatKey[];
}

/**
 * How this system marks an item as requiring attunement — ADR 0023 decision 4.
 *
 * Two strings, because core cannot know the word: which setter says it, and the value that
 * means yes. 5e's corpus writes `<set name="attunement">true</set>` on 968 elements and
 * `false` on 8, so the value is not decoration.
 */
export interface AttunementDef {
  setter: string;
  /** The setter value meaning "this requires attunement". */
  requires: string;
  /**
   * The stat the count of attuned items is contributed to — ADR 0023 decision 3, ADR 0026.
   *
   * A contribution rather than a published input, because content writes this key too: 5e's
   * Soul of Artifice contributes `attunement:current` 0 twice, and an input stat would have
   * overwritten it.
   */
  countStat?: StatKey;
  /**
   * The stat holding the limit. A character whose count exceeds it is reported, never refused.
   *
   * The base belongs in {@link CharacterKindDef.contributions} and not in a `StatDef`
   * `default` — a default is a base that contributions *add* to, so `default: 3` plus the
   * Artificer's `bonus="base"` 4 would read 7 instead of 4.
   */
  maxStat?: StatKey;
}

/**
 * How a character kind reads the setters content puts on an item — ADR 0025.
 *
 * The mechanism behind `equipped="[armor:none]"`, which the corpus carries 78 times and
 * which [ADR 0021] deliberately parsed and left inert for want of this. A slot publishes a
 * **set of tags** rather than a string, because the twelve operands the corpus uses are
 * three different kinds of thing: `heavy` is slot state, `versatile` is a weapon property
 * whose setter value is a die, and `double-bladed scimitar` is an element's name.
 *
 * Nothing here is a suit of armour. It is "an item declares where it goes, and what is there
 * can be asked about".
 */
export interface InventoryDef {
  /** The setter naming where an item goes. `Character.inventory`'s `slot` overrides it. */
  slotSetter: string;
  /** What an occupied slot publishes, whatever is in it. 5e's content asks for `any`. */
  occupiedTag: string;
  /** What a declared slot with nothing in it publishes. 5e's content asks for `none`. */
  emptyTag: string;
  /**
   * Setters whose **value** becomes a tag: 5e's `armor` setter turns a Plate into `heavy`.
   *
   * The value is taken verbatim, lowercased. On 102 of the corpus's elements the `armor`
   * setter means something else entirely — an attach constraint on an adorner — and that is
   * harmless here only because adorners occupy no slot.
   */
  tagSetters?: string[];
  /**
   * Setters whose **presence** becomes a tag, named after the setter rather than its value.
   *
   * `<set name="versatile">1d8</set>` is how a quarterstaff says it is versatile, and
   * `[primary:versatile]` is the corpus asking. The die is not what the question is about.
   */
  flagSetters?: string[];
  slots: SlotDef[];
  /** Omit for a system with no such concept, and nothing is ever gated. */
  attunement?: AttunementDef;
}

/**
 * How a kind lets a player prepare a list from the things a block holds — ADR 0046.
 *
 * Some blocks let the character put a limited number of what they hold or could hold on a "prepared" list,
 * and the limit, what is always on it and what is over are all derivable; only *which* the player picked is
 * not (`Character.prepared`). This says which blocks do it and where each number lives, in the shape the
 * other kind-level declarations use, so core says none of `spell`, `prepare` or `spellbook`.
 *
 * A block prepares when its declared attribute `blockAttribute` reads `true`. It prepares from what it
 * **holds** (a book) when an active select attached to it has a name starting with `heldSelect`, and from a
 * whole **list** otherwise. A kind that declares none has no such lists, and the engine publishes none.
 */
export interface PreparationDef {
  /** The block attribute that says the block prepares, compared lowercased and read as `true`. */
  blockAttribute: string;
  /** The stat holding the block's limit, with `{name}` standing for the block's name. */
  limit: StatKey;
  /** The type of element that is prepared. */
  elementType: ElementType;
  /**
   * The prefix of a select's name whose picks form a book the block prepares from. Case is ignored.
   * Omitted, every preparing block prepares from its list.
   *
   * This is an assumption about content and is named as one (ADR 0046 decision 4): nothing in content
   * says which classes keep a book but the name of the select that fills it.
   */
  heldSelect?: string;
  /**
   * A `supports` expression, in the language of ADR 0030, that admits what a block may prepare from its
   * whole list: "on this block's list, of a level I have slots for".
   */
  listFilter: string;
  /** The same for a block that prepares from what it holds; the list part does not apply to a book. */
  heldFilter: string;
}

/**
 * Substitute a block's name and attributes into a stat key.
 *
 * Returns `undefined` when a placeholder names something the block does not declare —
 * which is a real case, not a defect: 5e's `<spellcasting name="Warlock" extend="true">`
 * carries no `ability`, and a character holding only such a block has no casting ability
 * for the engine to build a DC from.
 */
export function substituteBlockPlaceholders(
  text: string,
  block: DeclaredBlock,
): StatKey | undefined {
  let missing = false;
  const out = text.replace(/\{([^{}]*)\}/g, (_match, key: string) => {
    const lower = key.trim().toLowerCase();
    const value = lower === 'name' ? block.name : block.attributes[lower];
    if (value === undefined || value.trim() === '') {
      missing = true;
      return '';
    }
    return value.trim().toLowerCase();
  });
  return missing ? undefined : out;
}

/**
 * The blocks a set of elements declares, one entry per distinct name.
 *
 * Merging matters and is not tidiness. A block name is a stat *namespace*, so contributing
 * once per declaration would double a Bard's save DC the day a character holds both the
 * 2014 and the 2024 Bard — and 93 of the corpus's 118 blocks are `extend="true"`
 * continuations, 66 of them named, whose whole purpose is to be the same block as the one
 * that declares the ability. First declaration wins per attribute, in element order.
 */
export function collectDeclaredBlocks(elements: Iterable<Element>): DeclaredBlock[] {
  const byName = new Map<string, DeclaredBlock>();
  for (const element of elements) {
    for (const block of declaredBlocks(element)) {
      const key = block.name.trim().toLowerCase();
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { name: block.name, attributes: { ...block.attributes } });
        continue;
      }
      for (const [attr, value] of Object.entries(block.attributes)) {
        if (existing.attributes[attr] === undefined) existing.attributes[attr] = value;
      }
    }
  }
  return [...byName.values()];
}

/**
 * A pool of points a build step distributes — ADR 0017.
 *
 * The mechanism behind "a class gave you one more attribute point, and you should not have
 * to walk back to an earlier screen to spend it". `stat` is an ordinary stat, so **content
 * adds to it with the `stat` rule that already exists** — a feat, a race variant, an
 * improvement at level 4. No new rule kind, and the sum is always current because the engine
 * recomputes it like any other stat.
 *
 * Nothing here is an ability score. It is "this step distributes points across these stats,
 * by one of these methods".
 */
export interface BudgetDef {
  /** The stat holding points granted beyond whatever the method itself supplies. */
  stat: StatKey;
  /** The stats the points are spent on. */
  targets: StatKey[];
  /** Ids of the system's `generationMethods` this step offers. */
  methods?: string[];
}

/**
 * How a budget's starting values are produced — ADR 0017.
 *
 * Data, not code, and for a stated reason: docs/CODE-REUSE-POLICY.md rule 1 says a rule
 * about the game may not live in a component, and a point-buy cost table is exactly that.
 * A shell that hardcoded 27 points would be a bug in the same category as one that computed
 * armour class.
 *
 * Three shapes, distinguished by which fields are present:
 *
 *  - **points** — `pool` plus `costs`: values are bought out of a pool.
 *  - **assignment** — `values`, or `dice` and `count`: a fixed set is handed out and
 *    assigned to targets. Not a points budget, and reporting one would be a fiction.
 *  - **free** — neither: the user types numbers.
 */
export interface GenerationMethodDef {
  id: string;
  label?: string;
  /** Points available before anything content grants. Makes this a points method. */
  pool?: number;
  /** Cost of each attainable value, keyed by the value. Makes this a points method. */
  costs?: Record<string, number>;
  /** Lowest value this method may produce. */
  min?: number;
  /** Highest value this method may produce. */
  max?: number;
  /** A fixed set of values to assign, e.g. the standard array. */
  values?: number[];
  /** Dice notation the shell rolls, e.g. "4d6dl1". Core never rolls anything. */
  dice?: string;
  /** How many times to roll. */
  count?: number;
}

export interface BuildStepDef {
  id: string;
  label: string;
  /** Element types the user picks at this step. */
  types: ElementType[];
  required?: boolean;
  /** Repeats per point of progression (e.g. a level-up step). */
  perLevel?: boolean;
  /**
   * This step is answered by a *set*: zero or more of its candidates, never blocking — ADR 0032.
   *
   * What a table's optional rules are, in a system that has any: independent of each other, and
   * "none of them" is the ordinary answer, so it must never read as an unanswered obligation.
   * That is also why it cannot be combined with `required`, and why validation refuses the pair
   * instead of choosing a reading.
   *
   * Absent or false, a step behaves exactly as it always has. An older reader handed a definition
   * that has it ignores the key and publishes no decision for the step — the character is built
   * without the set, which is what happened before this existed — so `formatVersion` did not move.
   */
  multiple?: boolean;
  description?: string;
  /**
   * Ids of steps that must be usable before this one is — ADR 0017.
   *
   * A genuine dependency and nothing else: you cannot pick spells before something makes
   * you a spellcaster. The suggested order is a topological sort of these, with the declared
   * array order breaking ties. That is what makes abilities-first fall out of the data
   * rather than out of a rule in the app — the abilities step requires nothing, so it sorts
   * first — and, more importantly, it is what lets a step become available *later*.
   */
  requires?: string[];
  /** Points this step distributes, when it is about numbers rather than elements. */
  budget?: BudgetDef;
  /** One roll (or a fixed alternative) this step records per point of progression — ADR 0019. */
  levelRoll?: LevelRollDef;
  /**
   * Where this step's own pick, and everything answering it opens, ranks among "Open
   * decisions" — lower sorts first. Defaults to this step's position in `orderBuildSteps`'s
   * result, so a system that never sets it keeps exactly the order its array already implies.
   *
   * A genuine ranking, not an availability gate: `requires` decides when a step *can* be
   * reached, `priority` only decides where it reads once it can be. The two are independent
   * on purpose — a system author who wants an unanswered Background to keep outranking an
   * already-open Class select (the concern the engine used to hardcode a rule for) states
   * that as data here, by giving `background` a lower number than `class`, rather than the
   * app enforcing one universal reading for every system.
   */
  priority?: number;
}

/**
 * A per-level recorded roll a `perLevel` step owns — ADR 0019's hit points, and anything
 * shaped like them (a wound track, a per-level resource with no formula).
 *
 * The engine already sums `character.rolls` through a `{ "kind": "rolls" }` derive; what it
 * cannot do, and must not learn to (ADR 0019 forbids core rolling anything), is say *what die*
 * a given level owes. That varies per character — a d6 wizard and a d12 barbarian read the
 * same `pattern` — so it is read off content: the element that governs a level names its die
 * on a setter, exactly as Aurora's own content does (`<set name="hd">d6</set>`).
 */
export interface LevelRollDef {
  /** The key a roll is recorded under, with `{n}` replaced by the level — "hp:level:{n}". */
  pattern: string;
  /** The setter naming the die, read off the governing element — Aurora's convention is `hd`. */
  dieSetter: string;
  /**
   * The element type that governs a level — 5e's `Class`. `character.advancement` (ADR 0015)
   * names the element for a level directly when it is recorded; where it is not — every
   * character built in the app today, which has no multiclass UI yet — the single element of
   * this type the character has stands in for every level, the same fallback the engine itself
   * uses for an element in no track.
   */
  classType: ElementType;
  /**
   * An element that, while the character has it, makes every level's value fixed rather than
   * rolled — 5e's "use average hit points" campaign option (ADR 0044 decision 6). The builder
   * then publishes each level's average and opens no decision for it; rolls already recorded
   * stay recorded and are not read.
   */
  fixedWhen?: ElementId;
}

/**
 * The suggested order for a kind's build steps: a topological sort of `requires`, with the
 * declared array order breaking ties — ADR 0017.
 *
 * A step in a dependency cycle is emitted last rather than dropped. Validation reports
 * cycles (ADR 0011's stance: report, do not repair), and a builder that silently lost a
 * screen would be a worse failure than one that shows it in an odd place.
 */
export function orderBuildSteps(steps: BuildStepDef[]): BuildStepDef[] {
  const known = new Set(steps.map((s) => s.id));
  const placed = new Set<string>();
  const ordered: BuildStepDef[] = [];
  let remaining = [...steps];

  while (remaining.length) {
    // One at a time, taking the earliest *declared* step whose dependencies are met. Placing
    // a whole wave at once would also be a valid topological order and a worse one: it drags
    // every dependent step to the end, so "levels" would follow "details" purely for having
    // named a prerequisite. This puts each step as early as its dependencies allow.
    const at = remaining.findIndex((step) =>
      (step.requires ?? []).every((id) => !known.has(id) || placed.has(id)),
    );
    if (at < 0) {
      // Everything left is in a cycle, or depends on one. Keep declared order.
      ordered.push(...remaining);
      break;
    }
    const [step] = remaining.splice(at, 1);
    ordered.push(step!);
    placed.add(step!.id);
  }
  return ordered;
}

/** Step ids that sit in, or behind, a `requires` cycle. Empty for a well-formed system. */
export function buildStepCycles(steps: BuildStepDef[]): string[] {
  const known = new Set(steps.map((s) => s.id));
  const placed = new Set<string>();
  let remaining = [...steps];
  for (;;) {
    const ready = remaining.filter((step) =>
      (step.requires ?? []).every((id) => !known.has(id) || placed.has(id)),
    );
    if (!ready.length) return remaining.map((step) => step.id);
    for (const step of ready) placed.add(step.id);
    remaining = remaining.filter((step) => !placed.has(step.id));
  }
}

export interface SheetSectionDef {
  id: string;
  label: string;
  /** Stats rendered in this section, in order. */
  stats?: StatKey[];
  /** Element types listed in this section. */
  types?: ElementType[];
  /**
   * Render this section once per block the character declares, substituting the block's
   * name and attributes into every entry of `stats` — ADR 0020.
   *
   * Needed because {@link BlockStatDef} publishes stats a section cannot name. There is no
   * `bard:spellcasting:dc` in any system definition and there never can be: the key comes
   * from content, and enumerating the corpus's twelve block names would be wrong the day a
   * source ships a thirteenth.
   *
   * The flag is what makes `{name}` mean something here. Everywhere else in a system
   * definition `{name}` names the subject of an iteration — a track in `trackStats`, a block
   * in `blockStats` — and a sheet section iterates nothing until it says what it iterates.
   */
  perBlock?: boolean;
}

/**
 * One rendering of a sheet section: its label and the stat keys to read — ADR 0020.
 *
 * An ordinary section yields exactly itself. A `perBlock` section yields one entry per
 * block the character declares, in declaration order, with the block's name in the label so
 * two casting sources are told apart. A section whose stats do not all resolve for a block
 * is skipped for that block rather than shown half-empty.
 */
export interface SheetSectionRendering {
  id: string;
  label: string;
  stats: StatKey[];
  types: ElementType[];
  /** The block this rendering is for, when the section is `perBlock`. */
  blockName?: string;
}

/**
 * Expand a sheet section against the blocks a character's elements declare.
 *
 * The one piece of `perBlock` a shell must not reimplement: core owns the substitution so
 * that the desktop sheet and the mobile sheet cannot disagree about what a
 * section shows.
 */
export function renderSheetSection(
  section: SheetSectionDef,
  blocks: readonly DeclaredBlock[],
): SheetSectionRendering[] {
  const base = { id: section.id, stats: section.stats ?? [], types: section.types ?? [] };
  if (!section.perBlock) return [{ ...base, label: section.label }];

  const renderings: SheetSectionRendering[] = [];
  for (const block of blocks) {
    const stats: StatKey[] = [];
    let complete = true;
    for (const stat of base.stats) {
      const key = substituteBlockPlaceholders(stat, block);
      if (key === undefined) {
        complete = false;
        break;
      }
      stats.push(key);
    }
    if (!complete) continue;
    renderings.push({
      id: `${section.id}:${block.name.trim().toLowerCase()}`,
      label: `${section.label} — ${block.name}`,
      stats,
      // Element lists are not per-block: a block names a stat namespace, not a filter over
      // the character's elements. Repeating the same spell list under every casting source
      // would be a confident lie about which source it came from.
      types: [],
      blockName: block.name,
    });
  }
  return renderings;
}

export interface SheetLayoutDef {
  sections: SheetSectionDef[];
}

/**
 * How a kind of character advances.
 *
 * Generalized deliberately: "level" was the last big PC assumption sitting in the
 * engine's face (ADR 0009). A character records a single number, `progress`, whose
 * meaning comes from here.
 *
 * `stat` names the stat that number is published as, so content can reference it —
 * requirements like `level:rogue`, derivations like `2 + floor((level - 1) / 4)`. It is
 * a system-declared string; core never spells it.
 */
export type Progression =
  | {
      kind: 'level';
      min: number;
      max: number;
      stat?: StatKey;
      elementIdPattern?: string;
      trackStatPattern?: string;
      /**
       * The element type a track is rooted on. A character with no `advancement` holds one
       * element of it and that element is an implicit track — ADR 0044 decision 5.
       */
      trackType?: string;
    }
  | {
      kind: 'rating';
      stat: StatKey;
      min?: number;
      max?: number;
      elementIdPattern?: string;
      trackStatPattern?: string;
    }
  | {
      kind: 'xp';
      stat: StatKey;
      min?: number;
      max?: number;
      elementIdPattern?: string;
      trackStatPattern?: string;
    }
  | { kind: 'none' };

/**
 * The stat a track publishes its own count as — ADR 0015.
 *
 * `"level:{name}"` with a track rooted on the Warlock element gives `level:warlock`, which is
 * what 150-odd content references in the Aurora corpus read and what nothing in it writes.
 * `{name}` is the element's name, lowercased; that is Aurora's own convention, and the corpus
 * depends on it.
 */
export function trackStatKey(progression: Progression, elementName: string): string | undefined {
  if (progression.kind === 'none' || !progression.trackStatPattern) return undefined;
  return progression.trackStatPattern.replace(TRACK_NAME_PLACEHOLDER, elementName.trim().toLowerCase());
}

/** ADR 0010 — official systems record the licence of the material they describe. */
export interface LicenceRef {
  id: string;
  name?: string;
  source?: string;
  attribution?: string;
  permitsCommercialUse?: boolean;
  /** ISO date the licence text was last read. Makes a licence change detectable. */
  verified?: string;
  url?: string;
}

/**
 * One kind of character a system can build.
 *
 * Every field except `id` is optional because a kind may `extends` another and state only
 * its differences — "legendary" is a delta on "npc", not a copy of it. Use
 * {@link resolveCharacterKind} to get the merged, complete form.
 */
export interface CharacterKindDef {
  id: string;
  name?: string;
  description?: string;
  /** The kind offered when a character does not name one. The first kind wins if none is marked. */
  default?: boolean;
  /** Id of another kind in this system to inherit from. ADR 0009. */
  extends?: string;
  progression?: Progression;
  /**
   * Element types this kind may use. When `extends` is set the list may be written as a
   * delta — `"+Lair Action"` adds, `"-Spell"` removes — in which case the parent's list is
   * inherited and patched. A list with no prefixed entry replaces the parent's outright.
   */
  elementTypes?: ElementType[];
  /** Stats this kind adds to the system's. Kinds inherit the system's stats (ADR 0009). */
  stats?: StatDef[];
  /**
   * Elements every character of this kind has, without choosing them.
   *
   * The system-definition answer to a question Aurora answers in application code: a 5e
   * character has a base armour class, adds its Dexterity modifier to it, and adds its
   * Constitution modifier to hit points, and no content file says so. Aurora's saves record
   * those as elements in every derivation; without a place to declare them, a character
   * built in Incudo can never match one built in Aurora.
   *
   * They are not choices and are not stored on the character — the kind declares them, so
   * they follow the system when it is updated. Replaced rather than merged along an
   * `extends` chain, like `buildSteps`.
   */
  grants?: ElementId[];
  /**
   * Stats contributed once per track — ADR 0018. Replaced rather than merged along an
   * `extends` chain, like `buildSteps` and `grants`.
   */
  trackStats?: TrackStatDef[];
  /**
   * Stats contributed once per declared block — ADR 0020. Replaced rather than merged along
   * an `extends` chain, like `trackStats`.
   */
  blockStats?: BlockStatDef[];
  /**
   * How a `$(key)` in a select's filter expands, per declared block — ADR 0030. Replaced
   * rather than merged along an `extends` chain, like `blockStats`. A kind declaring none
   * resolves no interpolation, and a select carrying one offers nothing and says so.
   */
  blockFilters?: BlockFilterDef[];
  /**
   * Setters that count as a tag when true, for a select's filter only — ADR 0047. Replaced rather
   * than merged along an `extends` chain, like `blockFilters`. A kind declaring none reads a filter's
   * operands as tags, ids and setter values, as before.
   */
  setterTags?: SetterTagDef[];
  /**
   * Stats this kind contributes itself, conditionally or not — ADR 0022. Replaced rather than
   * merged along an `extends` chain, like `trackStats` and `blockStats`.
   */
  contributions?: ContributionDef[];
  /**
   * How this kind reads an item's setters — ADR 0025. Replaced rather than merged along an
   * `extends` chain, like `trackStats` and `blockStats`. A kind without one evaluates no
   * `equipped=` condition and gates nothing on attunement.
   */
  inventory?: InventoryDef;
  /**
   * What a picker prints beside a candidate, per element type. Replaced rather than merged along
   * an `extends` chain, like `trackStats`. A kind that declares none prints a name and a source.
   */
  candidateNotes?: CandidateNoteDef[];
  /**
   * The setter an element carries to say it may be taken more than once — ADR 0035. Replaced
   * rather than merged along an `extends` chain, like `trackStats`. A kind that names none
   * treats every element as taken at most once, which is what the engine did before.
   *
   * The name is the system's and never core's: Aurora spells it "allow duplicate", another
   * format would not. An element that carries it (with a value that is not `false`) is offered
   * again by a select that already holds it, and its rules apply once for every time the
   * character chose it. Everything else is unchanged: a second Athletics is still no more
   * Athletics.
   */
  repeatableSetter?: string;
  /**
   * Which blocks let the player prepare a list, and where each number lives — ADR 0046. Replaced rather
   * than merged along an `extends` chain, like `inventory`. A kind without one publishes no prepared lists.
   */
  preparation?: PreparationDef;
  buildSteps?: BuildStepDef[];
  sheet?: SheetLayoutDef;
}

/** A {@link CharacterKindDef} with its `extends` chain applied and defaults filled in. */
export interface ResolvedCharacterKind {
  id: string;
  name: string;
  description?: string;
  default: boolean;
  progression: Progression;
  elementTypes: ElementType[];
  /** The system's stats, then this kind's. */
  stats: StatDef[];
  /** Elements every character of this kind has without choosing them. */
  grants: ElementId[];
  /** Stats each of the character's tracks contributes — ADR 0018. */
  trackStats: TrackStatDef[];
  /** Stats each block the character's elements declare contributes — ADR 0020. */
  blockStats: BlockStatDef[];
  /** How a select's `$(key)` expands, per declared block — ADR 0030. */
  blockFilters: BlockFilterDef[];
  /** Setters that are a tag when true, for a select's filter — ADR 0047. */
  setterTags: SetterTagDef[];
  /** Stats the kind itself contributes, conditionally or not — ADR 0022. */
  contributions: ContributionDef[];
  /** How an item's setters are read, or nothing at all — ADR 0025. */
  inventory?: InventoryDef;
  /** The setter that marks an element as repeatable, or none — ADR 0035. */
  repeatableSetter?: string;
  /** Which blocks prepare a list, or nothing at all — ADR 0046. */
  preparation?: PreparationDef;
  /** What a picker prints beside a candidate of certain types. */
  candidateNotes: CandidateNoteDef[];
  buildSteps: BuildStepDef[];
  sheet: SheetLayoutDef;
}

/**
 * A content index this system's author suggests — ADR 0031.
 *
 * Not content, and not a dependency. A system definition still ships no elements
 * ([ADR 0022](./0022)) and a character still opens with no sources at all (ADR 0012); this is
 * a *pointer*, the same thing Aurora's "Additional Content" tab held, so that the first thing
 * a new user meets is a list to pick from rather than an empty URL box.
 *
 * It lives on the system rather than in a catalogue beside the app for one reason: a
 * user-authored system (ADR 0011) has content of its own to point at, and a fork of an
 * official system should inherit the suggestions it was forked from. Nothing here is fetched
 * until the user says so.
 */
export interface SuggestedSource {
  /** The index URL. Becomes the `ConfiguredSource` id verbatim when the user adds it. */
  url: string;
  name: string;
  description?: string;
  /**
   * The system definition's author vouches for this one.
   *
   * **A claim, not a check.** Anyone can write `true` in their own system definition, so a
   * view must say *who* is vouching rather than presenting it as a verdict — for a system that
   * ships with Incudo that is the Incudo project, and for a fork it is whoever forked it.
   * Deliberately not a statement about the content's licence, quality or affiliation: the
   * projects these point at are other people's (ADR 0010).
   */
  official?: boolean;
}

export interface GameSystem {
  /** Bumped only by a breaking change to the system format itself. ADR 0011. */
  formatVersion: 1;
  id: string;
  name: string;
  /**
   * What this system is, **in a sentence a player would read**.
   *
   * A launcher card shows this, so it is user-facing prose: what the game is, who publishes
   * it, what it feels like. Not a note to whoever maintains the definition — the 5e one used
   * to read "the one Incudo is tested against… see docs/adr/0003", which is true, useful, and
   * exactly the wrong thing to put in front of someone choosing a game. Notes for maintainers
   * belong in `systems/README.md`.
   */
  description?: string;
  /**
   * An image to show beside the name, or nothing — a **reference**, never inline bytes.
   *
   * ADR 0007 is the rule: Incudo's own formats are JSON and images are never inlined, so this
   * is an `https:` URL or a path relative to the definition. Optional in the strongest sense:
   * a system with no logo gets a card with no image, and the app never draws a substitute. It
   * generates no artwork, not even a placeholder (see the README), and a generated glyph
   * standing in for a missing publisher logo is precisely where that would slip.
   */
  logo?: string;
  version: string;
  licence?: LicenceRef;
  /** A user overlay names the official system it patches. ADR 0011. */
  extends?: string;
  elementTypes: ElementTypeDef[];
  /** Stats shared by every kind. A kind may add its own. */
  stats: StatDef[];
  /**
   * How a build step's budget can produce its starting values — ADR 0017. Declared once for
   * the system and referenced by id, because a PC and an NPC generate ability scores the
   * same way and the cost table should not be written twice.
   */
  generationMethods?: GenerationMethodDef[];
  characterKinds: CharacterKindDef[];
  /**
   * Aurora element types that map onto this system's types. Only needed for systems that
   * want to consume Aurora content; a native Incudo system omits it.
   */
  auroraTypeMap?: Record<string, ElementType>;
  /** Content indexes to offer when the user adds a source — ADR 0031. */
  suggestedSources?: SuggestedSource[];
}

export function findStatDef(system: GameSystem, name: StatKey): StatDef | undefined {
  const lower = name.toLowerCase();
  return system.stats.find((s) => s.name.toLowerCase() === lower);
}

export function isKnownElementType(system: GameSystem, type: ElementType): boolean {
  return system.elementTypes.some((t) => t.name === type);
}

// --- character kinds -------------------------------------------------------

/** Depth cap on `extends`, so a cyclic or hostile system definition cannot hang the app. */
const MAX_KIND_DEPTH = 8;

export function findCharacterKind(
  system: GameSystem,
  kindId: string | undefined,
): CharacterKindDef | undefined {
  if (kindId === undefined) return defaultCharacterKindDef(system);
  return system.characterKinds.find((k) => k.id === kindId);
}

function defaultCharacterKindDef(system: GameSystem): CharacterKindDef | undefined {
  return system.characterKinds.find((k) => k.default) ?? system.characterKinds[0];
}

/** The kind a new character gets when the user does not pick one. */
export function defaultCharacterKindId(system: GameSystem): string | undefined {
  return defaultCharacterKindDef(system)?.id;
}

/**
 * Merge a kind with everything it extends.
 *
 * Throws on an unknown or cyclic `extends`: a half-resolved kind would produce a character
 * the user cannot trust. Callers loading user-authored systems validate first (see
 * `schema.ts`), so this should only ever fire on a genuine bug.
 */
export function resolveCharacterKind(
  system: GameSystem,
  kindId: string | undefined,
): ResolvedCharacterKind {
  const def = findCharacterKind(system, kindId);
  if (!def) {
    throw new Error(
      kindId === undefined
        ? `System "${system.id}" declares no character kinds.`
        : `System "${system.id}" has no character kind "${kindId}".`,
    );
  }

  // Root of the chain first, so each descendant patches what it inherited.
  const chain: CharacterKindDef[] = [];
  const seen = new Set<string>();
  let current: CharacterKindDef | undefined = def;
  while (current) {
    if (seen.has(current.id)) {
      throw new Error(`Character kind "${current.id}" extends itself, directly or indirectly.`);
    }
    seen.add(current.id);
    chain.unshift(current);
    if (chain.length > MAX_KIND_DEPTH) {
      throw new Error(
        `Character kind "${def.id}" extends more than ${MAX_KIND_DEPTH} levels deep.`,
      );
    }
    const parentId: string | undefined = current.extends;
    if (parentId === undefined) break;
    const parent: CharacterKindDef | undefined = system.characterKinds.find(
      (k) => k.id === parentId,
    );
    if (!parent) {
      throw new Error(
        `Character kind "${current.id}" extends "${parentId}", which this system does not declare.`,
      );
    }
    current = parent;
  }

  let name = def.id;
  let description: string | undefined;
  let progression: Progression = { kind: 'none' };
  let elementTypes: ElementType[] = [];
  // Keyed by name so a kind can *replace* an inherited stat, not just add to it: a
  // monster's proficiency bonus comes from its challenge rating, not from a level it
  // does not have. Insertion order is preserved, so declaration order still reads.
  const stats = new Map<string, StatDef>();
  for (const stat of system.stats) stats.set(stat.name.toLowerCase(), stat);
  let grants: ElementId[] = [];
  let trackStats: TrackStatDef[] = [];
  let blockStats: BlockStatDef[] = [];
  let blockFilters: BlockFilterDef[] = [];
  let setterTags: SetterTagDef[] = [];
  let contributions: ContributionDef[] = [];
  let inventory: InventoryDef | undefined;
  let repeatableSetter: string | undefined;
  let preparation: PreparationDef | undefined;
  let candidateNotes: CandidateNoteDef[] = [];
  let buildSteps: BuildStepDef[] = [];
  let sheet: SheetLayoutDef = { sections: [] };

  for (const layer of chain) {
    if (layer.name !== undefined) name = layer.name;
    if (layer.description !== undefined) description = layer.description;
    if (layer.progression !== undefined) progression = layer.progression;
    if (layer.elementTypes !== undefined) {
      elementTypes = applyElementTypeDelta(elementTypes, layer.elementTypes);
    }
    for (const stat of layer.stats ?? []) stats.set(stat.name.toLowerCase(), stat);
    if (layer.grants !== undefined) grants = layer.grants;
    if (layer.trackStats !== undefined) trackStats = layer.trackStats;
    if (layer.blockStats !== undefined) blockStats = layer.blockStats;
    if (layer.blockFilters !== undefined) blockFilters = layer.blockFilters;
    if (layer.setterTags !== undefined) setterTags = layer.setterTags;
    if (layer.contributions !== undefined) contributions = layer.contributions;
    if (layer.inventory !== undefined) inventory = layer.inventory;
    if (layer.repeatableSetter !== undefined) repeatableSetter = layer.repeatableSetter;
    if (layer.preparation !== undefined) preparation = layer.preparation;
    if (layer.candidateNotes !== undefined) candidateNotes = layer.candidateNotes;
    if (layer.buildSteps !== undefined) buildSteps = layer.buildSteps;
    if (layer.sheet !== undefined) sheet = layer.sheet;
  }

  return {
    id: def.id,
    name,
    description,
    default: def.default ?? false,
    progression,
    elementTypes,
    stats: [...stats.values()],
    grants,
    trackStats,
    blockStats,
    blockFilters,
    setterTags,
    contributions,
    inventory,
    repeatableSetter,
    preparation,
    candidateNotes,
    buildSteps,
    sheet,
  };
}

/**
 * `["+Lair Action", "-Spell"]` patches the inherited list; `["Race", "Class"]` replaces it.
 *
 * The whole array is one or the other: a single prefixed entry makes it a patch, and an
 * unprefixed entry inside a patch reads as an addition. What would be surprising is a list
 * that half-replaces, so that case does not exist.
 */
function applyElementTypeDelta(inherited: ElementType[], next: ElementType[]): ElementType[] {
  const isPatch = next.some((t) => t.startsWith('+') || t.startsWith('-'));
  if (!isPatch) return [...next];

  const result = [...inherited];
  for (const entry of next) {
    if (entry.startsWith('-')) {
      const at = result.indexOf(entry.slice(1));
      if (at >= 0) result.splice(at, 1);
      continue;
    }
    const added = entry.startsWith('+') ? entry.slice(1) : entry;
    if (!result.includes(added)) result.push(added);
  }
  return result;
}

// --- progression -----------------------------------------------------------

/**
 * The stat a kind's `progress` number is published as, or undefined when it has none.
 *
 * `level` defaults the stat name to "level" because that is what content written for
 * levelled systems references. It is still overridable, and still just a string here.
 */
export function progressionStat(progression: Progression): StatKey | undefined {
  switch (progression.kind) {
    case 'level':
      return progression.stat ?? 'level';
    case 'rating':
    case 'xp':
      return progression.stat;
    case 'none':
      return undefined;
  }
}

/** Where a freshly created character of this kind starts. */
export function initialProgress(progression: Progression): number {
  switch (progression.kind) {
    case 'level':
      return progression.min;
    case 'rating':
    case 'xp':
      return progression.min ?? 0;
    case 'none':
      return 0;
  }
}

/**
 * Elements a character of this kind has purely by existing: the kind's `grants`, plus one
 * per step of progression when the progression declares an `elementIdPattern`.
 *
 * The pattern's `{n}` is the step number, so `"ID_LEVEL_{n}"` at progress 8 yields
 * `ID_LEVEL_1` … `ID_LEVEL_8`. Aurora writes exactly those into every save, and content
 * genuinely references them (`requirements="!ID_LEVEL_1"`). Steps are whole numbers from
 * the progression's minimum, so a fractional challenge rating produces none — there is no
 * `ID_CR_0.25` to grant and no system asks for one.
 *
 * Not stored on the character: these follow the system definition, so fixing the 5e
 * baseline fixes every 5e character rather than only the ones saved afterwards (ADR 0006).
 */
export function baselineElementIds(kind: ResolvedCharacterKind, progress: number): ElementId[] {
  const ids = [...kind.grants];
  const progression = kind.progression;
  if (progression.kind === 'none' || !progression.elementIdPattern) return ids;

  const from = progression.min ?? 0;
  if (!Number.isInteger(from) || !Number.isInteger(progress)) return ids;
  // The cap is the progression's own maximum where it has one, so a corrupt `progress` of
  // 10^9 cannot make this allocate for a very long time.
  const to = Math.min(progress, progression.max ?? progress);
  for (let step = from; step <= to; step++) {
    ids.push(progression.elementIdPattern.replace('{n}', String(step)));
  }
  return ids;
}

/**
 * The sum of recorded results matching a pattern, one per point of progression — ADR 0019.
 *
 * `"hp:level:{n}"` on a level 8 character sums `hp:level:1` … `hp:level:8`. Bounded by the
 * progression rather than by what the record happens to contain, and that is the load-bearing
 * part: a character who drops from 20 to 5 counts five, and the other fifteen stay in the file
 * untouched. Deleting them on the way down and asking again on the way up would be a reroll
 * with extra steps, which ADR 0007 exists to prevent.
 *
 * Shares `baselineElementIds`'s arithmetic deliberately: whole steps only, capped by the
 * progression's own maximum so a corrupt `progress` cannot spin.
 */
export function sumRecordedRolls(
  rolls: Record<string, number> | undefined,
  progression: Progression,
  progress: number,
  pattern: string,
): number {
  if (!rolls || progression.kind === 'none') return 0;
  const from = progression.min ?? 0;
  if (!Number.isInteger(from) || !Number.isInteger(progress)) return 0;
  const to = Math.min(progress, progression.max ?? progress);
  let total = 0;
  for (let step = from; step <= to; step++) {
    total += rolls[pattern.replace('{n}', String(step))] ?? 0;
  }
  return total;
}

export function clampProgress(progression: Progression, value: number): number {
  if (progression.kind === 'none') return 0;
  let result = value;
  if (progression.min !== undefined) result = Math.max(result, progression.min);
  if (progression.max !== undefined) result = Math.min(result, progression.max);
  return result;
}
