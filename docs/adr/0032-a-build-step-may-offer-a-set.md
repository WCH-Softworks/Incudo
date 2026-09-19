# 0032 — A build step may offer a set, and campaign options are the first one

**Status:** Accepted, implemented · proposed 2026-09-13 · builds on
[0017](./0017-open-decisions-not-steps.md), [0011](./0011-user-systems.md) ·
touches the **system definition format**

## Context

A player asked for a switch that turns a race's fixed ability score increases into ones they
choose — Tasha's "Customizing Your Origin". Grepping the 740 files first, as this project keeps
learning to do, found that **the entire mechanism is already written by content and Incudo
simply cannot reach it.**

Every race carries both halves of the switch. From `core/players-handbook/race-dwarf.xml`:

```xml
<stat name="constitution" value="2"
      requirements="!(ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI||ID_INTERNAL_GRANTS_BACKGROUND_ASI)" />
<select type="Ability Score Improvement" name="Custom Ability Score Improvement +2 (Dwarf)"
        supports="Custom Ability Score Increase 2"
        requirements="ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI,!ID_INTERNAL_GRANTS_BACKGROUND_ASI" />
```

A clean either/or, written 294 times across the corpus. Hold
`ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI` and the fixed +2 stops applying and a choosable one
appears. Nothing needs modelling, no number needs deriving, and no rule needs inventing. The
engine already evaluates both requirement expressions correctly today.

The switch is an element of `type="Option"`. There are **six in the whole corpus**:

| id | name |
|---|---|
| `ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI` | Customized Ability Score Increases |
| `ID_WOTC_TCOE_OPTION_CUSTOMIZED_LANGUAGE` | Customized Language |
| `ID_WOTC_TCOE_OPTION_CUSTOMIZED_PROFICIENCY` | Customized Proficiencies |
| `ID_WOTC_DMG_OPTION_FIREARMS` | Firearms |
| `ID_WOTC_SCAG_OPTION_BATTLERAGER` | Battlerager |
| `ID_WOTC_SCAG_OPTION_BLADESINGING` | Bladesinger |

Plus `ID_INTERNAL_OPTION_ALLOW_FEATS` from the overlay, which is what gates the Human Variant
and around 200 other requirement expressions.

The model already has a home for them. `aurora-import` writes the options a save records to a
choice keyed `build/options` (`OPTIONS_RULE_KEY`), and `deriveCharacter` seeds from it like any
other choice. There is even a test in `use-character-builder.test.ts` that does
`b.choose('build/options', ['OPTION'])` and asserts the gated element becomes available.

**So an Aurora character keeps its options and a character built in Incudo can never have one.**
The gap is that `systems/dnd5e/system.json` declares no `options` build step — and could not
usefully declare one, which is the decision below.

## The problem with declaring it today

`CharacterBuilder` turns a build step into a top-level `pick` under exactly one condition:

```ts
if (!step.required || step.perLevel || !step.types.length) continue;
```

A **required** step becomes one single-answer pick. A **non-required** step becomes nothing at
all, deliberately — `equipment`, `spells` and `details` are non-required steps with types, and
inventing a decision for them would offer the user every Item, every Spell and every Language
in the corpus as a thing to pick exactly one of.

Campaign options are neither shape. They are:

- **optional** — a table that uses none of them is the common case, and "I have not chosen any
  options" must never read as an unanswered obligation;
- **a set** — Firearms and Customized Ability Score Increases are independent, and a table may
  run both, either or neither.

There is no way to say that in the format. That is the whole of this ADR.

## Decision

**A build step may declare that it offers a set rather than a single answer.**

```jsonc
{
  "id": "options",
  "label": "Campaign options",
  "types": ["Option"],
  "multiple": true          // new
}
```

`multiple: true` means: publish this step as a decision whose answer is **zero or more** of its
candidates, never blocking, recorded under `build/<stepId>` like every other top-level pick.

Three things follow, and each is a consequence rather than a separate choice:

1. **`OpenDecision` gains `chosen: ElementId[]`.** It publishes `candidates` and, since
   [the settled-pick work](./0017-open-decisions-not-steps.md), a settled pick publishes what
   was chosen — but an *open* multi-select needs both at once, because adding to a set means
   sending the whole set to `choose`, which replaces. A shell cannot do that without being told
   what is already in it.
2. **A `multiple` step is never blocking**, whatever `required` says. Combining the two is
   meaningless — "you must choose at least one of the optional rules your table uses" — and
   validation should reject `required` and `multiple` together rather than pick a reading.
3. **`formatVersion` does not move.** A definition without `multiple` behaves exactly as it does
   now, and an older reader handed a definition with it ignores an unknown key and gets the
   present behaviour: the step contributes no decision. That is a degradation, not a
   misreading — the character is built without options, which is what happens today.

### Why this is a format change and not an app convention

The tempting cheap version is to special-case a step whose id is `options`, or whose types are
`["Option"]`. Both put a piece of D&D into `packages/core`, which
[ADR 0003](./0003-system-agnostic-content-model.md) forbids outright — `Option` is an Aurora
element type, not a concept the engine has. A system that wants a set-valued step for something
else entirely has to be able to say so.

It is also not only about options. The same capability is what a shell needs to let a wizard
pick three cantrips: today `BuilderPane` calls `choose(id, [value])` for a select needing three,
and `setChoice` replaces, so the pool never fills past one. That is a live bug, it is fixed by
`OpenDecision.chosen`, and doing it once for both is the reason this ADR is about the general
shape rather than about a checkbox.

## Consequences

**What it buys, beyond the request.** Customized Languages and Customized Proficiencies work by
the same mechanism and arrive free. So does the Human Variant, which is unreachable today for
the same reason and has been quietly absent from every race list the app has ever drawn.

**A campaign setting is arguably not the character's to hold.** `OPTIONS_RULE_KEY`'s own doc
says so: Aurora stores it per character because Aurora has no concept of a campaign, and neither
does Incudo. This ADR keeps it on the character, because moving it is a bigger decision that
wants a campaign to move it to, and because an imported Aurora save records it per character and
must round-trip. If a campaign ever arrives, `build/options` is the single place that moves.

**`aurora verify` cannot check any of this**, for [ADR 0030](./0030-a-declared-block-answers-a-filter.md)'s
reason: it compares the elements a character *chose*, and this changes what is *offered*. All
nine sample saves will be byte-identical before and after. The evidence has to be measurement
and perturbation — the number of candidates a race offers with the option on and off, and a
level-1 wizard whose spellbook actually reaches six.

**The migration is nothing.** One optional boolean, ignored where absent, plus one build step in
`systems/dnd5e/system.json`. `schemas/system.schema.json` gains a property and
`validateGameSystem` gains the `required`-and-`multiple` rejection.

## Not decided here

Whether a `multiple` step should carry a maximum. Options have none — a table can run all six —
and inventing one to cover a hypothetical would be the guess
[ADR 0005](./0005-aurora-import.md) rules out. A content `<select number="N">` already has its
own count and does not go through this path.

## Status note

The shared mechanism landed ahead of the feature this ADR is named for, and in the order this
note originally predicted: `OpenDecision` gained `chosen: ElementId[]`, exactly as decision 1
specifies, because it was also the fix for a live bug a player hit before any `multiple` step
existed — a wizard's second and third cantrip silently overwrote the first, and the select could
never close. `BuilderPane`'s write while a pool is still open is now
`choose(id, [...decision.chosen, value])` rather than `choose(id, [value])`, which is "replace"
for a `pick` (`chosen` is always `[]` there) and "add to" for a `select` asking for more than
one, with no branch between the two.

**A second pass, once the first one shipped, fixed the part that still did not match "the other
selections": a full pool used to vanish outright**, with no way back to it — closer to the hole
[ADR 0017](./0017-open-decisions-not-steps.md) already named and fixed for a top-level pick than
to anything new. The engine gained `answeredChoices` alongside `pendingChoices`
(`packages/core/src/engine.ts`) — the same pool-grouping work, but for the pools with nothing
left to choose, publishing every slot's answer plus what any one slot could hold instead.
`packages/ui` folds these into the existing `picks`/`SettledPick` array a top-level pick already
used, so a full content `select` now renders in "Choices already made" exactly like Race or
Background: one `<select>` per filled slot, each independently changeable, each excluding every
*other* slot's current answer so two slots can never agree on one. `pendingChoices` kept its
existing contract — it still means only "outstanding" — so the CLI and the self-containment test
needed no changes at all.

**A third pass split the two apart, per slot, rather than waiting for the whole pool.** A
wizard's first cantrip used to sit inside the open decision (as a tag, in the intermediate shape
the first pass shipped) until the second and third were also answered — one part settled, one
part outstanding, but shown as if the whole pool were still one undecided thing. Now every slot
with an answer settles into `picks` the moment it is recorded, whether or not the pool it belongs
to still owes more, and the open decision shows only what is left: "Cantrip (Wizard), 2 left"
with a plain dropdown, no tags, once the first of three is picked. `use-character-builder.ts`
builds this from `pendingChoices` alone — a partially-filled pool's own `candidates` already
excludes everything the character holds, so the same "add `chosen` back for that pool's own
entries" trick used for a full pool works unchanged for a partial one, and `answeredChoices` was
not touched.

**`multiple: true` is built — this ADR is implemented.** `BuildStepDef.multiple`, the schema
property and the `required`-and-`multiple` refusal in `validateGameSystem`; a `multiple` step
publishes an open, non-blocking decision (`OpenDecision.multiple`, with `chosen` and the
candidates still to add) and settles what is chosen into `picks` (`SettledPick.multiple`, whose
answers can be taken back as well as changed); and `systems/dnd5e/system.json` declares an
`options` step over `Option`. `formatVersion` did not move. Decisions 1–3 hold as written, with
five things the ADR did not say:

- **A set is found under `build/<stepId>` only**, unlike a race, which is found by what it holds
  (`top-level-pick.ts`). `aurora-import` writes a save's options to exactly that key, so there is no
  second place to look, and looking by type would risk claiming a record a content `select` owns.
- **The decision stays open while anything is left to add**, and the user closes it with Skip
  (ADR 0033), as with any optional decision. An answer settles at once, so a chosen option is
  always editable; the shell needs a **Remove** control for it, which is why `SettledPick` says it
  is a set and the pane does not guess.
- **The step is placed right after ability scores**, so a table's rules are read before the race
  they change. That is a position in the array, not a `priority`.
- **The Human Variant is not on a race list.** It is a `Race Variant` that a Human offers through
  its own optional select, gated on `ID_INTERNAL_OPTION_ALLOW_FEATS`; this ADR's Context and
  Consequences say "race list", which was wrong about where it lives and right about why it was
  missing. Measured: 10 candidates for a Human with feats off, 11 with them on.
- **`ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` is offered and does nothing.** The overlay calls it an
  `Option`, so a step over `Option` offers it; nothing in 740 files reads it and the class control
  is deliberately not gated on it (ADR 0036). Ticking it changes no character. Not special-cased
  by id, which is the move this ADR exists to avoid — the honest fixes are for the class control
  to honour it or for the overlay to stop declaring it, and that is a decision left open.

"Not decided here" stands: a `multiple` step carries no maximum.
