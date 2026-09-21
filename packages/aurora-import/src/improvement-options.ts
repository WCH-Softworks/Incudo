/**
 * The ability score improvement Aurora's app offers at every class level, written down.
 *
 * Every class's `Ability Score Improvement` feature declares one `<select>` per level that
 * grants one:
 *
 * ```xml
 * <select type="Class Feature" name="Improvement Option (Fighter 4)"
 *         supports="Improvement Option,Fighter,4" level="4" />
 * ```
 *
 * and no file in the corpus declares what those selects offer. Counted in the 740-file
 * AuroraLegacy corpus: 88 of the 123 select filters that match nothing at all are this one
 * protocol — 73 `Improvement Option,<class>,<level>` and 15 `Ability Score Improvement,Class`
 * — so a level 4 character had a blocking decision with no candidates and no way to close it.
 *
 * **It is not missing content, it is the app.** The only classes whose options are written out
 * are the two Artificers, under a comment reading "v1.19.3XX workaround" (`ID_WOTC_ERLW_CLASS_
 * FEATURE_ABILITY_4` and its siblings), which is the one place the *shape* is written down. The
 * a set of real saves say the rest. They record, per level, a registered element with an id
 * nobody declares —
 *
 * ```
 * Improvement Option (Fighter 4)   ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER
 *   Feat (FIGHTER 4)               ID_PHB_FEAT_TOUGH
 * Improvement Option (Fighter 12)  ID_INTERNAL_CLASS_FEATURE_ASI_12_FIGHTER
 *   Ability Score Increase (FIGHTER 12) ×2   ID_INTERNAL_ASI_CONSTITUTION
 * ```
 *
 * — which fixes the id (`ID_INTERNAL_CLASS_FEATURE_{ASI|FEAT}_{level}_{CLASS}`, upper-cased),
 * the two select names and the type each offers. It held on every save that has one: seven
 * classes across nine characters, no exception. `import-character.ts` already rebuilds these
 * as rule-less stand-ins so a save keeps its shape; this is the same family generated *before*
 * a character exists, with the rules the stand-ins could not have.
 *
 * **Derived from the loaded content, not listed.** The set of classes is content: a third-party
 * class writes the same select and gets the same treatment. So this reads every `Improvement
 * Option` select in what is loaded and generates an ASI option and a feat option for each
 * (class, level) that no element already declares. Run against AuroraLegacy that is 73 pairs
 * and 146 elements; the Artificers are skipped because their own file declares them, and a
 * source that ever declares one of the others wins the same way it wins against
 * `auroraGeneratedElements`.
 *
 * **The feat half is gated, not offered.** It carries `requirements="ID_INTERNAL_OPTION_ALLOW_FEATS"`,
 * exactly as all three Artificer workarounds do, so a campaign that does not use feats is never
 * offered one. Nothing here builds the way to switch that option on — that is ADR 0032's
 * `multiple: true` — but the element is what eight of the nine characters in a set of real saves actually took
 * at level 4, so leaving it out would make their imports less faithful for no saving.
 *
 * **What is inferred, and from what.** `Ability Score Improvement,Class` is the one filter
 * whose tags nothing carries: 15 uses, every one inside an ASI option, matching no tag on any of
 * the 14,316 elements. The six `ID_INTERNAL_ASI_*` elements are what the saves record being
 * chosen for it, and they carry those two tags in `generated-elements.ts` for that reason. The
 * count of two picks is the filter's own `number="2"` in the Artificer copies.
 */

import {
  parseRequirements,
  parseSupports,
  type Element,
  type ElementId,
  type Rule,
} from '@incudo/core';

/** The tag that marks an element as one of the choices a class's improvement level offers. */
const OPTION_TAG = 'Improvement Option';

/** What the ASI option's select offers, and how many picks it is — the Artificers' own text. */
const ASI_SUPPORTS = 'Ability Score Improvement,Class';
const ASI_PICKS = 2;
const ASI_TYPE = 'Ability Score Improvement';

const FEATS_OPTION = 'ID_INTERNAL_OPTION_ALLOW_FEATS';

export interface ImprovementOptionElements {
  /** Every generated element, sorted by id. */
  elements: Element[];
  /** How many (class, level) pairs the loaded content asks for and nothing declares. */
  pairs: number;
}

export interface ImprovementOptionOptions {
  /** Recorded as `origin.sourceId`. Defaults to the same id `auroraGeneratedElements` uses. */
  sourceId?: string;
}

/**
 * The (class, level) pairs a set of elements ask an improvement for, in the order first seen.
 * The class is exactly as content wrote it — `Fighter`, `Eberron Artificer` — and the level a
 * string, because both are compared against tags, which are text.
 */
function requestedPairs(elements: readonly Element[]): Array<{ cls: string; level: string }> {
  const seen = new Set<string>();
  const pairs: Array<{ cls: string; level: string }> = [];
  for (const element of elements) {
    for (const rule of element.rules) {
      if (rule.kind !== 'select' || !rule.supports || rule.supports.kind !== 'and') continue;
      const tags = rule.supports.children.map((child) => (child.kind === 'tag' ? child.tag : ''));
      if (tags.length !== 3 || tags[0]!.toLowerCase() !== OPTION_TAG.toLowerCase()) continue;
      const [, cls, level] = tags as [string, string, string];
      if (!cls || !/^\d+$/.test(level)) continue;
      const key = `${cls.toLowerCase()}|${level}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ cls, level });
    }
  }
  return pairs;
}

/** The pairs some element already declares, by carrying `Improvement Option, <class>, <level>`. */
function declaredPairs(elements: readonly Element[]): Set<string> {
  const declared = new Set<string>();
  for (const element of elements) {
    const tags = element.supports.map((tag) => tag.trim());
    if (tags[0]?.toLowerCase() !== OPTION_TAG.toLowerCase() || tags.length !== 3) continue;
    declared.add(`${tags[1]!.toLowerCase()}|${tags[2]}`);
  }
  return declared;
}

/**
 * `ID_INTERNAL_CLASS_FEATURE_ASI_12_FIGHTER`. Upper-cased, and anything that is not a letter or a
 * digit becomes an underscore, which is how every id in the corpus is written. No class in
 * AuroraLegacy has a space in its name, so the substitution has not been exercised against a
 * real save.
 */
function optionId(kind: 'ASI' | 'FEAT', level: string, cls: string): ElementId {
  return `ID_INTERNAL_CLASS_FEATURE_${kind}_${level}_${cls.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/**
 * Generate the improvement options the loaded content asks for and no element declares.
 *
 * Pure: it reads the elements it is given and returns new ones, so the content layer decides
 * where they go. Deterministic and sorted, for the reason `auroraGeneratedElements` is — what it
 * returns ends up checksummed inside users' saves.
 */
export function improvementOptionElements(
  loaded: Iterable<Element>,
  options: ImprovementOptionOptions = {},
): ImprovementOptionElements {
  const all = [...loaded];
  const sourceId = options.sourceId ?? 'aurora:generated';
  const declared = declaredPairs(all);
  const existing = new Set(all.map((element) => element.id));

  const elements: Element[] = [];
  let pairs = 0;
  for (const { cls, level } of requestedPairs(all)) {
    if (declared.has(`${cls.toLowerCase()}|${level}`)) continue;
    pairs++;

    const label = `${cls.toUpperCase()} ${level}`;
    const supports = [OPTION_TAG, cls, level];
    const asi = optionId('ASI', level, cls);
    const feat = optionId('FEAT', level, cls);

    if (!existing.has(asi)) {
      const rules: Rule[] = [
        {
          kind: 'select',
          key: `select:Ability Score Increase (${label})`,
          type: ASI_TYPE,
          name: `Ability Score Increase (${label})`,
          supports: parseSupports(ASI_SUPPORTS),
          number: ASI_PICKS,
        },
      ];
      elements.push({
        id: asi,
        type: 'Class Feature',
        name: 'Ability Score Improvement',
        source: 'Internal',
        setters: {},
        rules,
        supports,
        description:
          '<p>Increase one ability score by 2, or two ability scores by 1 each. A score cannot go above 20 this way.</p>',
        origin: { sourceId, format: 'aurora' },
      });
    }

    if (!existing.has(feat)) {
      elements.push({
        id: feat,
        type: 'Class Feature',
        name: 'Feat',
        source: 'Internal',
        setters: {},
        rules: [
          {
            kind: 'select',
            key: `select:Feat (${label})`,
            type: 'Feat',
            name: `Feat (${label})`,
            number: 1,
          },
        ],
        supports,
        requirements: parseRequirements(FEATS_OPTION),
        description: '<p>Take a feat instead of an ability score improvement.</p>',
        origin: { sourceId, format: 'aurora' },
      });
    }
  }

  elements.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { elements, pairs };
}
