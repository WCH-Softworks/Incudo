# 0008 — Aurora compatibility is import-only, and it gets to be finished

**Status:** Accepted · 2026-09-09 · **criteria met 2026-09-09 — `packages/aurora-import` is frozen**

## Context

Aurora Builder is discontinued. Its content format has not changed in years and will not change
again; AuroraLegacy maintains *content*, not the format. Its save format is at `version="1.0.3"`
and no version 1.0.4 is coming.

Compatibility work usually has no end, because the thing you are compatible with keeps moving.
Here it does not. That is unusual and worth exploiting.

## Decision

**Aurora support is import-only, and it is a task that completes.**

- Incudo reads Aurora `.index`, elements `.xml`, and `.dnd5e` saves.
- Incudo **does not export** to Aurora formats. Nothing is going to read them.
- Once the importer round-trips the AuroraLegacy corpus and a sample of real saves, the Aurora
  packages are marked **DONE** and enter bugfix-only maintenance. No feature work, no
  refactoring for its own sake, no speculative support for formats that will never exist.

The DONE criteria, so it is falsifiable:

1. The full AuroraLegacy corpus imports with no errors and no *new* unresolved references
   against the recorded baseline.
2. All 8 sample `.dnd5e` characters import, re-derive, and match the `<sum>` / `<magic>` blocks
   Aurora itself wrote (or every difference is explained and recorded as an Aurora bug).
3. `docs/AURORA-FORMAT.md` and `docs/AURORA-SAVE-FORMAT.md` describe every construct the corpus
   actually uses.
4. The importer's diagnostics name what they cannot handle instead of failing silently.

After that, `packages/aurora-import` is frozen. It carries a note at the top saying so.

## Outcome

All four criteria are met, and the package is frozen. Measured numbers live in
`docs/AURORA-FORMAT.md` and `docs/AURORA-SAVE-FORMAT.md`; the three that matter here:

1. The corpus imports with 0 errors and **1** unresolved grant reference, down from 57 — one
   upstream misspelling. 80 elements Aurora materializes at runtime are supplied as an overlay.
2. All 8 sample saves import and re-derive with **0 missing elements, 0 missing spells and 0
   mismatched numbers**. The 52 remaining differences are content added upstream after those
   saves were written, traced to four dated commits.
3. Both format documents now describe every construct the corpus uses — which took finding
   three it *does* use and the importer did not: element-level `<supports>` (3,611 blocks, and
   every support tag in the corpus), element-level `<requirements>` (1,845), and `<append>`
   (171).

One thing this ADR got wrong, worth recording because it cost nothing to fix and would have
cost a lot to discover later. "Criterion 2 is a claim about a corpus, not about all Aurora
content" is in the Consequences below, and that is right. But criteria 1 and 3 were also
treated as separable, and they are not: the reason the dropped `<supports>` handling survived a
clean 12,058-element import is that *no reading of the format catches it* — 890 tags parsed into
zero elements produces no error, no warning and no dangling reference. Only diffing against a
derivation somebody else performed caught it. A compatibility claim needs an oracle, not a
parser that does not complain.

## Consequences

**Good**
- A bounded amount of work on a dead format, rather than an open-ended obligation.
- Freezing it makes it safe to depend on and cheap to leave alone.
- Removing Aurora export from the roadmap deletes real work that would have served nobody.

**Bad / accepted**
- Someone will eventually want Aurora export to move a character *back*. The answer is no —
  and if that changes, it needs a new ADR arguing why, not a quiet feature.
- "DONE" is a claim about a corpus, not about all Aurora content that has ever existed. Private
  homebrew may still break it. That is a bugfix, which the policy allows; the corpus baseline in
  CI is what keeps the claim honest.

## Note

This supersedes the "Export back to Aurora-compatible XML" item in the original Phase 3.
