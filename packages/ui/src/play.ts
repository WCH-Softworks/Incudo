/**
 * Playing a character: what it has spent, and what a rest gives back — ADR 0084.
 *
 * A kind declares what is kept track of (`PlayDef`): a stat, the rows of a sheet section, the dice a section writes
 * beside a track, the listed elements whose usage reads as a rest's ("3/Long Rest"), or a fixed number. Each maximum
 * is read from the sheet as it is drawn (`SheetView`) and the derivation's stats, never worked out again here, so play
 * shows exactly the numbers the sheet does. What is spent is the character's `play` (core's `setPlayState`), an input
 * with no formula. Every edit is a pure function of the character and this view, so the phone and the desktop make the
 * same change, and a screen computes nothing. Kind-agnostic: every rest, tracker and condition comes from the system.
 */

import {
  setPlayState,
  type Character,
  type DerivedCharacter,
  type PlayState,
  type ResolvedCharacterKind,
  type RestoreDef,
  type TrackerDef,
} from '@incudo/core';

import { listedName } from './sheet-document.ts';
import type { SheetListedElement, SheetView } from './sheet.ts';

/** One thing kept track of. */
export interface PlayTracker {
  /** Where it is recorded in `Character.play`. */
  key: string;
  label: string;
  max: number;
  /** How much is spent, or for a tracker that counts, how many there are: 0 to `max`. */
  spent: number;
  /** It records how many there are (exhaustion), not how many are spent. */
  counts: boolean;
  /** What a sheet shows: what is left (`max - spent`), or for a tracker that counts, `spent`. */
  value: number;
  /** A temporary amount spent before it, when the system declares one: its name and how much there is. */
  temporary?: { label: string; value: number };
  /** The rests that give it back, by label, in the order the kind offers them. */
  restoredBy: string[];
  /** For a use, its usage as the sheet writes it ("3/Long Rest"). */
  usage?: string;
  /** What each rest gives back, by rest id, after `includes` is followed: what `restPlay` reads. */
  restores: { rest: string; restore: RestoreDef }[];
  /**
   * Where on the sheet it counts something (ADR 0126): the stat it reads its maximum from, a row of a section (the
   * section view's id, which names a casting block too), or an element a section lists. A renderer draws the tracker
   * there. Absent for one with a fixed maximum (inspiration, death saves), which belongs to no row.
   */
  at?: PlayTrackerAt;
}

/** Where on the sheet a tracker counts (ADR 0126). */
export type PlayTrackerAt = { stat: string } | { section: string; row: string } | { section: string; element: string };

/** The trackers one declaration makes, under one heading: Hit Points, Spell Slots — Wizard, Limited Uses. */
export interface PlayGroup {
  id: string;
  label: string;
  trackers: PlayTracker[];
}

export interface PlayView {
  groups: PlayGroup[];
  /** The rests a character may take, in the order offered. */
  rests: { id: string; label: string }[];
  /** The conditions it may be under, each set or not, when the kind declares any. */
  conditions?: { label: string; names: { name: string; on: boolean }[] };
}

/** What play is read from: the builder's state, or the parts of it play reads. */
export interface PlaySource {
  character: Pick<Character, 'play'>;
  kind: ResolvedCharacterKind;
  derived: Pick<DerivedCharacter, 'stats'>;
  sheet: Pick<SheetView, 'sections'>;
}

/** The default heading of the conditions. */
export const CONDITIONS_LABEL = 'Conditions';

/** What a character of this kind keeps track of in play, or nothing for a kind that declares no play. */
export function playView(source: PlaySource): PlayView | undefined {
  const play = source.kind.play;
  if (!play) return undefined;
  const rests = play.rests ?? [];
  const recorded = source.character.play ?? {};
  // Which rests give back what a rest gives back: itself and every rest that includes it, transitively.
  const givers = (restId: string): string[] => {
    const out = new Set<string>([restId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const rest of rests) {
        if (!out.has(rest.id) && (rest.includes ?? []).some((id) => out.has(id))) {
          out.add(rest.id);
          grew = true;
        }
      }
    }
    return rests.filter((rest) => out.has(rest.id)).map((rest) => rest.id);
  };
  const label = (restId: string): string => rests.find((rest) => rest.id === restId)?.label ?? restId;
  const stat = (key: string): number => Math.floor(source.derived.stats.get(key.toLowerCase())?.value ?? 0);

  const tracker = (
    def: TrackerDef,
    key: string,
    name: string,
    max: number,
    restores: readonly RestoreDef[],
    usage?: string,
    at?: PlayTrackerAt,
  ): PlayTracker => {
    const counts = def.counts === true;
    const spent = Math.min(max, Math.max(0, Math.floor(recorded.spent?.[key] ?? 0)));
    const expanded = restores.flatMap((restore) => givers(restore.rest).map((rest) => ({ rest, restore })));
    return {
      key,
      label: name,
      max,
      spent,
      counts,
      value: counts ? spent : max - spent,
      ...(def.temporary !== undefined ? { temporary: { label: def.temporary, value: Math.max(0, recorded.temporary?.[key] ?? 0) } } : {}),
      restoredBy: rests.filter((rest) => expanded.some((entry) => entry.rest === rest.id)).map((rest) => label(rest.id)),
      ...(usage !== undefined ? { usage } : {}),
      restores: expanded,
      ...(at ? { at } : {}),
    };
  };

  const groups: PlayGroup[] = [];
  for (const def of play.trackers ?? []) {
    const restores = def.restores ?? [];
    if (def.stat !== undefined) {
      const max = stat(def.stat);
      if (max <= 0) continue;
      const statLabel = source.kind.stats.find((s) => s.name.toLowerCase() === def.stat!.toLowerCase())?.label;
      const name = def.label ?? statLabel ?? def.stat;
      groups.push({ id: def.id, label: name, trackers: [tracker(def, def.id, name, max, restores, undefined, { stat: def.stat.toLowerCase() })] });
    } else if (def.max !== undefined) {
      const name = def.label ?? def.id;
      groups.push({ id: def.id, label: name, trackers: [tracker(def, def.id, name, def.max, restores)] });
    } else if (def.rows !== undefined) {
      // One group per section drawn: a per-block section is drawn once per block, "Spell Slots — Warlock".
      for (const section of source.sheet.sections.filter((s) => (s.section ?? s.id) === def.rows)) {
        const when = def.restoresWhen;
        const blockRestores =
          when && section.block !== undefined && stat(when.stat.replace(/\{name\}/g, section.block)) > 0 ? when.restores : restores;
        const trackers = section.rows
          .map((row) => ({ row, max: stat(row.stat) }))
          .filter(({ max }) => max > 0)
          .map(({ row, max }) => tracker(def, `${def.id}/${row.stat}`, row.label, max, blockRestores, undefined, { section: section.id, row: row.stat }));
        if (trackers.length) groups.push({ id: section.id, label: def.label ?? section.label, trackers });
      }
    } else if (def.dice !== undefined) {
      const trackers = source.sheet.sections
        .filter((s) => (s.section ?? s.id) === def.dice)
        .flatMap((s) => s.elements.map((e) => ({ s, e })))
        .filter((x): x is { s: SheetView['sections'][number]; e: SheetListedElement & { dice: { count: number; sides: number } } } => x.e.dice !== undefined && x.e.dice.count > 0)
        .map(({ s, e }) => tracker(def, `${def.id}/${e.elementId}`, `${e.sheetName ?? e.name} (d${e.dice.sides})`, e.dice.count, restores, undefined, { section: s.id, element: e.elementId }));
      if (trackers.length) groups.push({ id: def.id, label: def.label ?? def.id, trackers });
    } else if (def.uses !== undefined) {
      const seen = new Set<string>();
      const trackers: PlayTracker[] = [];
      for (const section of source.sheet.sections.filter((s) => def.uses!.includes(s.section ?? s.id))) {
        for (const e of section.elements) {
          if (seen.has(e.elementId) || e.usage === undefined) continue;
          const read = readUsage(e.usage, rests);
          if (!read || read.count <= 0) continue;
          seen.add(e.elementId);
          trackers.push(tracker(def, `${def.id}/${e.elementId}`, listedName(e), read.count, [{ rest: read.rest }], e.usage, { section: section.id, element: e.elementId }));
        }
      }
      if (trackers.length) groups.push({ id: def.id, label: def.label ?? def.id, trackers });
    }
  }

  const conditions = play.conditions;
  const on = new Set(recorded.conditions ?? []);
  return {
    groups,
    rests: rests.map((rest) => ({ id: rest.id, label: rest.label })),
    ...(conditions
      ? { conditions: { label: conditions.label ?? CONDITIONS_LABEL, names: conditions.names.map((name) => ({ name, on: on.has(name) })) } }
      : {}),
  };
}

/**
 * How many uses a usage gives and which rest gives them back: the first rest, in the order declared, one of whose
 * `usage` templates reads it whole, ignoring case, with `{count}` a whole number. "3/Long Rest" is 3 and the long rest;
 * "1/Turn", "Channel Divinity" and a usage with an unfilled stat ("—/Long Rest") read as nothing.
 */
export function readUsage(usage: string, rests: readonly { id: string; usage?: string[] }[]): { count: number; rest: string } | undefined {
  const text = usage.trim();
  for (const rest of rests) {
    for (const template of rest.usage ?? []) {
      const pattern = template
        .trim()
        .split('{count}')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'))
        .join('(\\d+)');
      const match = new RegExp(`^${pattern}$`, 'i').exec(text);
      if (match?.[1] !== undefined) return { count: Number(match[1]), rest: rest.id };
    }
  }
  return undefined;
}

function trackerOf(view: PlayView, key: string): PlayTracker | undefined {
  for (const group of view.groups) for (const tracker of group.trackers) if (tracker.key === key) return tracker;
  return undefined;
}

function recordedOf(character: Character): Required<Pick<PlayState, 'spent' | 'temporary'>> & Pick<PlayState, 'conditions'> {
  return {
    spent: { ...(character.play?.spent ?? {}) },
    temporary: { ...(character.play?.temporary ?? {}) },
    ...(character.play?.conditions ? { conditions: [...character.play.conditions] } : {}),
  };
}

/**
 * Spend some of a tracker, or give some back: `delta` added to what is spent, kept within 0 and its maximum. Spending
 * takes from a temporary amount first ("Temporary Hit Points"); giving back leaves it alone. For a tracker that counts,
 * `delta` adds to the count. A key the view does not show changes nothing.
 */
export function adjustPlay(character: Character, view: PlayView, key: string, delta: number): Character {
  const tracker = trackerOf(view, key);
  if (!tracker || !Number.isFinite(delta) || delta === 0) return character;
  const play = recordedOf(character);
  let rest = Math.trunc(delta);
  if (rest > 0 && tracker.temporary && tracker.temporary.value > 0) {
    const taken = Math.min(rest, tracker.temporary.value);
    play.temporary[key] = tracker.temporary.value - taken;
    rest -= taken;
  }
  play.spent[key] = Math.min(tracker.max, Math.max(0, tracker.spent + rest));
  return setPlayState(character, play);
}

/** Set a tracker's spent amount (or count) outright, kept within 0 and its maximum. */
export function setPlaySpent(character: Character, view: PlayView, key: string, spent: number): Character {
  const tracker = trackerOf(view, key);
  if (!tracker || !Number.isFinite(spent)) return character;
  const play = recordedOf(character);
  play.spent[key] = Math.min(tracker.max, Math.max(0, Math.trunc(spent)));
  return setPlayState(character, play);
}

/** Set a tracker's temporary amount: it replaces what was there, as a new amount does in play. 0 clears it. */
export function setPlayTemporary(character: Character, view: PlayView, key: string, value: number): Character {
  const tracker = trackerOf(view, key);
  if (!tracker?.temporary || !Number.isFinite(value)) return character;
  const play = recordedOf(character);
  play.temporary[key] = Math.max(0, Math.trunc(value));
  return setPlayState(character, play);
}

/** Set a condition the kind declares, or clear it. A name it does not declare changes nothing. */
export function setPlayCondition(character: Character, view: PlayView, name: string, on: boolean): Character {
  if (!view.conditions?.names.some((condition) => condition.name === name)) return character;
  const play = recordedOf(character);
  const current = play.conditions ?? [];
  if (on === current.includes(name)) return character;
  play.conditions = on ? [...current, name] : current.filter((condition) => condition !== name);
  return setPlayState(character, play);
}

/**
 * Take a rest: every tracker a rest gives back (itself or one it includes) gets back what it says. All of it clears what
 * is spent and any temporary amount; an `amount` takes that many off each; a `fraction` gives back that share of the
 * maximum of every tracker in the group it applies to, rounded down and at least `minimum`, in the order shown. A key the
 * view does not show, and every condition, is left as it is.
 */
export function restPlay(character: Character, view: PlayView, restId: string): Character {
  if (!view.rests.some((rest) => rest.id === restId)) return character;
  const play = recordedOf(character);
  for (const group of view.groups) {
    const applying = group.trackers
      .map((tracker) => ({ tracker, restore: tracker.restores.find((entry) => entry.rest === restId)?.restore }))
      .filter((entry): entry is { tracker: PlayTracker; restore: RestoreDef } => entry.restore !== undefined);
    const shared = applying.find(({ restore }) => restore.fraction !== undefined)?.restore;
    let pool = shared
      ? Math.max(shared.minimum ?? 0, Math.floor(applying.reduce((sum, { tracker }) => sum + tracker.max, 0) * shared.fraction!))
      : 0;
    for (const { tracker, restore } of applying) {
      const spent = play.spent[tracker.key] ?? 0;
      if (restore.fraction !== undefined) {
        const back = Math.min(pool, Math.min(spent, tracker.max));
        play.spent[tracker.key] = Math.min(spent, tracker.max) - back;
        pool -= back;
      } else if (restore.amount !== undefined) {
        play.spent[tracker.key] = Math.max(0, Math.min(spent, tracker.max) - restore.amount);
      } else {
        play.spent[tracker.key] = 0;
        if (tracker.temporary) play.temporary[tracker.key] = 0;
      }
    }
  }
  return setPlayState(character, play);
}

// --- wording, shared by every screen that shows play --------------------------------------------------------------

/** A tracker's value as a screen writes it: "23 of 30", or for one that counts, "2 of 6". */
export function playValue(tracker: Pick<PlayTracker, 'value' | 'max'>): string {
  return `${tracker.value} of ${tracker.max}`;
}

/** A tracker's temporary amount as a screen writes it, "+5 Temporary Hit Points", or nothing when there is none. */
export function playTemporaryText(tracker: Pick<PlayTracker, 'temporary'>): string | undefined {
  return tracker.temporary && tracker.temporary.value > 0 ? `+${tracker.temporary.value} ${tracker.temporary.label}` : undefined;
}

/** What a rest does to a tracker, as a screen writes it beside it: "Back after a Short Rest or Long Rest", or nothing. */
export function playRestNote(tracker: Pick<PlayTracker, 'restoredBy' | 'counts'>): string | undefined {
  if (!tracker.restoredBy.length) return undefined;
  return `${tracker.counts ? 'Goes down after' : 'Back after'} a ${tracker.restoredBy.join(' or ')}`;
}

/** The headings of what a rest gives back anything of, in the order shown: what a screen asks about before resting. */
export function restEffects(view: PlayView, restId: string): string[] {
  return view.groups
    .filter((group) => group.trackers.some((tracker) => tracker.restores.some((entry) => entry.rest === restId) && tracker.spent > 0))
    .map((group) => group.label);
}

/**
 * A play view's trackers by where they count on the sheet (ADR 0126), for a renderer that draws each beside its number:
 * a stat's, a section row's and a listed element's, and those that count no row (`loose`), in the view's order.
 */
export interface PlayPlaces {
  stat(stat: string): PlayTracker | undefined;
  row(section: string, row: string): PlayTracker | undefined;
  element(section: string, element: string): PlayTracker | undefined;
  loose: PlayTracker[];
  /** Every tracker, in the view's order, with the label of the group it is in. */
  all: Array<{ tracker: PlayTracker; group: string }>;
}

export function playPlaces(view: PlayView): PlayPlaces {
  const stats = new Map<string, PlayTracker>();
  const rows = new Map<string, PlayTracker>();
  const elements = new Map<string, PlayTracker>();
  const loose: PlayTracker[] = [];
  const all: PlayPlaces['all'] = [];
  for (const group of view.groups) {
    for (const tracker of group.trackers) {
      all.push({ tracker, group: group.label });
      const at = tracker.at;
      if (!at) loose.push(tracker);
      else if ('stat' in at) stats.set(at.stat, tracker);
      else if ('row' in at) rows.set(`${at.section}\u0000${at.row}`, tracker);
      else elements.set(`${at.section}\u0000${at.element}`, tracker);
    }
  }
  return {
    stat: (stat) => stats.get(stat.toLowerCase()),
    row: (section, row) => rows.get(`${section}\u0000${row}`),
    element: (section, element) => elements.get(`${section}\u0000${element}`),
    loose,
    all,
  };
}
