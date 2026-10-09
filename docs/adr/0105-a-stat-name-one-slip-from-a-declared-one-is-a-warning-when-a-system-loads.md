# 0105 — A stat name one slip from a declared one is a warning when a system loads

**Status:** Accepted · 2026-10-09 · groundwork for ROADMAP Phase 7's "How to write a system definition" guide · builds on
[0011](./0011-user-systems.md), [0102](./0102-an-overlay-is-a-patch-applied-to-its-parent-on-every-load-and-validated-as-the-system-it-makes.md),
[0103](./0103-a-system-error-says-where-in-the-file-by-line-and-by-the-ids-written-there.md) · **format:** unchanged

## Context

The guide's first measurement walked the starter system ADR 0104 writes, growing it as an author would, through the
validator and the builder. Most slips are refused with a line and a path (ADR 0103). Four validate, and one of them is
silent and wrong:

- **A misspelled stat in a `derive` expression.** The starter's Health is `might + level × 2`. With `might` written
  `mght` the file validates, a character derives with **no problem**, and Health reads 2 where it should read 16. Nothing
  says why.
- A budget target, a contribution's stat and a stat's `startsFrom` are not checked either.

They cannot simply be checked, because naming a stat the system does not declare is how a system reads what content adds:
**5e's player character names 72 of its 87 `derive` references without declaring them** (`speed:misc`,
`ac:armored:armor`, `strength:save:misc`, …), the NPC 25 of 64. Each reads 0 until content contributes to it, and that is
right. An error, or a warning on every undeclared name, would fire a hundred times on the system Incudo ships.

**Measured:** no undeclared name either shipped system writes in an expression, a budget, a contribution, a per-track
stat or a `startsFrom` is within one edit of a declared name (two for names of five letters or more). A slip like `mght`
is.

## Decision

1. **A system that validates may come back with warnings.** `SystemValidationResult.warnings` (`SchemaError[]`, empty
   when there are none or when the system did not validate) is computed by `validateGameSystem` itself, so every checker
   shares it, as ADR 0011 wants. A warning never refuses a file.
2. **The one warning: a stat name nothing declares that is a near miss of one that is declared** (`systemWarnings`,
   `packages/core/src/system-warnings.ts`). Read per kind, against every stat the kind resolves (the system's, its own,
   its parents', and its progression's stat), ignoring case as stat names always are. Places read: a `ref` in a stat's
   `derive`, a contribution's `stat` and `value`, a per-track stat's `stat` and `value`, a budget's `targets`, a stat's
   `startsFrom`. A name containing `{` is a template and is skipped. A near miss is an edit distance (a letter inserted,
   deleted or replaced) of at most 1 when the shorter name has four letters or fewer, else 2; the closest wins.
   The sentence: `names "mght", which this system does not declare; did you mean "might"? A stat nothing declares reads
   as 0 unless content adds to it.`
3. **Where it is shown.** `UserSystemStore` locates warnings like errors (`describeSystemErrors`, so an overlay's is
   traced to its own text) and publishes them per system (`LoadedUserSystems.warnings`, by id) and on a successful add
   (`AddSystemResult.warnings`). The desktop launcher lists them under the system's card, with the problems' wording.
   Shipped systems carry none, and a test holds that.

## Consequences

- The slip that produced Health 2 is named at its line. The 72 legitimate names stay quiet.
- **What it does not catch:** an undeclared name that is not close to a declared one (`luck` as a budget target in a
  system with no Luck), and a slip close to a name only content supplies. Both still read 0. The guide says so.
- Companions' scopes, block stats and attacks are not read: they are written with placeholders or in a scope of their
  own, and no shipped system is near-missed there.
- Not on the phone: user systems are not loaded there.
