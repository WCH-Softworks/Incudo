# 0116 — A text field may stand in with what a character chose, and alignment and deity are picks

**Status:** Accepted · 2026-10-14 · answers the maintainer's report on the Build pane · builds on
[0068](./0068-a-character-may-keep-content-beside-it-as-a-reference-shown-and-embedded-and-never-held.md),
[0092](./0092-a-kind-declares-the-text-a-user-writes-about-a-character-and-every-sheet-shows-it.md) ·
**format:** system format `suggestedBy` on a freeform field (`formatVersion` stays 1); no character format change

## Context

After using the Build pane, the maintainer asked why the Personality fields stay empty when the background's suggested
trait, ideal, bond and flaw have been chosen, and pointed out that there is no alignment anywhere. Measured:

- **Aurora copies the chosen suggestions into the personality text.** The first sample save records its Sage's chosen
  Personality Trait, Ideal, Bond and Flaw as `List` elements and again, word for word, as `background-traits`,
  `background-ideals`, `background-bonds` and `background-flaws`, the freeform keys 5e's fields read (ADR 0092). An
  imported character therefore shows them; a character built in Incudo showed nothing.
- **Alignment and Deity were offered by nothing.** 5e's player character listed both in one "Details" step that was
  neither required, a pick nor a set, which only heads the selects content opens (ADR 0068): none does. Content declares
  9 alignments and 296 deities. Aurora asks for both at level 1: every sample save records an `Alignment` and a `Deity`
  select there, all thirty unanswered.

## Decision

1. **A freeform field may declare `suggestedBy`**, the names of the `select`s whose chosen elements stand in for it
   while nothing is typed: their names, one per line, in the order chosen, only of elements the character holds (a pick
   that stopped counting when the background changed suggests nothing). The editor shows that text in the box and the
   sheet prints it. **Nothing is stored**: the text is read off the choices every time, which keeps ADR 0006 (a
   character stores choices), and typing replaces it. 5e's four personality fields name `Personality Trait`, `Ideal`,
   `Bond` and `Flaw`. `chosenUnderSelect` and `freeformState` (`packages/ui/src/freeform.ts`) are the readers; no select
   name is in code.
2. **Alignment and Deity are two picks that are not required** (`pick: true`, ADR 0068), each skippable, recorded under
   `build/alignment` and `build/deity`. The sheet's Character section already lists both types.

## Consequences

- Clearing a field whose suggestion was shown brings the suggestion back: a blank field means "nothing typed". To write
  nothing at all, the user changes the choice instead.
- An imported character's typed copies win over its choices, as before.
- A test that counted every open single pick as race, class or background now names those three.

## Evidence

- `packages/ui/src/freeform.test.ts`: the stand-in, a pick not held ignored, nothing stored, typed text winning; each
  fails under the change it names.
- `tools/verify/src/alignment-and-personality.test.ts`: on the corpus, a new character is offered 9 alignments and 296
  deities, skippable, and the sheet lists the one taken; a Sage's chosen trait stands in for the written one until text
  is typed.
- Driven in the browser build: a Human Wizard Sage offered Alignment and Deity, Neutral Good taken and listed among the
  character's parts, and the Personality Traits box holding the chosen trait. In the Tauri window on Windows (2026-10-15,
  real mouse and keys): Chaotic Good, two traits and an ideal taken, a bond typed; the Sheet shows all four, and the saved
  file records the alignment and the picks as choices and only the typed bond as text. Not driven on the phone.
- **Open:** a pick that is not required reads "complete" among the character's parts with nothing taken, as every optional
  step does; for Alignment and Deity that reads as if one were chosen.
