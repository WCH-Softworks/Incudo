# 0005 — Aurora import is a first-class, day-one feature

**Status:** Accepted · 2026-09-09

## Context

Aurora's real asset is not its code — it is ten years of community content: AuroraLegacy's
maintained core/supplements/UA indexes plus an enormous amount of third-party homebrew, all in
Aurora's XML dialect. A replacement that cannot read it starts with zero content and does not get
adopted.

The alternative — defining a clean HeroForge format and asking the community to convert — has
been tried by every would-be Aurora successor and has never worked.

## Decision

- `@heroforge/aurora-import` is built in **Phase 0**, before any UI. It is the first thing that
  runs, driven by the `hf` CLI.
- Aurora `.index` and elements `.xml` are supported as **native input formats**, not as a
  migration step. The app can point directly at
  `https://raw.githubusercontent.com/AuroraLegacy/elements/master/core.index` and work.
- HeroForge's own model is designed to be a superset of Aurora's semantics, so import is
  near-lossless. Where Aurora's format is ambiguous (the `$(…)` interpolation in `supports`,
  app-generated `ID_INTERNAL_*` elements), the importer **reports diagnostics rather than
  guessing silently**.
- The importer never mutates upstream files. Fixes go in HeroForge overlay files.

## Consequences

**Good**
- Day one, HeroForge has more content than any greenfield competitor.
- AuroraLegacy keeps maintaining content; HeroForge gets those updates for free.
- The format is well understood (see `docs/AURORA-FORMAT.md`) and the corpus is available as a
  test fixture — 12,000 elements is a very good regression suite.

**Bad / accepted**
- HeroForge inherits Aurora's design decisions, including its quirks. Some of that is technical
  debt from the start. Accepted: compatibility is worth more than purity here, and the quirks
  are documented rather than hidden.
- Aurora has undocumented app-side behaviour that content relies on. The importer will hit cases
  no reading of the files predicts. Mitigation: run the importer over the *entire* AuroraLegacy
  repo in CI and fail on new unresolved references.

## Scope note

This ADR covers Aurora **content** files, which are fully understood. Aurora **character save**
files are a separate, unexamined format — see the open question in `docs/AURORA-FORMAT.md`.
They are Phase 2 and need their own spike and possibly their own ADR.
