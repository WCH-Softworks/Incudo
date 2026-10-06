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
 * `not-markable` because the row has no mark a line may choose, or none by that count (ADR 0094); `unknown` because the
 * kind has no such stat; `not-held` because the feature is held as a type the kind does not list (its `typeNote` says
 * so).
 */
export type CustomLineStatus = 'applied' | 'replaced' | 'overruled' | 'add-only' | 'not-markable' | 'unknown' | 'not-held';

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
      if (line.mode === 'mark') {
        const choice = Number.isInteger(line.value) ? stat.mark?.choices[line.value] : undefined;
        if (!stat.mark || choice === undefined) {
          return { ...view, status: 'not-markable', note: `${stat.fullLabel} cannot be marked this way. The line changes nothing.` };
        }
        // What the line moves is the stat the mark is read from, so that is whose start it must own.
        const start = derived.starts.get(stat.mark.stat.toLowerCase());
        if (start?.from !== elementId) {
          const other = start?.feature?.trim() || 'another feature';
          return { ...view, status: 'overruled', note: `${other} also marks ${stat.fullLabel} and comes first, so this line is not used.` };
        }
        if (start.replaced) {
          return { ...view, status: 'replaced', note: `A value entered for ${stat.fullLabel} replaces this. Clear that entry to use "${choice}".` };
        }
        return { ...view, status: 'applied' };
      }
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
 * becomes an add when the new stat can only be added to; a mark keeps its choice when the new stat may be marked that
 * way, and becomes an add of 0 when it may not.
 */
export function customLineOnStat(
  line: CustomStatLine,
  stat: string,
  stats: readonly CustomFeatureStat[],
  derived: DerivedCharacter,
): CustomStatLine {
  if (line.mode === 'add') return { ...line, stat };
  if (line.mode === 'mark') {
    return line.value < customMarkChoices(stats, stat).length ? { ...line, stat } : { stat, mode: 'add', value: 0 };
  }
  return newCustomStatLine(stats, derived, stat) ?? { ...line, stat };
}

/** The heading the section is shown under. */
export const CUSTOM_FEATURES_HEADING = 'Your own features';

/**
 * What the section says first, worded from what this kind's lines can do: a player character's numbers are all worked
 * out, so its lines only add, and saying they set or mark would describe a control that is never enabled.
 */
export function customFeaturesHint(stats: readonly CustomFeatureStat[]): string {
  const sets = stats.some((s) => s.settable);
  const marks = stats.some((s) => s.mark);
  const ways = [sets && 'sets it', marks && 'where the sheet marks a number, chooses its mark'].filter(Boolean);
  const lines =
    ways.length === 2 ? `adds to a number, ${ways[0]}, or, ${ways[1]}` : ways.length ? `adds to a number or ${ways[0]}` : 'adds to a number';
  return (
    `A feature of your own for this character, listed on its sheet. Each line ${lines}; a feature can also be only a name ` +
    `and a description.${sets ? ' A number typed in the entry steps replaces what a feature sets.' : ''} Features are ` +
    'saved with the character.'
  );
}

/** What each way a line may change its stat is called, in the order a choice offers them. */
export const CUSTOM_LINE_MODES: readonly { mode: CustomStatLine['mode']; label: string }[] = [
  { mode: 'add', label: 'adds' },
  { mode: 'set', label: 'sets it to' },
  { mode: 'mark', label: 'marked' },
];

/** The name a feature is given when it is added, before the user names it. */
export const NEW_CUSTOM_FEATURE_NAME = 'New feature';

/** A feature's lines as the character records them, without what the view adds. */
export function customFeatureLines(feature: Pick<CustomFeatureView, 'lines'>): CustomStatLine[] {
  return feature.lines.map(({ stat, mode, value }) => ({ stat, mode, value }));
}

/** The lines with line `at` replaced. */
export function withCustomLine(lines: readonly CustomStatLine[], at: number, line: CustomStatLine): CustomStatLine[] {
  return lines.map((l, i) => (i === at ? line : l));
}

/** The lines with line `at` taken out. */
export function withoutCustomLine(lines: readonly CustomStatLine[], at: number): CustomStatLine[] {
  return lines.filter((_, i) => i !== at);
}

/**
 * A line switched to adding, setting or marking. A stat that may not be set (it is worked out from other numbers) keeps
 * the line as it is when asked to set, and one with no mark when asked to mark; a set keeps its number when it becomes
 * an add. A mark starts at the first mark past none, and an add made from a mark starts at 0, since a count of marks is
 * no number to add.
 */
export function customLineWithMode(
  line: CustomStatLine,
  mode: CustomStatLine['mode'],
  stats: readonly CustomFeatureStat[],
): CustomStatLine {
  if (mode === line.mode || !customLineModeAllowed(stats, line.stat, mode)) return line;
  if (mode === 'mark') return { ...line, mode, value: 1 };
  if (line.mode === 'mark') return { ...line, mode, value: 0 };
  return { ...line, mode };
}

/** Whether a line on `stat` may mark it — ADR 0094. */
export function customStatMarkable(stats: readonly CustomFeatureStat[], stat: string): boolean {
  return customMarkChoices(stats, stat).length > 1;
}

/** What a line marking `stat` may choose, by count, none first; empty when it may not mark it. */
export function customMarkChoices(stats: readonly CustomFeatureStat[], stat: string): string[] {
  return stats.find((s) => s.stat.toLowerCase() === stat.toLowerCase())?.mark?.choices ?? [];
}

/** Whether a line on `stat` may change it in `mode`, for a choice that greys the rest out. */
export function customLineModeAllowed(stats: readonly CustomFeatureStat[], stat: string, mode: CustomStatLine['mode']): boolean {
  if (mode === 'set') return customStatSettable(stats, stat);
  if (mode === 'mark') return customStatMarkable(stats, stat);
  return true;
}

/** The modes a choice offers for a line on `stat`: adding and setting always (setting greyed where it may not), marking only where it may. */
export function customLineModes(stats: readonly CustomFeatureStat[], stat: string): typeof CUSTOM_LINE_MODES {
  return CUSTOM_LINE_MODES.filter((m) => m.mode !== 'mark' || customStatMarkable(stats, stat));
}

/** Whether a line on `stat` may set it. */
export function customStatSettable(stats: readonly CustomFeatureStat[], stat: string): boolean {
  return stats.find((s) => s.stat.toLowerCase() === stat.toLowerCase())?.settable ?? false;
}

/** The stats a line may name, grouped as the sheet groups them, in the kind's order. */
export function customStatGroups(stats: readonly CustomFeatureStat[]): { group: string; stats: CustomFeatureStat[] }[] {
  return [...new Set(stats.map((s) => s.group))].map((group) => ({ group, stats: stats.filter((s) => s.group === group) }));
}

/** A stat on one line of a list that is not grouped: "Strength (Saving Throws)", or the label alone when it is its group's. */
export function customStatChoiceLabel(stat: Pick<CustomFeatureStat, 'label' | 'group'>): string {
  return stat.group && stat.group !== stat.label ? `${stat.label} (${stat.group})` : stat.label;
}

/**
 * Where a feature may be listed, as a choice shows it: the kind's types, and first the one it records when the kind does
 * not list it, named as `typeLabel` names it. Empty when there is nothing to choose (one type, and that one recorded).
 */
export function customFeatureTypeChoices(
  state: Pick<CustomFeaturesState, 'types'>,
  feature: Pick<CustomFeatureView, 'type' | 'typeLabel' | 'typeNote'>,
): CustomFeatureType[] {
  if (state.types.length <= 1 && !feature.typeNote) return [];
  return [...(feature.typeNote ? [{ type: feature.type, label: feature.typeLabel }] : []), ...state.types];
}
