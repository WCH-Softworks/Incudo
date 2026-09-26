/**
 * The custom feature editor's state — ADR 0063.
 *
 * Everything the editor shows is worked out here, under `node --test`: which stats a feature may name and whether
 * each may be set, and what each line of each feature is doing to the character right now. A line that sets a stat
 * a typed value replaces says so, and so does one another feature's set beats. The pane renders this and computes
 * nothing.
 */

import {
  customFeatureElementId,
  customFeatureStats,
  type Character,
  type CustomFeatureStat,
  type CustomStatLine,
  type DerivedCharacter,
  type ElementId,
  type ResolvedCharacterKind,
} from '@incudo/core';

/**
 * What a line is doing: `applied` as written; `replaced` by a value the user typed for that stat; `overruled` by an
 * earlier feature's set of the same stat; `add-only` because the stat is worked out and can only be added to;
 * `unknown` because the kind has no such stat.
 */
export type CustomLineStatus = 'applied' | 'replaced' | 'overruled' | 'add-only' | 'unknown';

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
  lines: CustomLineView[];
}

export interface CustomFeaturesState {
  /** Whether this kind of character may carry custom features at all. */
  available: boolean;
  /** What a line may name, in the kind's order. */
  stats: CustomFeatureStat[];
  features: CustomFeatureView[];
}

export function customFeaturesState(
  character: Character,
  derived: DerivedCharacter,
  kind: ResolvedCharacterKind,
): CustomFeaturesState {
  const stats = customFeatureStats(kind);
  const byKey = new Map(stats.map((s) => [s.stat.toLowerCase(), s]));
  const typed = new Map(Object.entries(character.baseStats ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const features = (character.customFeatures ?? []).map((feature): CustomFeatureView => {
    const elementId = customFeatureElementId(feature.id);
    const lines = feature.stats.map((line): CustomLineView => {
      const key = line.stat.toLowerCase();
      const stat = byKey.get(key);
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
    return { id: feature.id, elementId, name: feature.name, description: feature.description ?? '', lines };
  });
  return { available: kind.customFeatures !== undefined, stats, features };
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
