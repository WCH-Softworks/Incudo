/**
 * What a launcher card says about an overlay — ADR 0102 decision 3.
 *
 * An overlay is a system by the time anything reads it, so the only place it shows as one is here: what it is built on,
 * and what it changes, in sentences. Nothing here is a path; an entry is named by its label where it has one and by the
 * identity the user wrote otherwise. The shells render these strings and compute nothing.
 */

import type { GameSystem, OverlayChange, OverlayStep } from '@incudo/core';

import type { UserOverlay } from './system-loading.ts';

export interface OverlayView {
  /** "Built on Dungeons & Dragons 5th Edition." */
  builtOn: string;
  /** One sentence per change, in the order the overlay writes them. Empty when it changes nothing. */
  changes: string[];
  /** Said instead of a list when there are no changes. */
  none?: string;
}

/** What the format's fields are called on screen. A field not here is written as its words ("candidate notes"). */
const NOUNS: Record<string, string> = {
  elementTypes: 'element type',
  stats: 'stat',
  generationMethods: 'way of generating scores',
  characterKinds: 'character kind',
  suggestedSources: 'suggested source',
  buildSteps: 'build step',
  sections: 'sheet section',
  sheet: 'sheet',
  slots: 'equipment slot',
  rests: 'rest',
  trackers: 'tracker',
  blockFilters: 'block filter',
  fields: 'field',
  currency: 'money',
  auroraTypeMap: 'Aurora type names',
  copiedFrom: 'system it was copied from',
  licence: 'licence',
  progression: 'progression',
  default: 'default',
  derive: 'formula',
  label: 'label',
  min: 'minimum',
  max: 'maximum',
  budget: 'budget',
  inventory: 'equipment',
  play: 'play',
  freeform: 'written text',
  companions: 'held creatures',
  attacks: 'attacks',
  types: 'types',
  grants: 'grants',
  contributions: 'contributions',
};

export function overlayView(system: GameSystem, overlay: UserOverlay): OverlayView {
  const parent = overlay.parent.name;
  const changes = overlay.changes.map((change) => overlayChangeLine(change, parent));
  return {
    builtOn: `Built on ${parent}.`,
    changes,
    ...(changes.length ? {} : { none: `${system.name} is the same as ${parent} as it is today.` }),
  };
}

/** One change as a sentence: "Adds the stat Sanity", "Changes the progression of the character kind Player Character". */
export function overlayChangeLine(change: OverlayChange, parentName: string): string {
  const path = change.path;
  const last = path[path.length - 1];
  if (!last) return 'Changes something';
  const owners = path.slice(0, -1).filter((step) => step.entry !== undefined);
  const owner = owners[owners.length - 1];
  const outer = owners.slice(0, -1).map(entryName);
  const context = outer.length ? ` (${outer.join(', ')})` : '';

  if (last.entry !== undefined) {
    const where = owner ? ` ${change.action === 'added' ? 'to' : 'from'} ${entryName(owner)}` : '';
    const thing = `the ${noun(last.field)} ${entryName(last)}`;
    switch (change.action) {
      case 'added':
        return `Adds ${thing}${where}${context}`;
      case 'removed':
        return `Removes ${thing}${where}${context}`;
      case 'absent':
        return `Would remove ${thing}${where}${context}, which ${parentName} no longer has`;
      default:
        return `Changes ${thing}${owner ? ` of ${entryName(owner)}` : ''}${context}`;
    }
  }
  const field = `the ${noun(last.field)}`;
  const of = owner ? ` of the ${noun(owner.field)} ${entryName(owner)}` : '';
  switch (change.action) {
    case 'removed':
      return `Removes ${field}${of}${context}`;
    case 'added':
      return `Adds to ${field}${of}${context}`;
    default:
      return `Changes ${field}${of}${context}`;
  }
}

function entryName(step: OverlayStep): string {
  return step.label ?? step.entry ?? step.field;
}

function noun(field: string): string {
  return NOUNS[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * Beside a source an overlay loads because its parent does (ADR 0102 decision 5). A source keeps one tag, so its switch
 * and its Remove are the parent's too, and the row says so before the user finds out.
 */
export function sharedSourceNote(parentName: string): string {
  return `Added under ${parentName}, and loaded here too. Switching it off or removing it does the same there.`;
}
