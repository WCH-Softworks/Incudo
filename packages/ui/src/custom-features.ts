/**
 * The custom feature editor's state — ADR 0063.
 *
 * Everything the editor shows is worked out here, under `node --test`: which stats a feature may name and whether
 * each may be set, and what each line of each feature is doing to the character right now. A line that sets a stat
 * a typed value replaces says so, and so does one another feature's set beats. Where each is listed on the sheet is
 * here too (ADR 0065: a DM's legendary action is listed under Legendary Actions). The pane renders this and computes
 * nothing.
 */

import {
  customFeatureElementId,
  customFeatureStats,
  customFeatureTypes,
  type Character,
  type CustomFeatureStat,
  type CustomStatLine,
  type DerivedCharacter,
  type ElementId,
  type GameSystem,
  type ResolvedCharacterKind,
} from '@incudo/core';

/**
 * What a line is doing: `applied` as written; `replaced` by a value the user typed for that stat; `overruled` by an
 * earlier feature's set of the same stat; `add-only` because the stat is worked out and can only be added to;
 * `unknown` because the kind has no such stat; `not-held` because the feature is held as a type the kind does not list
 * (its `typeNote` says so).
 */
export type CustomLineStatus = 'applied' | 'replaced' | 'overruled' | 'add-only' | 'unknown' | 'not-held';

export interface CustomLineView extends CustomStatLine {
  /** The stat as the kind shows it, or the recorded name when the kind has no such stat. */
  label: string;
  status: CustomLineStatus;
  /** A sentence for the user when the line is not simply applied. */
  note?: string;
}

export interface CustomFeatureView {
  id: string;
  /** The element the feature is held as. */
  elementId: ElementId;
  name: string;
  description: string;
  /** The type it is held as: the one it records, or the kind's default. */
  type: string;
  /**
   * Where it is listed, as the sheet heads that list: a `types` entry's label, or, for a type the kind does not
   * list, the system's name for that list and "(not available)", never the type's own name.
   */
  typeLabel: string;
  /**
   * A sentence when the type it records is one the kind does not list: it is then not held, listed nowhere, and its
   * lines change nothing (ADR 0065).
   */
  typeNote?: string;
  lines: CustomLineView[];
}

/** A type a feature may be held as, named as the sheet heads its list. */
export interface CustomFeatureType {
  type: string;
  label: string;
}

export interface CustomFeaturesState {
  /** Whether this kind of character may carry custom features at all. */
  available: boolean;
  /** What a line may name, in the kind's order. */
  stats: CustomFeatureStat[];
  /** Where a feature may be listed, the kind's default first; one entry when there is nothing to choose. */
  types: CustomFeatureType[];
  features: CustomFeatureView[];
}

export function customFeaturesState(
  character: Character,
  derived: DerivedCharacter,
  kind: ResolvedCharacterKind,
  system: GameSystem,
): CustomFeaturesState {
  const stats = customFeatureStats(kind);
  // A list's heading: the system's plural for the type, else its name, else the type as recorded.
  const headingOf = (type: string): string => {
    const def = system.elementTypes.find((t) => t.name === type);
    return def?.plural ?? def?.name ?? type;
  };
  const types = customFeatureTypes(kind).map((type): CustomFeatureType => ({ type, label: headingOf(type) }));
  const fallback = kind.customFeatures?.type ?? '';
  const byKey = new Map(stats.map((s) => [s.stat.toLowerCase(), s]));
  const typed = new Map(Object.entries(character.baseStats ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const features = (character.customFeatures ?? []).map((feature): CustomFeatureView => {
    const elementId = customFeatureElementId(feature.id);
    const type = feature.type ?? fallback;
    const listed = types.find((t) => t.type === type);
    const lines = feature.stats.map((line): CustomLineView => {
      const key = line.stat.toLowerCase();
      const stat = byKey.get(key);
      if (!listed) return { ...line, label: stat?.fullLabel ?? line.stat, status: 'not-held' };
      if (!stat) {
        return { ...line, label: line.stat, status: 'unknown', note: `This character has no "${line.stat}". The line changes nothing.` };
      }
      const view = { ...line, stat: stat.stat, label: stat.fullLabel };
      if (line.mode === 'add') return { ...view, status: 'applied' };
      if (!stat.settable) {
        return { ...view, status: 'add-only', note: `${stat.fullLabel} is worked out from other numbers, so it can only be added to. The line changes nothing.` };
      }
      const start = derived.starts.get(key);
      if (start?.from !== elementId) {
        const other = start?.feature?.trim() || 'another feature';
        return { ...view, status: 'overruled', note: `${other} also sets ${stat.fullLabel} and comes first, so this line is not used.` };
      }
      if (start.replaced) {
        return {
          ...view,
          status: 'replaced',
          note: `The ${typed.get(key) ?? ''} entered for ${stat.fullLabel} replaces this. Clear that entry to use ${line.value}.`,
        };
      }
      return { ...view, status: 'applied' };
    });
    return {
      id: feature.id,
      elementId,
      name: feature.name,
      description: feature.description ?? '',
      type,
      typeLabel: listed ? listed.label : `${headingOf(type)} (not available)`,
      ...(listed
        ? {}
        : { typeNote: `This character has no "${headingOf(type)}", so the feature is not on it and changes nothing. Choose where to list it.` }),
      lines,
    };
  });
  return { available: kind.customFeatures !== undefined, stats, types, features };
}

/**
 * A new line on `stat`, or on the first stat that may be set when none is named. A set starts at the number the
 * character has now, so choosing Speed shows the creature's 40 ready to change; an add starts at 0. Undefined when
 * the kind offers no stat at all.
 */
export function newCustomStatLine(
  stats: readonly CustomFeatureStat[],
  derived: DerivedCharacter,
  stat?: string,
): CustomStatLine | undefined {
  const target = stat === undefined ? (stats.find((s) => s.settable) ?? stats[0]) : stats.find((s) => s.stat === stat);
  if (!target) return undefined;
  if (!target.settable) return { stat: target.stat, mode: 'add', value: 0 };
  return { stat: target.stat, mode: 'set', value: derived.stats.get(target.stat.toLowerCase())?.value ?? 0 };
}

/**
 * A line moved to another stat. An add keeps its number; a set starts again at the new stat's current number, and
 * becomes an add when the new stat can only be added to.
 */
export function customLineOnStat(
  line: CustomStatLine,
  stat: string,
  stats: readonly CustomFeatureStat[],
  derived: DerivedCharacter,
): CustomStatLine {
  if (line.mode === 'add') return { ...line, stat };
  return newCustomStatLine(stats, derived, stat) ?? { ...line, stat };
}
