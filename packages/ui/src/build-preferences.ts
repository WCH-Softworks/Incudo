/**
 * How a user likes the Build pane, remembered per user in `Storage` and never in a character — ADR 0115.
 *
 * Four things, each a view and nothing a derivation reads: whether the steps a system marks advanced are offered,
 * whether the option preview beside the pickers is folded to its title, which of the pane's two tabs is open, and
 * whether the optional decisions are unfolded (ADR 0123). Read
 * once when a shell starts and written whenever one changes. A record that cannot be read, or a field that is not what
 * it should be, falls back field by field to the defaults, as the print options do.
 */

import type { Storage } from '@incudo/core';

/**
 * The Build pane's tabs: what the character is built from, its spells (ADR 0124, shown only when it has any), and what
 * stays open for as long as it is played.
 */
export type BuildTab = 'build' | 'spells' | 'details';

export interface BuildPreferences {
  /** Offer the build steps the system marks `advanced`. Off by default. */
  showAdvanced: boolean;
  /** The option preview shows only the option's name, so the settled choices beneath it have the room. */
  previewCollapsed: boolean;
  tab: BuildTab;
  /** The optional decisions are shown, not folded under their heading (ADR 0123). Off by default. */
  optionalOpen: boolean;
}

export const DEFAULT_BUILD_PREFERENCES: BuildPreferences = {
  showAdvanced: false,
  previewCollapsed: false,
  tab: 'build',
  optionalOpen: false,
};

export const BUILD_PREFERENCES_KEY = 'build/view';

/** What the pane's tabs are called, in the order they are shown. Which are shown for a character is `buildTabs`'s. */
export const BUILD_TABS: ReadonlyArray<{ id: BuildTab; label: string }> = [
  { id: 'build', label: 'Build' },
  { id: 'spells', label: 'Spells' },
  { id: 'details', label: 'Equipment & notes' },
];

/** The switch beside the build's parts, and what it says. */
export const ADVANCED_OPTIONS_LABEL = 'Show advanced options';
/**
 * What the switch leaves out, named by the steps' own labels: "Additional features and Ability score adjustments are
 * offered only when this is on. Anything already taken from them still shows."
 */
export function advancedOptionsHint(labels: readonly string[]): string {
  const named =
    labels.length <= 1 ? (labels[0] ?? 'Some choices') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  const verb = labels.length === 1 ? 'is' : 'are';
  return `${named} ${verb} offered only when this is on: things a table may grant beyond the usual rules. Anything already taken from ${labels.length === 1 ? 'it' : 'them'} still shows.`;
}

export function parseBuildPreferences(text: string | null): BuildPreferences {
  let record: Record<string, unknown> = {};
  try {
    const parsed: unknown = text === null ? null : JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed as Record<string, unknown>;
  } catch {
    // Unreadable is the same as nothing stored.
  }
  const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  return {
    showAdvanced: flag(record.showAdvanced, DEFAULT_BUILD_PREFERENCES.showAdvanced),
    previewCollapsed: flag(record.previewCollapsed, DEFAULT_BUILD_PREFERENCES.previewCollapsed),
    tab: BUILD_TABS.some((tab) => tab.id === record.tab) ? (record.tab as BuildTab) : DEFAULT_BUILD_PREFERENCES.tab,
    optionalOpen: flag(record.optionalOpen, DEFAULT_BUILD_PREFERENCES.optionalOpen),
  };
}

/** The remembered preferences, or the defaults when nothing is stored or the storage cannot be read. */
export async function readBuildPreferences(storage: Storage): Promise<BuildPreferences> {
  try {
    return parseBuildPreferences(await storage.read(BUILD_PREFERENCES_KEY));
  } catch {
    return DEFAULT_BUILD_PREFERENCES;
  }
}

/** Remember them. A preference that cannot be written is not a reason to stop: the pane keeps what it shows. */
export async function writeBuildPreferences(storage: Storage, preferences: BuildPreferences): Promise<void> {
  try {
    const record: BuildPreferences = {
      showAdvanced: preferences.showAdvanced,
      previewCollapsed: preferences.previewCollapsed,
      tab: preferences.tab,
      optionalOpen: preferences.optionalOpen,
    };
    await storage.write(BUILD_PREFERENCES_KEY, JSON.stringify(record));
  } catch {
    // See above.
  }
}

/** The option preview's words: what folds it to its title line and back, and what it says before anything is pointed at. */
export const PREVIEW_HIDE_LABEL = 'Hide description';
export const PREVIEW_SHOW_LABEL = 'Show description';
export const PREVIEW_EMPTY = 'Point at an option to read its description here.';
export const PREVIEW_TITLE = 'Option preview';
