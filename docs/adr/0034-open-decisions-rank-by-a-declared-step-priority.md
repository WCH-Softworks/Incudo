# 0034 — Open decisions rank by a declared step priority, not a hardcoded rule

**Status:** Accepted · 2026-09-17 · amends [0017](./0017-open-decisions-not-steps.md) ·
touches the **system definition format**

## Context

A player picks a race with a subrace choice — Elf, say, which grants a marker element that
itself declares a `<select type="Sub Race">`. The request: Sub Race should read near the top of
"Open decisions," right after Race, the way `use-character-builder.ts` already lists an
unanswered Background ahead of a class's own Skill Proficiency select.

Two things were tried and both were measured wrong by actually running the app.

**Recency** — ranking a select by *when* the pick that opened it was last answered — sinks Sub
Race the moment the player answers anything afterward. Pick Race, then Class: Class's own
openings (Cantrip, Skill Proficiency) are now "more recent," and outrank Sub Race for good,
however long Sub Race has sat there unanswered. Restricting recency to top-level picks only
(ignoring subsequent content-select answers) delayed the symptom but did not remove it — a
still-unanswered Background eventually gets answered too, and Sub Race sinks again the moment it
is. Recency cannot express "stay pinned," only "was touched most recently."

**A blanket "every unanswered pick sorts before every select" rule** — the fix already shipped
for the Background-before-Skill-Proficiency case — turned out to be the thing actively fighting
the Sub Race request, not a neutral bystander. Race answered, opening Sub Race; Background still
unanswered. Under that rule, Background (an unanswered pick) unconditionally outranks Sub Race (a
select), regardless of the fact that Race comes *before* Background in the declared build order.
Sub Race and Skill Proficiency are the same shape relative to an unanswered Background — both are
selects opened by an earlier step — so **any single rule that keeps Background ahead of one keeps
it ahead of the other.** There is no monotonic ordering of the four things involved (Race, Class,
Background-pick, Background's-own-openings) that satisfies "Sub Race beats an unanswered
Background" and "an unanswered Background beats Skill Proficiency" at once. One of the two
requests has to give, structurally, not for lack of a cleverer formula.

Asked directly, the call was: let Sub Race win. That reopens the Skill Proficiency case the
older fix closed — accepted, and closed by the mechanism below instead of by a rule the engine
owns.

## Decision

**A build step declares its own `priority`; ranking is uniform across picks and selects, and
the old hardcoded rule is gone.**

```jsonc
{ "id": "background", "label": "Background", "types": ["Background"], "required": true,
  "priority": 1.5 }
```

Lower sorts first. Omitted, a step's rank is its position in `orderBuildSteps`'s result — the
same topological-sort-with-declared-order-as-tiebreak this project already computes for the
"Your character" list — so a system that never sets `priority` keeps exactly the order its array
already implies, unchanged from before this ADR.

`use-character-builder.ts`'s `compute()` now scores every decision on one scale:

- An **unanswered top-level pick** ranks by its own step's priority.
- A **select** ranks by the priority of whichever step's pick, once answered, transitively
  granted the element that declares it — Elf grants "Elven Subrace," which is what actually
  carries the `<select>`, so the walk follows `grant` rules from the chosen element outward
  (breadth-first, keeping the better rank where more than one path reaches the same marker),
  the same chain the recency attempt already had to walk.

Both picks and selects are sorted together by this one number. `dnd5e/system.json` gives
`background` a priority of 1.5 — between race's 1 and class's 2 — which is exactly what
restores the old nudge as data: an unanswered Background still outranks Class's own Skill
Proficiency select, because 1.5 < 2, while Race's Sub Race (rank 1) still outranks Background
(1.5), because 1 < 1.5. Nothing in the engine says "Background" or "Skill Proficiency"; the
number is the system author's call, not the app's.

## Consequences

**Good**
- The conflict is resolved by moving the decision to data (ADR 0003's whole stance), rather than
  by the engine picking a winner for every system. A system with a different shape of "what
  should stay visible near what" states its own priorities.
- `requires` and `priority` stay independent, on purpose: one gates *availability*, the other
  only *reads order* once available. A step blocked by `requires` doesn't need a `priority` to
  say where it will render once it opens.
- The migration is nothing: one optional number, defaulting to the existing topological index.
  `schemas/system.schema.json` gains a property; no `formatVersion` move, same reasoning ADR
  0032 gives for its own optional addition.
- No engine change. `pendingChoices`/`answeredChoices` in `packages/core/src/engine.ts` are
  untouched — ranking is entirely a `packages/ui` view-model concern, same as `focusedId`.

**Bad / accepted**
- A system author who does nothing gets the topological order, which will *not* generally
  reproduce the old "picks always first" behavior for every pick/select pair — only `dnd5e`'s
  explicit `background: 1.5` does, and only for that one relationship. A different system with a
  similar concern needs its own `priority` tuning; nothing infers it automatically, in line with
  ADR 0005's stance against guessing at a rule the content does not state.
- Two build steps that happen to share a priority (or a default index collision, which cannot
  actually happen since indices are unique) sort by whichever the concatenation order happens to
  place first — unspecified beyond "stable," and not worth a documented tiebreak for a case this
  narrow.

## Alternatives considered

**Keep recency, anchored more narrowly still (e.g., only the *most recent unanswered* pick's
openings float up).** Every narrower recency rule considered still degrades as soon as the
player answers the pick that used to be "most recent," for the reason above: recency is a
clock, and the request is for a fixed position.

**A per-decision-kind special case** (treat `kind: 'select'` opened by a race specifically
differently from one opened by a class). Rejected for the reason ADR 0003 already gives for
keeping `core` free of game nouns: "Sub Race" and "Skill Proficiency" are not concepts the engine
has, and encoding "races are special" would be exactly the kind of rule this project keeps
finding homes for in data instead.

**Score every select independently instead of via its granting pick's priority.** Considered and
rejected: it would need a `priority` on individual content elements or rules, which is a much
larger surface (thousands of elements) for a question `BuildStepDef` already answers at the
right size — there are eight steps in `dnd5e`, not thousands of selects.
