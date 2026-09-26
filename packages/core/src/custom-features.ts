/**
 * Features a user writes for one character — ADR 0063.
 *
 * A DM's "Godspeed: Speed 60" on an NPC. A feature is held as an element of the type the kind's
 * `customFeatures` names, so it is listed where that type is listed; its `add` lines are that element's
 * rules, and its `set` lines are where a stat starts, after a creature's print and before a value the user
 * typed. Core names no stat: which a feature may name is read off the kind.
 *
 * One module answers it for the engine and for the builder, so an editor offers exactly the stats the
 * derivation will read.
 */

import type { Character, CustomFeature } from './character.ts';
import type { Element, ElementId, StatKey, StatRule } from './model.ts';
import { progressionStat, type ResolvedCharacterKind } from './system.ts';

/** The prefix a custom feature's element id carries, so it can never be mistaken for content's. */
export const CUSTOM_FEATURE_PREFIX = 'custom:';

/** The element a custom feature is held as. */
export function customFeatureElementId(featureId: string): ElementId {
  return `${CUSTOM_FEATURE_PREFIX}${featureId}`;
}

/** A stat a custom feature may name, as the kind shows it to a user. */
export interface CustomFeatureStat {
  /** The stat as the kind declared it. */
  stat: StatKey;
  label: string;
  /** The sheet section it is shown in, so a picker can group the stats as the sheet does. */
  group: string;
  /**
   * The label with its section when another offered stat shares it — "Strength (Saving Throws)" beside the ability
   * "Strength" — for a sentence that names the stat on its own.
   */
  fullLabel: string;
  /**
   * Whether a feature may set where it starts. A stat that derives may only be added to: the engine adds a
   * derivation on top of any start, so setting Perception to 7 would read 7 plus the Wisdom modifier.
   */
  settable: boolean;
}

/**
 * What a custom feature may name on this kind: the stats its sheet shows, in the sheet's order and grouped by its
 * sections, once each. Not the progression's own stat, which is set where ADR 0060 says, nor a stat whose value is
 * text, nor a section rendered per block, whose stats the kind cannot name, nor a section the kind's `customFeatures.sections`
 * leaves out (5e leaves out the ability scores). Empty for a kind that carries no custom
 * features.
 *
 * The sheet and not every stat the kind declares: a system declares stats for every kind at once (an item slot, a
 * caster level), and what a DM means by "this creature is faster" is a number the stat block shows.
 */
export function customFeatureStats(kind: ResolvedCharacterKind): CustomFeatureStat[] {
  if (!kind.customFeatures) return [];
  const progress = progressionStat(kind.progression)?.toLowerCase();
  const defs = new Map(kind.stats.map((def) => [def.name.toLowerCase(), def]));
  const seen = new Set<string>();
  const out: CustomFeatureStat[] = [];
  const allowed = kind.customFeatures.sections;
  for (const section of kind.sheet.sections) {
    if (section.perBlock) continue;
    if (allowed !== undefined && !allowed.includes(section.id)) continue;
    for (const name of section.stats ?? []) {
      const key = name.toLowerCase();
      const def = defs.get(key);
      if (!def || key === progress || seen.has(key) || typeof def.default === 'string') continue;
      seen.add(key);
      const label = def.label ?? def.name;
      out.push({ stat: def.name, label, group: section.label, fullLabel: label, settable: def.derive === undefined });
    }
  }
  const shared = out.filter((s) => out.some((o) => o !== s && o.label === s.label));
  for (const s of shared) s.fullLabel = `${s.label} (${s.group})`;
  return out;
}

/** Why a line of a custom feature does nothing, or does less than it says. */
export interface CustomFeatureNote {
  kind: 'no-custom-features' | 'unknown-stat' | 'not-settable' | 'two-setters';
  featureId: string;
  featureName: string;
  stat?: StatKey;
  /** The feature whose set is used instead, for `two-setters`. */
  usedFrom?: string;
}

/** A stat's start set by a custom feature. */
export interface CustomSet {
  /** The stat as the kind declared it. */
  stat: StatKey;
  value: number;
  /** The feature's element id. */
  from: ElementId;
  featureName: string;
}

/** What a character's custom features do, read against its kind. */
export interface CustomFeatureEffects {
  /** One element per feature, holding its `add` lines as rules. Empty for a kind that carries none. */
  elements: Element[];
  /** Keyed by the stat's lowercased name. The first feature to set a stat is the one used. */
  sets: Map<StatKey, CustomSet>;
  notes: CustomFeatureNote[];
}

/**
 * What the character's custom features do — ADR 0063. A line naming a stat the kind does not offer, or setting one
 * that derives, contributes nothing and is noted; so is every feature on a kind that carries none.
 */
export function customFeatureEffects(character: Character, kind: ResolvedCharacterKind): CustomFeatureEffects {
  const features = character.customFeatures ?? [];
  const elements: Element[] = [];
  const sets = new Map<StatKey, CustomSet>();
  const notes: CustomFeatureNote[] = [];
  if (!features.length) return { elements, sets, notes };
  if (!kind.customFeatures) {
    for (const feature of features) notes.push({ kind: 'no-custom-features', featureId: feature.id, featureName: feature.name });
    return { elements, sets, notes };
  }

  const offered = new Map(customFeatureStats(kind).map((s) => [s.stat.toLowerCase(), s]));
  for (const feature of features) {
    const id = customFeatureElementId(feature.id);
    const rules: StatRule[] = [];
    for (const [at, line] of feature.stats.entries()) {
      const stat = offered.get(line.stat.toLowerCase());
      const note = { featureId: feature.id, featureName: feature.name, stat: line.stat };
      if (!stat) {
        notes.push({ kind: 'unknown-stat', ...note });
        continue;
      }
      if (line.mode === 'add') {
        rules.push({ kind: 'stat', key: `custom-${at}`, name: stat.stat, value: { kind: 'number', value: line.value } });
        continue;
      }
      if (!stat.settable) {
        notes.push({ kind: 'not-settable', ...note, stat: stat.stat });
        continue;
      }
      const key = stat.stat.toLowerCase();
      const existing = sets.get(key);
      if (existing) {
        if (existing.from !== id) notes.push({ kind: 'two-setters', ...note, stat: stat.stat, usedFrom: existing.featureName });
        continue;
      }
      sets.set(key, { stat: stat.stat, value: line.value, from: id, featureName: feature.name });
    }
    elements.push(customFeatureElement(feature, kind.customFeatures.type, rules));
  }
  return { elements, sets, notes };
}

function customFeatureElement(feature: CustomFeature, type: string, rules: StatRule[]): Element {
  return {
    id: customFeatureElementId(feature.id),
    type,
    name: feature.name.trim() || 'Unnamed feature',
    source: 'Custom',
    setters: {},
    rules,
    supports: [],
    ...(feature.description?.trim() ? { description: plainTextAsHtml(feature.description) } : {}),
    origin: { sourceId: 'character', format: 'incudo' },
  };
}

/**
 * An element's description is HTML (content's is), and what the user typed is plain text: escaped, one paragraph
 * per blank-line-separated block, so it reads as written wherever a description is shown and never as markup.
 */
function plainTextAsHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block) => `<p>${escape(block.trim()).replace(/\r?\n/g, '<br />')}</p>`)
    .join('');
}
