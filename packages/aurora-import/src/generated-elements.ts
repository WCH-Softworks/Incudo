/**
 * The elements Aurora's app generates at runtime, written down.
 *
 * Aurora references a set of ids that no XML file in the corpus declares. They are not typos
 * and not missing content: the Aurora application materializes them itself, so a reader that
 * only reads files sees dangling references and a character sheet full of holes. There are
 * three families, and the last two are only visible from a save:
 *
 *  - **51 the corpus references.** Damage resistances, sizes, the six ability-score bumps,
 *    a dozen behaviour markers. Before this overlay these were 51 of the 57 unresolved
 *    references in the AuroraLegacy baseline.
 *  - **29 only real saves name.** Twenty levels, two campaign options, and the seven
 *    baseline grants every 5e character carries. No content file mentions them; every one
 *    appears in the `<sum>` block of all eight sample saves, which is Aurora's own record of
 *    a derivation it performed. `ID_SIZE_MEDIUM` is in all eight too.
 *  - **3 only real *bags* name** — `ITEM_PROXIES` below. Aurora lets a user put a bare
 *    language or ability bump in the inventory, and materializes an `Item` to hold it.
 *    These surfaced when the importer started reading `<equipment>` (step 2 of
 *    docs/INVENTORY-AND-AC-PLAN.md); they are the only ids in the nine sample bags that
 *    neither the 740 files nor the other 80 declare.
 *
 * This overlay declares them. It is not a content fix: ADR 0005 says the importer never
 * mutates upstream files, so this sits beside the corpus rather than in it, and it is
 * `format: 'aurora'`, `source: 'Internal'` — the same source string `core/internal.xml`
 * uses for the ids Aurora does happen to ship.
 *
 * **What gets rules and what does not.** Only where the corpus makes the meaning
 * unambiguous. `ID_INTERNAL_ASI_STRENGTH` is granted by an item Aurora names
 * `…ITEM_ASI_STRENGTH_INCREASE_1` and offered by the changeling's +1 choice, so it is +1 to
 * strength and carries a stat rule. `ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE` names a
 * mechanic no Incudo system definition models yet; giving it an invented stat would be
 * exactly the silent guess ADR 0005 rules out. Those are marker elements: real identity,
 * no rules, and the mechanic arrives when a system declares a stat for it. The 5e baseline
 * grants are markers for a different reason: `systems/dnd5e/system.json` already declares
 * the arithmetic as stats, and a second copy here is the one that would go stale.
 *
 * **Which of these a character has is not decided here.** The overlay only makes them exist.
 * `systems/dnd5e/system.json` says which are granted, through the character kind's `grants`
 * and its progression's `elementIdPattern` — so a character built in Incudo gets the same
 * baseline as one imported from Aurora, which would not be true if the importer supplied it.
 *
 * Six references still do not resolve after this, and they are genuine upstream mistakes —
 * see `KNOWN_UPSTREAM_TYPOS`. They stay broken on purpose, because a validator that reports
 * them is how they eventually get fixed.
 */

import type { Element, ElementId, Rule, Setter } from '@incudo/core';

/** Default `origin.sourceId` for overlay elements, so their provenance is never ambiguous. */
export const GENERATED_SOURCE_ID = 'aurora:generated';

/** What `element.source` reads as. Matches Aurora's own `core/internal.xml`. */
const GENERATED_SOURCE = 'Internal';

export interface GeneratedElementOptions {
  /** Recorded as `origin.sourceId`. */
  sourceId?: string;
}

/**
 * The setter Aurora content uses to say an element may be picked again. `systems/dnd5e/system.json`
 * names the same string as its kind's `repeatableSetter`, so a character built in Incudo and one
 * imported from Aurora agree about which elements count once per pick (ADR 0035).
 */
export const REPEATABLE_SETTER = 'allow duplicate';

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

const DAMAGE_TYPES_IMMUNITY = ['acid', 'cold', 'fire', 'lightning', 'poison', 'thunder'];

const DAMAGE_TYPES_RESISTANCE = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
];

const DAMAGE_TYPES_VULNERABILITY = ['bludgeoning', 'lightning', 'piercing', 'slashing'];

const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan', 'Colossal'];

/**
 * Levels. `ID_LEVEL_1` … `ID_LEVEL_20`, one per level a 5e character can reach.
 *
 * These are in the `<sum>` of every sample save and content references them
 * (`requirements="!ID_LEVEL_1"`), but no file declares one. Which of them a character has
 * is not decided here — `systems/dnd5e/system.json` says `"elementIdPattern":
 * "ID_LEVEL_{n}"` and the engine grants one per level. This only makes them exist.
 */
const MAX_LEVEL = 20;

/** Marker elements: identity only. The second field is the name a sheet would print. */
const MARKERS: Array<[id: string, type: string, name: string, description: string]> = [
  // The 5e baseline, referenced by every save's <sum>. The arithmetic behind them —
  // base AC 10, +Dex to AC, +Con to hit points — is declared by the system definition's
  // stats, so these carry identity and nothing else. Restating the maths here would put
  // it in two places, and the second copy is always the one that goes stale.
  [
    'ID_INTERNAL_GRANTS_CHARACTER_BASE',
    'Grants',
    'Character Base',
    'What every character has before any content applies. Aurora keeps this in application code.',
  ],
  [
    'ID_INTERNAL_GRANTS_ARMOR_CLASS_BASE',
    'Grants',
    'Base Armor Class',
    'The unarmoured base your armour class starts from.',
  ],
  [
    'ID_INTERNAL_GRANTS_ARMOR_CLASS_DEXTERITY_MODIFIER',
    'Grants',
    'Dexterity Modifier to Armor Class',
    'Your Dexterity modifier applies to your armour class.',
  ],
  [
    'ID_INTERNAL_GRANTS_HP_CONSTITUTION_MODIFIER',
    'Grants',
    'Constitution Modifier to Hit Points',
    'Your Constitution modifier applies to your hit points at every level.',
  ],
  [
    'ID_INTERNAL_GRANTS_SPELLCASTING_BASE',
    'Grants',
    'Spellcasting Base',
    'The spellcasting scaffolding every character carries, used or not.',
  ],
  [
    'ID_INTERNAL_GRANTS_MULTICLASS_SPELLCASTING',
    'Grants',
    'Multiclass Spellcasting',
    'The multiclass spell slot machinery. Aurora computes the table in application code.',
  ],
  [
    'ID_INTERNAL_GRANTS_MULTICLASSING_PREREQUISITE',
    'Grants',
    'Multiclassing Prerequisites',
    'The ability score minimums a second class requires.',
  ],
  // Campaign options. Aurora shows these as checkboxes; content tests for them 200-odd
  // times ("the Human Variant exists only if your campaign uses feats").
  [
    'ID_INTERNAL_OPTION_ALLOW_FEATS',
    'Option',
    'Feats',
    'This campaign uses the optional feat rules.',
  ],
  [
    'ID_INTERNAL_OPTION_ALLOW_MULTICLASSING',
    'Option',
    'Multiclassing',
    'This campaign uses the optional multiclassing rules.',
  ],
  [
    'ID_INTERNAL_RITUAL_CASTING',
    'Grants',
    'Ritual Casting',
    'You can cast spells that have the ritual tag as rituals.',
  ],
  [
    'ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE',
    'Grants',
    'Stealth Disadvantage',
    'You have disadvantage on Dexterity (Stealth) checks.',
  ],
  [
    'ID_INTERNAL_GRANTS_IGNORE_STEALTH_DISADVANTAGE',
    'Grants',
    'Ignore Stealth Disadvantage',
    'You ignore the disadvantage on Dexterity (Stealth) checks that armor would impose.',
  ],
  [
    'ID_INTERNAL_GRANTS_INITIATIVE_ADVANTAGE',
    'Grants',
    'Initiative Advantage',
    'You have advantage on initiative rolls.',
  ],
  [
    'ID_INTERNAL_GRANTS_WEIGHT_CAPACITY_DOUBLED',
    'Grants',
    'Carrying Capacity Doubled',
    'Your carrying capacity and the weight you can push, drag or lift are doubled.',
  ],
  [
    'ID_INTERNAL_GRANTS_WEIGHT_CAPACITY_COUNTS_AS_LARGER',
    'Grants',
    'Counts as One Size Larger',
    'You count as one size larger when determining your carrying capacity.',
  ],
  [
    'ID_INTERNAL_GRANT_MULTICLASS',
    'Grants',
    'Multiclassed',
    'Aurora sets this once a character has levels in more than one class; 24 elements test for it.',
  ],
  [
    'ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_FULL',
    'Grants',
    'Multiclass Spellcaster (Full)',
    'This class contributes its full level to the multiclass spell slot table.',
  ],
  [
    'ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF',
    'Grants',
    'Multiclass Spellcaster (Half)',
    'This class contributes half its level to the multiclass spell slot table.',
  ],
  [
    'ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD',
    'Grants',
    'Multiclass Spellcaster (Third)',
    'This class contributes a third of its level to the multiclass spell slot table.',
  ],
  [
    'ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_SOLO',
    'Grants',
    'Multiclass Spellcaster (Independent)',
    'This class keeps its own spell slots rather than joining the multiclass table.',
  ],
  [
    'ID_INTERNAL_GRANT_OPTIONAL_BACKGROUND_FEATURE',
    'Grants',
    'Optional Background Feature',
    'Aurora sets this when the optional background features rule is in use; 85 elements test for it.',
  ],
  [
    'ID_INTERNAL_PROFICIENCY_SPELLFOCUS_GROUP_ARCANE_FOCUS',
    'Proficiency',
    'Spellcasting Focus (Arcane Focus)',
    'You can use an arcane focus as a spellcasting focus.',
  ],
  [
    'ID_INTERNAL_PROFICIENCY_SPELLFOCUS_GROUP_HOLY_SYMBOL',
    'Proficiency',
    'Spellcasting Focus (Holy Symbol)',
    'You can use a holy symbol as a spellcasting focus.',
  ],
  [
    'ID_INTERNAL_PROFICIENCY_SPELLFOCUS_GROUP_MUSICAL_INSTRUMENT',
    'Proficiency',
    'Spellcasting Focus (Musical Instrument)',
    'You can use a musical instrument as a spellcasting focus.',
  ],
];

/**
 * Inventory proxies: an `Item` whose entire content is that it hands you one other element.
 *
 * Aurora's inventory can hold things that are not equipment. "Additional Language, Orc" and
 * "Additional Ability Score Improvement, Intelligence" are how the app records a language or
 * an ability bump the character was simply given, and it materializes an Item to hang them
 * on. All three are `hidden="true"` in the save, are in its `<sum>`, and are declared by no
 * file in the corpus. They are the only three ids across the nine sample bags that neither
 * the 740 files nor the 80 elements above declare.
 *
 * **Each carries one grant, and the grant is the identity.** This is the same carve-out the
 * six `ID_INTERNAL_ASI_*` elements sit in and it is not a general licence to put mechanics
 * here (ADR 0022: an element's rules are frozen into every save that embeds it). An element
 * called "Additional Language, Orc" that does not give you Orc is not a marker with a
 * missing mechanic, it is nothing at all. Two independent things say so rather than one:
 *
 *  - **The save writes the grant outright**, as the proxy's only child in the build tree:
 *
 *    ```xml
 *    <element type="Item" name="Additional Language, Orc" id="ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_LANGUAGE_ORC">
 *      <element type="Language" name="Orc" id="ID_LANGUAGE_ORC" />
 *    </element>
 *    ```
 *
 *  - **The corpus declares two proxies of this family itself** —
 *    `ID_INTERNAL_ITEM_PROXY_FAMILIAR_SELECTION` and `…_COMPANION_SELECTION`, both
 *    `type="Item"`, both hidden from the sheet, and both carrying the one rule they exist
 *    for (a `<select>`). So an inventory proxy with a rule on it is the established shape
 *    and not a new one.
 *
 * Nothing about the *size* of the bump is invented here: `ID_INTERNAL_ASI_INTELLIGENCE` is
 * already in this overlay carrying its +1, and the two languages are ordinary corpus
 * elements. (The ASI proxy is a distinct thing from the Tome of Clear Thought, which sits in
 * the same sample bag and carries its own `+2` as an ordinary corpus element.) That makes
 * these the first overlay elements to reference content outside the overlay, which is worth
 * knowing: validating an index with no `ID_LANGUAGE_ORC` now reports one more unresolved
 * reference than it used to. Both language ids are in AuroraLegacy's `core`.
 *
 * Nothing derives from them yet — step 2 stores the bag and step 3 seeds it.
 */
const ITEM_PROXIES: Array<[id: string, name: string, grants: [type: string, id: string]]> = [
  [
    'ID_PHB_INTERNAL_ITEM_PROXY_ASI_INTELLIGENCE',
    'Additional Ability Score Improvement, Intelligence',
    ['Ability Score Improvement', 'ID_INTERNAL_ASI_INTELLIGENCE'],
  ],
  [
    'ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_LANGUAGE_GNOMISH',
    'Additional Language, Gnomish',
    ['Language', 'ID_LANGUAGE_GNOMISH'],
  ],
  [
    'ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_LANGUAGE_ORC',
    'Additional Language, Orc',
    ['Language', 'ID_LANGUAGE_ORC'],
  ],
];

/**
 * References that stay unresolved, with what they were meant to say.
 *
 * Kept as data rather than prose so `validate` can tell a known upstream mistake apart from
 * a new one, and so this list shrinks visibly when AuroraLegacy fixes one. Nothing here is
 * synthesized: inventing an element to paper over a typo would hide the typo forever, and
 * these are one-character fixes somebody upstream can still make.
 *
 * Only the first is a broken *grant*, and so the corpus's entire unresolved-reference
 * budget. The other five are named by a requirement, where an id that does not exist simply
 * reads false — still worth fixing, never worth failing a build over.
 */
export const KNOWN_UPSTREAM_TYPOS: Array<{ id: ElementId; note: string }> = [
  {
    id: 'ID_INTERNAL_CONDITION_DAMAGE_VULNERAILITY_BLUDGEONING',
    note: 'Misspelled "VULNERAILITY"; ID_INTERNAL_CONDITION_DAMAGE_VULNERABILITY_BLUDGEONING exists.',
  },
  {
    id: 'ID_PHB_SPELL_ARCANA_EYE',
    note: 'Misspelled "ARCANA"; the spell is ID_PHB_SPELL_ARCANE_EYE.',
  },
  {
    id: 'ID_WOTC_PHB24_SPELL_ARCANA_EYE',
    note: 'Misspelled "ARCANA"; the 2024 spell is ID_WOTC_PHB24_SPELL_ARCANE_EYE.',
  },
  {
    id: 'ID_WOCT_PSA_BACKGROUND_FEATURE_DISSENTER_SHELTER_OF_DISSENTERS',
    note: 'Misspelled publisher prefix "WOCT"; every other id in that file uses WOTC.',
  },
  {
    id: 'ID_ARCHETYPE_FEATURE_BATTLE_MASTER_COMBAT_SUPERIORITY',
    note: 'Referenced but never declared. The Battle Master feature is ID_WOTC_PHB_ARCHETYPE_FEATURE_BATTLE_MASTER_COMBAT_SUPERIORITY.',
  },
  {
    id: 'ID_WOTC_WGTE_GRANTS_DARKMARKED',
    note: 'Referenced but never declared in the corpus.',
  },
];

/**
 * Every element Aurora generates at runtime.
 *
 * Deterministic and sorted: this feeds a content index whose contents end up checksummed
 * inside users' saves, so it must produce the same bytes every time.
 */
export function auroraGeneratedElements(options: GeneratedElementOptions = {}): Element[] {
  const sourceId = options.sourceId ?? GENERATED_SOURCE_ID;
  const elements: Element[] = [];

  for (const ability of ABILITIES) {
    elements.push(
      make(sourceId, {
        id: `ID_INTERNAL_ASI_${ability.toUpperCase()}`,
        type: 'Ability Score Improvement',
        name: `${capitalize(ability)} +1`,
        description: `Increase your ${capitalize(ability)} score by 1.`,
        // The one place in this file with a mechanic, and the corpus states it twice: the
        // item that grants this is named "…ASI_STRENGTH_INCREASE_1", and the changeling
        // offers the six of them as its single +1.
        rules: [{ kind: 'stat', key: 'stat-0', name: ability, value: { kind: 'number', value: 1 } }],
        // What a class's improvement level filters on — `Ability Score Improvement,Class`, 15
        // uses in the corpus and a tag nothing else carries — and the setter that lets one
        // ability be picked twice. Both are inferred, and improvement-options.ts says from what:
        // the saves record these six ids being chosen for exactly that select, and Vigaro
        // Safeguard's level 12 Fighter chose Constitution twice, which is how "+2" is written.
        supports: ['Ability Score Improvement', 'Class'],
        setters: { [REPEATABLE_SETTER]: { value: 'true' } },
      }),
    );
  }

  for (const damage of DAMAGE_TYPES_IMMUNITY) {
    elements.push(
      make(sourceId, {
        id: `ID_INTERNAL_CONDITION_DAMAGE_IMMUNITY_${damage.toUpperCase()}`,
        type: 'Condition',
        name: `Immunity to ${capitalize(damage)} Damage`,
        description: `You are immune to ${damage} damage.`,
      }),
    );
  }

  for (const damage of DAMAGE_TYPES_RESISTANCE) {
    elements.push(
      make(sourceId, {
        id: `ID_INTERNAL_CONDITION_DAMAGE_RESISTANCE_${damage.toUpperCase()}`,
        type: 'Condition',
        name: `Resistance to ${capitalize(damage)} Damage`,
        description: `You have resistance to ${damage} damage.`,
      }),
    );
  }

  for (const damage of DAMAGE_TYPES_VULNERABILITY) {
    elements.push(
      make(sourceId, {
        id: `ID_INTERNAL_CONDITION_DAMAGE_VULNERABILITY_${damage.toUpperCase()}`,
        type: 'Condition',
        name: `Vulnerability to ${capitalize(damage)} Damage`,
        description: `You have vulnerability to ${damage} damage.`,
      }),
    );
  }

  for (const size of SIZES) {
    elements.push(
      make(sourceId, {
        id: `ID_SIZE_${size.toUpperCase()}`,
        type: 'Size',
        name: size,
        description: `Your size is ${size}.`,
      }),
    );
  }

  for (let level = 1; level <= MAX_LEVEL; level++) {
    elements.push(
      make(sourceId, {
        id: `ID_LEVEL_${level}`,
        type: 'Level',
        name: String(level),
        description: `Character level ${level}.`,
      }),
    );
  }

  for (const [id, type, name, description] of MARKERS) {
    elements.push(make(sourceId, { id, type, name, description }));
  }

  for (const [id, name, [grantType, grantId]] of ITEM_PROXIES) {
    elements.push(
      make(sourceId, {
        id,
        type: 'Item',
        name,
        description: `Aurora's placeholder for ${name.toLowerCase()}. It has no weight and no cost; all it does is grant ${grantId}.`,
        rules: [{ kind: 'grant', key: 'grant-0', type: grantType, id: grantId }],
      }),
    );
  }

  return elements.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The element types this overlay introduces that a system definition must declare for its
 * elements to appear anywhere. `Size` and `Condition` exist only here: the corpus grants
 * both types 117 and 350-odd times but never declares an element of either. `Item` is the
 * odd one out — the corpus is full of them, and the three inventory proxies simply join it.
 */
export const GENERATED_ELEMENT_TYPES = ['Size', 'Condition', 'Level', 'Option', 'Item'];

interface Spec {
  id: string;
  type: string;
  name: string;
  description: string;
  rules?: Rule[];
  supports?: string[];
  setters?: Record<string, Setter>;
}

function make(sourceId: string, spec: Spec): Element {
  return {
    id: spec.id,
    type: spec.type,
    name: spec.name,
    source: GENERATED_SOURCE,
    setters: spec.setters ?? {},
    rules: spec.rules ?? [],
    supports: spec.supports ?? [],
    description: `<p>${spec.description}</p>`,
    origin: { sourceId, format: 'aurora' },
  };
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
