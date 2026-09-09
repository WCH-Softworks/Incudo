# 0006 — Characters store choices, never derived numbers

**Status:** Accepted · 2026-09-09 · **amended by [ADR 0012](./0012-self-contained-saves.md)**

> **Amendment.** The "significant cost" flagged below — that a character cannot be opened
> without its content sources — was weighed and rejected. A save now embeds the content its
> character uses, so it opens anywhere. Everything else here stands: the character still stores
> choices, and every number is still derived. ADR 0012 changes what travels *with* the choices,
> not what the choices are.

## Context

A character file could store the finished character (AC 17, HP 58, these spell slots) or the
decisions that produce it (elf, rogue 5 / wizard 3, these selections). Most character builders
store some of both and drift.

## Decision

A `.heroforge` character stores **only**: system id, level, the list of chosen element IDs, free
text (name, notes, portrait), the source versions it was built against, and an explicit
`overrides` map. Every number on the sheet is derived by running the rules at read time.

## Consequences

**Good**
- Files are ~2 KB, human-readable, and diff cleanly in git.
- Upstream content fixes apply retroactively — no migration, no stale characters.
- The engine is the single source of truth; there is no second implementation of the rules in a
  serializer to disagree with it.
- The builder UI and the sheet render the same `DerivedCharacter`, so they cannot disagree.

**Bad / accepted**
- **A character cannot be opened without its content sources.** This is the significant cost.
  Mitigations: `Character.sources` records exactly what is needed; content used by a character is
  cached even in live mode (ADR 0004); a "freeze" export that inlines the needed elements is a
  candidate for Phase 3.
- Content changing upstream can change a character. `sources` versions make this detectable and
  warnable, not silent.
- Derivation cost is paid on every open. Expected to be milliseconds; if it is not, memoize —
  do not start persisting derived values.
- `overrides` is a deliberate escape hatch for wrong or missing content. It is *not* a general
  editing mechanism, and the UI should present it as a repair tool, clearly marked on the sheet.

## Alternatives considered

- **Store derived values as a cache alongside choices:** invites the cache and the truth to
  diverge, which is the failure mode this decision exists to prevent.
- **Store the fully-resolved character:** makes files portable without content, but freezes
  bugs in place and makes level-up a re-derivation problem anyway.
