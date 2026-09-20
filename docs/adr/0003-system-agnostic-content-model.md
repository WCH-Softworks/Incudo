# 0003 — Game systems are data, not code

**Status:** Accepted · 2026-09-09

## Context

The project's premise is that Incudo is not D&D-exclusive. But in practice it will be built
and tested almost entirely against D&D 5e content for a long time. Every project that has made
this promise has broken it the same way: 5e concepts leak into the engine, and the second system
turns out to need a rewrite.

Aurora itself is instructive. Its content format is *already* nearly system-agnostic — elements,
grants, selects, stats, no D&D nouns in the grammar. What is not agnostic is the **app**: the
list of element types (`Race`, `Class`, `Spell`, …), the build flow, and the sheet layout are
hardcoded in Aurora's C#. That hardcoded knowledge is exactly the boundary to move.

## Decision

**Everything Aurora hardcodes about D&D becomes a data file.** A game system is
`systems/<id>/system.json`, declaring:

- `elementTypes` — the type vocabulary and how types nest (a `Class` may have `Archetype` children)
- `stats` — declared stat names, defaults, and derivations
- `characterKinds` — one entry per kind of character the system can build, each owning its own
  `buildSteps` (the wizard structure), `sheet` (layout hints) and `progression`

> **Amended by [ADR 0009](./0009-character-kinds.md).** `buildSteps` and `sheet` were flat fields
> on the system, alongside a `levelRange`. They now belong to a character kind, and `levelRange`
> is a `progression` union — `level`, `rating`, `xp` or `none`. Same principle, one level down:
> modelling only PCs would have welded PC assumptions into the build flow and the sheet exactly
> the way Aurora welded in D&D.

`@incudo/core` must not contain the strings `strength`, `spell`, `armor class`, `d20` or any
other game-specific noun outside of tests and fixtures. Stats are opaque namespaced keys; element
types are opaque strings.

Where a system needs *computation* (5e's proficiency bonus is `2 + floor((level - 1) / 4)`), it
declares an expression in `StatDef.derive`, evaluated by core's expression evaluator. Systems do
not ship JavaScript.

## Consequences

**Good**
- The Aurora importer becomes almost mechanical: Aurora's element types map to declared types
  rather than to engine branches.
- A second system is a data file, not a fork.
- Homebrew authoring (roadmap Phase 6) is the same machinery as system authoring.

**Bad / accepted**
- More indirection than a 5e-only app would need; some 5e code will be slightly awkward
  (spell slot tables as declared data rather than a lookup array).
- An expression evaluator has to be written and kept small. It is deliberately *not* a scripting
  language — no loops, no I/O — because systems come from the internet.
- Genuinely unusual systems (dice pools, clocks, classless advancement) may not fit the
  element/rule vocabulary. Accepted: the vocabulary can grow, but only when a real second system
  forces it, not speculatively.

## How this gets kept honest

1. `tools/incudo` exercises the engine with no UI, so no UI assumption can hide in it.
   *(Note, ADR 0039: that job now belongs to the tests in `tools/verify`; the CLI is gone.)*
2. `systems/cairn` — a deliberately tiny, classless, non-D&D system — is added early. Small
   enough to maintain as a side-effect, different enough that 5e-shaped assumptions break it.
3. Roadmap Phase 5 is a real second system, and it is explicitly flagged as the phase that must
   not slip.
