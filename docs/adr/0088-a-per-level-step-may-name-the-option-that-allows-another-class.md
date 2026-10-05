# 0088 — A per-level step may name the option that allows another class, and a character holding two classes without it is flagged

**Status:** Accepted · 2026-10-05 · amends [0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md)
(decision 4: the campaign option is now a gate) · builds on [0032](./0032-a-build-step-may-offer-a-set.md),
[0044](./0044-hit-points-follow-the-method-the-character-uses.md), [0045](./0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md),
[0080](./0080-a-set-step-may-name-what-a-new-character-starts-with.md) · **format:** system, one optional field on a
build step (`formatVersion` stays 1); character, none

## Context

5e's campaign options step (ADR 0032) offers the overlay's `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING`, named "Multiclassing",
and since ADR 0080 a new character starts with it ticked. Nothing reads it: 0 of the corpus's 740 files reference it, and
ADR 0036 decision 4 deliberately left the class control ungated on it, for two reasons — content never reads it, and campaign
options could not yet be switched on, so a gate would have made multiclassing unreachable for every character built here.
The second reason is gone (ADR 0032, then ADR 0080 switches it on by default). The first is still true and still the point:
the gate cannot come from content, because content says nothing. Unticked, Build still adds a second class, which makes
the tick box a lie.

### Measured first

Over the thirty sample saves, imported against AuroraLegacy/elements (the commit `npm run corpus:sync` printed on the day;
`tools/verify/src/multiclass-option.test.ts` prints it beside these):

- **9 of 30 record the option**, all under `build/options`, the key the importer gives every `Option`.
- **All 8 multiclass samples are among the 9.** The other 21 are single-class with the option off, and one single-class
  sample has it on.
- So **Aurora never wrote a multiclass character without the option** in this set, and a gate on it changes nothing an
  import of these saves can show except that the 21 are no longer offered a second class — which is what Aurora's own
  screen does with the option off.

## Decision

1. **A per-level build step may declare `multiclassWhen`**, an element id: while the character does not hold it, a level
   may not be spent on a class the character has no level in. The same shape and reading as `levelRoll.fixedWhen` (ADR 0044
   decision 6): an id the system definition names, "held" meaning the derivation holds it, and no game noun in core or in
   `packages/ui`. Not read from content, which never mentions it; not a requirement expression, because one id is all 5e
   needs and `fixedWhen` already set the shape. The validator refuses it on a step that is not `perLevel` with a
   `levelRoll`, the only step a class control is drawn from (ADR 0036 decision 3). 5e's `levels` step declares
   `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING`. A step without it is ungated, as every step was.

2. **While the option is off, a class the character has no level in is unavailable**, with its own reason
   (`ClassOption.unavailable: 'multiclassing-off'`), ahead of every other: no prerequisite, flag or exclusion is worked out
   for it, because none of them can make it available. A class the character already has stays available: another level in
   it is not a multiclass. `ClassLevelState.allowedBy` names the option while it is off and is absent otherwise, so a screen
   can say once, in the option's own name, why nothing else can be added, instead of listing every class as unavailable
   for the same reason: the shared wording (`build-view.ts`) leaves those classes out of the "Not available" group and says
   one sentence. `setLevelClass`, `addLevel` and `applySplit` refuse what the state refuses, as they already did.

3. **A character that already holds two classes with the option off is flagged, never changed.** Its levels, records,
   rolls and everything derived from them stay exactly as they were: the option is not read by content, so the derivation
   does not move, and nothing prunes the second class. The class control says that multiclassing is off and this character
   has levels in more than one class, and that it can be switched back on or the levels moved to one class. It may still
   move a level between the classes it holds, and apply a split made only of them: those are not a new class. Destroying the
   second class because a box was unticked would be ADR 0006's input thrown away on a presentation toggle, and the user may
   have unticked it by mistake.

4. **A character that records no options reads as off** (ADR 0080: no answer means none). That covers every Aurora import
   whose save did not record the option — 21 of the samples, all single-class, which Aurora would not have let multiclass
   either — and every character Incudo wrote before ADR 0080 gave a new character the option. Such a character that is
   multiclass is flagged by decision 3, not changed; one that is not is offered no second class until the option is ticked.
   Reading an absent answer as "on" would be ADR 0080's rejected alternative under another name.

5. **Only the class control reads it.** No `Problem` in the derivation and nothing on the Sheet: the engine does not know
   the option, and a flag that a campaign option disagrees with a character's classes is a build-time matter, shown where
   the classes are chosen. A phone and the desktop show it from the same state and wording.

## Consequences

**Good**
- The tick box does what it says, in both apps, from one field in `systems/dnd5e/system.json`.
- No sample import moves: every multiclass sample holds the option, held by an assertion that runs against any corpus.

**Bad / accepted**
- A character built in Incudo before ADR 0080 that never ticked the option is now offered no second class until it is
  ticked, and if it is multiclass it shows a flag. That is what it recorded.
- `applySplit` on a character with the option off accepts only classes it already holds, so a split cannot be used to add
  one while it is off. Intended, and the reason is on screen.

## Alternatives considered

**Stop calling it an option** (drop it from the overlay or from the step's offer). The roadmap's other reading. It would
hide a switch Aurora's saves record (9 of 30 samples) and Aurora's own screen honours, and leave a table that plays without
multiclassing with no way to say so.

**Gate in content**: add a requirement on every class's multiclass block. The overlay supplies elements and never edits
content's, and the importer is frozen (ADR 0008); a rule written into an element is frozen into every save (ADR 0022).

**Remove the second class when the option goes off.** Data loss on a toggle; refused above.

## Evidence

`packages/ui/src/multiclass.test.ts` (off: an untaken class is `multiclassing-off`, a taken one stays eligible, the state
names the option; on, or no `multiclassWhen`: as before), `packages/ui/src/use-character-builder.test.ts` (`addLevel`,
`setLevelClass` and `applySplit` refuse a new class while off and accept the held ones; unticking on a multiclass character
changes nothing derived), `packages/ui/src/build-view.test.ts` (the grouping and the sentences),
`tools/verify/src/schemas.test.ts` (the validator's refusal) and `tools/verify/src/multiclass-option.test.ts` (the samples,
and a new 5e character through the builder with the option unticked). Each fails under its named perturbation.
