/**
 * A save's element ids, spelled the way the loaded content spells them.
 *
 * Aurora matches ids ignoring case; Incudo compares them exactly, and that is right for the
 * engine, where an id is a key. A save can still record `…_CLERIC_War_DOMAIN` while the file
 * that declares the domain says `…_CLERIC_WAR_DOMAIN`. Read exactly, that id resolves to
 * nothing: the character loses the whole domain, and the only trace is a report-only
 * `content-missing` and one `unresolved-element`.
 *
 * The place for the fix is here, at the boundary, and not in `ElementIndex`. Every other id
 * an engine ever sees comes from content, which spells it one way, so the save is the one
 * source of a second spelling. Folding inside `get` would leave the character recording an id
 * that the rest of the system, a requirement's membership test included, compares exactly.
 *
 * Only an id the content does not have as written is touched, and only when exactly one
 * element matches ignoring case. Content with two ids differing only by case would make a
 * fold a guess (none of the official corpus does), so those are left alone.
 */

import type { ElementId, ElementIndex } from '@incudo/core';
import type { AuroraSave } from './parse-save.ts';

export interface CanonicalizedSave {
  /** A copy: the save passed in is never modified. */
  save: AuroraSave;
  /** How many distinct ids were respelled. */
  changed: number;
}

export function canonicalizeSaveIds(save: AuroraSave, index: ElementIndex | undefined): CanonicalizedSave {
  if (!index) return { save, changed: 0 };

  // Built lazily: a save whose ids all match exactly, the usual case, never pays for it.
  let folded: Map<string, ElementId | null> | undefined;
  const respelled = new Map<ElementId, ElementId>();

  const fold = (id: ElementId): ElementId => {
    if (index.get(id)) return id;
    const known = respelled.get(id);
    if (known) return known;
    if (!folded) {
      folded = new Map();
      for (const element of index.all()) {
        const key = element.id.toLowerCase();
        // `null` marks two spellings of one id: ambiguous, so never a match.
        folded.set(key, folded.has(key) ? null : element.id);
      }
    }
    const match = folded.get(id.toLowerCase());
    if (!match) return id;
    respelled.set(id, match);
    return match;
  };

  const out: AuroraSave = {
    ...save,
    decisions: save.decisions.map((d) => ({
      ...d,
      ownerId: fold(d.ownerId),
      // A list's `registered` is a small local number, never an id.
      registered: d.isList ? d.registered : fold(d.registered),
    })),
    levels: save.levels.map((l) => (l.classRef === undefined ? l : { ...l, classRef: fold(l.classRef) })),
    grants: save.grants.map((g) => ({
      ...g,
      id: fold(g.id),
      ...(g.parentId === undefined ? {} : { parentId: fold(g.parentId) }),
    })),
    equipment: save.equipment.map((item) => ({
      ...item,
      id: fold(item.id),
      adorners: item.adorners.map((a) => ({ ...a, id: fold(a.id) })),
    })),
    sum: save.sum.map(fold),
    magic: save.magic.map((block) => ({
      ...block,
      cantrips: block.cantrips.map((s) => ({ ...s, id: fold(s.id) })),
      spells: block.spells.map((s) => ({ ...s, id: fold(s.id) })),
    })),
  };
  return { save: out, changed: respelled.size };
}
