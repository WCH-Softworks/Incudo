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
  const stats: Record<string, number | string> = {};
  for (const key of [...derived.stats.keys()].sort()) {
    const stat = derived.stats.get(key)!;
    stats[key] = stat.text ?? stat.value;
  }

  return {
    character: {
      id: derived.character.id,
      name: derived.character.name,
      systemId: derived.character.systemId,
      kind: derived.character.kind,
      progress: derived.character.progress,
    },
    elements: derived.elements.map((e) => e.id).sort(),
    stats,
    pendingChoices: derived.pendingChoices
      .map((c) => ({ ruleKey: c.ruleKey, label: c.label, remaining: c.remaining }))
      .sort((a, b) => (a.ruleKey < b.ruleKey ? -1 : 1)),
    problems: derived.problems
      .map((p) => ({ level: p.level, code: p.code, message: p.message, elementId: p.elementId }))
      .sort((a, b) => (a.message < b.message ? -1 : 1)),
  };
}
