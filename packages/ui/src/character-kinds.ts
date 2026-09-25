/**
 * The kinds of character a system lets you start, and how each names its progression — ADR 0009, ADR 0057.
 *
 * A 5e table has a player character, an NPC and a legendary creature; Cairn has one kind. Nothing here
 * knows which: the list, the names and the progression's label are the system's, and the shell renders
 * them. The default kind comes first because it is what "New character" meant before there was a choice.
 */

import {
  clampProgress,
  createCharacter,
  initialProgress,
  printedProgress,
  progressCanBePrinted,
  resolveCharacterKind,
  type Character,
  type Element,
  type GameSystem,
  type ResolvedCharacterKind,
} from '@incudo/core';

/** One kind a new character can be, as a chooser shows it. */
export interface KindChoice {
  id: string;
  name: string;
  description?: string;
  default: boolean;
  /** What the kind's progression is called — "Level", "Challenge Rating" — or undefined when it has none. */
  progressLabel?: string;
}

/** Every kind the system declares, the default first and the rest in declaration order. */
export function characterKindChoices(system: GameSystem): KindChoice[] {
  const choices = system.characterKinds.map((def) => {
    const kind = resolveCharacterKind(system, def.id);
    return {
      id: kind.id,
      name: kind.name,
      description: kind.description,
      default: kind.default,
      progressLabel: progressLabel(kind),
    };
  });
  return [...choices.filter((c) => c.default), ...choices.filter((c) => !c.default)];
}

/**
 * The label of the stat a kind's progression is published as, from the kind's own stat list.
 *
 * "Challenge Rating", not the stat's name `challenge`. Falls back to the stat name when the kind gives
 * it no label, and is undefined for a progression of `none`.
 */
export function progressLabel(kind: ResolvedCharacterKind): string | undefined {
  const progression = kind.progression;
  if (progression.kind === 'none') return undefined;
  const stat = progression.kind === 'level' ? (progression.stat ?? 'level') : progression.stat;
  const def = kind.stats.find((s) => s.name.toLowerCase() === stat.toLowerCase());
  return def?.label ?? stat;
}

/**
 * A progression number as a person writes it: `3`, and `1/4` for a quarter.
 *
 * A challenge rating of 1/8 is stored as 0.125 (the character schema says fractions are legal), and a
 * card reading "0.125" is a number nobody wrote. A unit fraction reads as one; anything else as a number.
 */
export function formatProgress(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (value > 0 && value < 1) {
    const denominator = Math.round(1 / value);
    if (Math.abs(1 / denominator - value) < 1e-9) return `1/${denominator}`;
  }
  return String(value);
}

/**
 * "Player Character · Level 3", "NPC / Monster · Challenge Rating 1/4": what a library card says a
 * character is. A kind the system does not declare is named by its id rather than dropped, so a card for
 * a character from a newer or edited system still says something true.
 */
export function describeKindAndProgress(
  system: GameSystem,
  kindId: string | undefined,
  progress: number | undefined,
): string {
  if (kindId === undefined) return progress === undefined ? '' : formatProgress(progress);
  let kind: ResolvedCharacterKind | undefined;
  try {
    kind = system.characterKinds.some((k) => k.id === kindId) ? resolveCharacterKind(system, kindId) : undefined;
  } catch {
    kind = undefined;
  }
  if (!kind) return progress === undefined ? kindId : `${kindId} · ${formatProgress(progress)}`;
  const label = progressLabel(kind);
  if (progress === undefined || label === undefined) return kind.name;
  return `${kind.name} · ${label} ${formatProgress(progress)}`;
}

/**
 * The progression point a library card shows — ADR 0060. What the character records, or, for one that records
 * none, where the creature it chose prints it (or where the kind's progression starts). The library keeps the
 * chosen elements for exactly this, and the system's definition says which setter to read.
 */
export function libraryEntryProgress(
  system: GameSystem,
  entry: { kind?: string; progress?: number; chosen?: readonly Element[] },
): number | undefined {
  if (entry.progress !== undefined || entry.kind === undefined) return entry.progress;
  let kind: ResolvedCharacterKind;
  try {
    kind = resolveCharacterKind(system, entry.kind);
  } catch {
    return undefined;
  }
  if (kind.progression.kind === 'none') return undefined;
  const printed = printedProgress(kind, entry.chosen ?? []).printed?.value;
  return clampProgress(kind.progression, printed ?? initialProgress(kind.progression));
}

/**
 * A blank character of one of the system's kinds, at the start of its progression.
 *
 * A 5e PC starts at level 1 and a monster at challenge 0; the kind's progression is the only thing that
 * knows which. Throws on a kind the system does not declare: a character of a kind nothing can resolve
 * would fail on its first derivation, further from the cause.
 */
export function newCharacterOfKind(system: GameSystem, kindId: string, name = 'New Character'): Character {
  const kind = resolveCharacterKind(system, kindId);
  // A kind whose progression a creature prints records none, so the creature chosen says where it starts
  // and a value the DM types replaces it (ADR 0060). Every other kind starts where its progression does.
  if (progressCanBePrinted(kind)) return createCharacter(system.id, kind.id, { name, progress: null });
  return createCharacter(system.id, kind.id, {
    name,
    progress: clampProgress(kind.progression, initialProgress(kind.progression)),
  });
}
