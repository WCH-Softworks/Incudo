/**
 * The words on a source's line for what it refers to that no enabled source contains (ADR 0052), and which of the
 * sources the user switched off had it when they were last loaded (ADR 0090). The desktop's Sources pane renders this
 * and composes no sentence.
 *
 * Said, never acted on: nothing is switched on for the user and nothing is blocked. A switched-off source is named only
 * for what its record of its last load holds, never because it "usually" supplies something, and the sentence says it
 * is that load being described. An id no switched-off source declared (AuroraLegacy's one upstream misspelling) is in
 * the list and under no name.
 */

import type { MissingContent, RefreshReport, SourceOverlap, SwitchedOffSupply, UpdateStatus } from '@incudo/content';
import type { PartView } from './source-parts.ts';

export interface SwitchedOffNote {
  sourceId: string;
  /** "Core, which is switched off, had 112 of them when it was last loaded." */
  sentence: string;
  /** What it had, references first and then addition targets, each once. */
  ids: string[];
}

export interface MissingNoteView {
  /** "Refers to 110 things none of your enabled sources contain, and 2 of its additions … have nothing to add to." */
  summary: string;
  /** Ids its grants and select defaults name that nothing enabled declares. */
  references: string[];
  /** What its waiting additions are for, each once. */
  additions: string[];
  /** The switched-off sources that had some of it, in the profile's order. */
  switchedOff: SwitchedOffNote[];
}

const count = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The note for a source's line; `undefined` when it misses nothing. `nameOf` gives a source's name as the list shows it. */
export function missingNote(
  missing: MissingContent,
  switchedOff: readonly SwitchedOffSupply[] | undefined,
  nameOf: (sourceId: string) => string,
): MissingNoteView | undefined {
  const references = missing.references;
  const additions = [...new Set(missing.additions)];
  if (!references.length && !missing.additions.length) return undefined;

  const things = count(references.length, 'thing', 'things');
  const waiting = missing.additions.length;
  const adds = `${waiting.toLocaleString()} of its additions to other content ${waiting === 1 ? 'has' : 'have'} nothing to add to`;
  const summary = references.length
    ? `Refers to ${things} none of your enabled sources contain${waiting ? `, and ${adds}` : ''}.`
    : `${adds.charAt(0).toUpperCase()}${adds.slice(1)}.`;

  // An id can be both a reference and an addition's target (the 2014 Player's Handbook grants the armour proficiencies
  // it also appends to), and is one thing missing.
  const total = new Set([...references, ...additions]).size;
  const notes = (switchedOff ?? []).map((supply): SwitchedOffNote => {
    const ids = [...new Set([...supply.references, ...supply.additions])];
    const had = ids.length === total ? (total === 1 ? 'it' : 'all of them') : `${ids.length.toLocaleString()} of them`;
    return {
      sourceId: supply.sourceId,
      sentence: `${nameOf(supply.sourceId)}, which is switched off, had ${had} when it was last loaded.`,
      ids,
    };
  });
  return { summary, references, additions, switchedOff: notes };
}

/**
 * What "Check for updates" found (ADR 0050). Reporting, never acting: a check that quietly refreshed would be the silent
 * update ADR 0012 refuses. The desktop's Sources pane and the phone's Content screen print this.
 */
export function updateNote(status: UpdateStatus): string {
  const unreached = status.state !== 'unknown' && status.unanswered ? ` ${status.unanswered} could not be reached.` : '';
  if (status.state === 'current') {
    if (status.basis === 'files') return `Up to date: none of ${status.checked} files has changed.${unreached}`;
    return (
      `The index still says ${status.version ?? 'the same version'}. Only the index version could be compared here, ` +
      'and a source can change without it moving.'
    );
  }
  if (status.state === 'outdated') {
    if (status.basis === 'files') {
      return `Updated upstream: ${status.changed} of ${status.checked} files have changed.${unreached} Refresh fetches them.`;
    }
    return (
      `Updated upstream: you have ${status.local ?? 'an unknown version'}, the index now says ` +
      `${status.remote ?? 'something newer'}. Refresh fetches it.`
    );
  }
  return `Could not tell: ${status.reason}`;
}

export interface SourceOverlapNoteView {
  /** "Also defines 12 things Core defines, 3 of them differently. This source's version is used." */
  summary: string;
  /** Ids both define, differently: listed only when there are some. */
  differ: string[];
}

/**
 * What a source defines that another enabled source also defines (ADR 0054). The one lower in the list is used, and this
 * says which that is; it never says which version is right. What both define the same way is counted, not listed.
 */
export function sourceOverlapNote(overlap: SourceOverlap, other: string): SourceOverlapNoteView {
  const differ = overlap.differ.length;
  const total = differ + overlap.same;
  const shared = `Also defines ${total.toLocaleString()} ${total === 1 ? 'thing' : 'things'} ${other} defines`;
  if (!differ) return { summary: `${shared}, the same way.`, differ: [] };
  const used = overlap.used === 'this' ? "This source's" : `${other}'s`;
  const how = total === 1 ? 'differently' : `${differ.toLocaleString()} of them differently`;
  return { summary: `${shared}, ${how}. ${used} version is used.`, differ: [...overlap.differ] };
}

export interface RefreshNoteView {
  /** "Refreshed: 12 downloaded, 728 unchanged." or the failure, with the saved copy left as it was. */
  summary: string;
  /** "3 files could not be reached, so the saved copy was kept", when any were. */
  keptSummary?: string;
  kept: Array<{ url: string; reason: string }>;
}

/** What a refresh did, in numbers the user can check against what they expected (ADR 0050). */
export function refreshNote(report: RefreshReport | { failed: string }): RefreshNoteView {
  if ('failed' in report) {
    return { summary: `Refresh failed, and the saved copy was left as it was: ${report.failed}`, kept: [] };
  }
  const parts = [`${report.fetched} downloaded`];
  if (report.unchanged) parts.push(`${report.unchanged} unchanged`);
  if (report.removed) parts.push(`${report.removed} no longer listed and removed`);
  const kept = report.kept.length;
  return {
    summary: `Refreshed: ${parts.join(', ')}.`,
    ...(kept ? { keptSummary: `${kept} ${kept === 1 ? 'file' : 'files'} could not be reached, so the saved copy was kept` } : {}),
    kept: [...report.kept],
  };
}

/** The line under a source saying some of its parts are off (ADR 0055); `undefined` when none is. */
export function partsOffNote(excluded: readonly string[] | undefined): string | undefined {
  const off = excluded?.length ?? 0;
  if (!off) return undefined;
  return `${off} ${off === 1 ? 'part' : 'parts'} switched off. Choose parts shows which.`;
}

/** What the parts chooser says above its tree. */
export const PARTS_HINT =
  'Switch off what you do not want loaded. Anything under a part that is off is left out too. ' +
  "Content that builds on a part you switch off will say what it is missing on the source's line.";

/** "712 of 740 files will load." */
export function partsLoadingLine(filesLoading: number, files: number): string {
  return `${filesLoading.toLocaleString()} of ${files.toLocaleString()} files will load.`;
}

/** What follows a part's name in the chooser: its files, or why it does not load where it is. */
export function partMeta(part: Pick<PartView, 'isIndex' | 'repeated' | 'tooDeep' | 'failed' | 'on' | 'reachable' | 'files' | 'filesLoading'>): string[] {
  const meta: string[] = [];
  if (part.isIndex && !part.repeated) {
    meta.push(
      part.on && part.reachable && part.filesLoading !== part.files
        ? `${part.filesLoading} of ${part.files} files`
        : `${part.files} ${part.files === 1 ? 'file' : 'files'}`,
    );
  }
  if (part.repeated) meta.push('listed again here; it loads once, where it is listed first');
  if (part.tooDeep) meta.push('too deeply nested to be loaded');
  if (part.failed) meta.push(`could not be read: ${part.failed}`);
  return meta;
}
