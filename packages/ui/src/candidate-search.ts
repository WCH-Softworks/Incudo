/**
 * Narrowing a candidate list by typed text, for a picker with more options than a screen
 * should render at once.
 *
 * Race offers ~139 candidates and a mid-level Wizard's Spellbook decision 300+; showing every
 * one as a card does not fit. This is the presentational half of that problem — matching and
 * ranking, with an optional cap for a caller that wants one — kept here rather than in
 * `apps/desktop` because a card-stack mobile shell will face the identical list and the
 * identical list (CODE-REUSE-POLICY rule 2). It knows nothing about elements or descriptions:
 * a candidate is an id and the text already decided to show for it, which is `candidateLabel`'s
 * output (name, and the book it came from where one is recorded) — matching against that one
 * string covers both without a separate `source` field to keep in sync.
 */

export interface CandidateOption<Id> {
  id: Id;
  /** What the picker shows for this option — already formatted by the caller. */
  label: string;
}

export interface CandidateSearch<Id> {
  /** At most `limit` options, best matches first. */
  matches: CandidateOption<Id>[];
  /** How many options matched before the limit cut the list — `matches.length` when nothing was cut. */
  matchCount: number;
}

/**
 * `query` empty returns every option, alphabetically — the state a picker opens in before the
 * user types anything. There is no default cap: a cap hides options from someone who does not
 * know what to type (a first-time player choosing a Background has no name to search for), and
 * a list of collapsed rows is cheap to render. Pass `limit` only where cutting is acceptable. A non-empty query ranks an exact label match first,
 * then a label starting with it, then anything else containing it, so typing "elf" finds "Elf"
 * before "Half-Elf" before a class feature that merely mentions one in its book title.
 */
export function searchCandidates<Id>(
  options: CandidateOption<Id>[],
  query: string,
  limit: number = Infinity,
): CandidateSearch<Id> {
  const q = query.trim().toLowerCase();
  const matching = q ? options.filter((option) => option.label.toLowerCase().includes(q)) : options;
  const sorted = [...matching].sort(
    (a, b) => rank(a.label, q) - rank(b.label, q) || a.label.localeCompare(b.label),
  );
  return { matches: sorted.slice(0, limit), matchCount: sorted.length };
}

function rank(label: string, q: string): number {
  if (!q) return 0;
  const lower = label.toLowerCase();
  if (lower === q) return 0;
  if (lower.startsWith(q)) return 1;
  return 2;
}
