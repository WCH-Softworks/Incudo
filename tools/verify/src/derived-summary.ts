/**
 * What "the same derived output" means, for every test that has to say it.
 *
 * `self-contained.test.ts`, `library.test.ts`, `save-copy.test.ts` and `multiclass.test.ts` all
 * ask the same question — is this derivation identical to that one? — and this is the definition
 * they share. It lives beside the tests and not in a package because it is a test's notion of
 * equality, not product code: nothing an app ships needs to compare two derivations byte for byte.
 */

import type { DerivedCharacter } from '@incudo/core';

export interface DerivedSummary {
  character: { id: string; name: string; systemId: string; kind: string; progress: number };
  elements: string[];
  stats: Record<string, number | string>;
  pendingChoices: Array<{ ruleKey: string; label: string; remaining: number }>;
  problems: Array<{ level: string; code: string; message: string; elementId?: string }>;
  /** What a grant brought in and the element's own requirements ruled out (ADR 0071): the character's, not content's. */
  withdrawn: Array<{ elementId: string; grantedBy: string[] }>;
  /**
   * Each held creature's scope (ADR 0073): what it holds, its stats and what it finds. Present only when the character
   * holds one, so the summary of every other character is what it was.
   */
  companions?: Array<{ elementId: string; elements: string[]; stats: Record<string, number | string>; problems: string[] }>;
}

/**
 * The comparable projection of a derivation.
 *
 * Sorted and stripped to what a character *is*, so two derivations of the same character can
 * be compared byte for byte. Candidate lists are deliberately excluded: they depend on what
 * content is loaded, which is exactly the thing that differs between the two runs, and
 * embedding every option a character could have taken is explicitly not what a save is for
 * (ADR 0012).
 */
export function summarize(derived: DerivedCharacter): DerivedSummary {
  const statsOf = (map: DerivedCharacter['stats']): Record<string, number | string> => {
    const out: Record<string, number | string> = {};
    for (const key of [...map.keys()].sort()) {
      const stat = map.get(key)!;
      out[key] = stat.text ?? stat.value;
    }
    return out;
  };
  const stats = statsOf(derived.stats);
  const companions = derived.companions.map((c) => ({
    elementId: c.elementId,
    elements: c.elements.map((e) => e.id).sort(),
    stats: statsOf(c.stats),
    problems: c.problems.map((p) => `${p.level} ${p.code}: ${p.message}`).sort(),
  }));

  return {
    character: {
      id: derived.character.id,
      name: derived.character.name,
      systemId: derived.character.systemId,
      kind: derived.character.kind,
      // What the derivation read, which a character that records none still has (ADR 0060).
      progress: derived.progress.value,
    },
    elements: derived.elements.map((e) => e.id).sort(),
    stats,
    pendingChoices: derived.pendingChoices
      .map((c) => ({ ruleKey: c.ruleKey, label: c.label, remaining: c.remaining }))
      .sort((a, b) => (a.ruleKey < b.ruleKey ? -1 : 1)),
    problems: derived.problems
      .map((p) => ({ level: p.level, code: p.code, message: p.message, elementId: p.elementId }))
      .sort((a, b) => (a.message < b.message ? -1 : 1)),
    withdrawn: derived.withdrawn
      .map((w) => ({ elementId: w.elementId, grantedBy: [...w.grantedBy].sort() }))
      .sort((a, b) => (a.elementId < b.elementId ? -1 : 1)),
    ...(companions.length ? { companions } : {}),
  };
}
