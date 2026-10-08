# 0103 — A system error says where in the file, by line and by the ids written there

**Status:** Accepted · 2026-10-08 · answers ROADMAP Phase 7's "Validation errors that a non-programmer can act on" · amends
[0011](./0011-user-systems.md) (line numbers, which it promised) · builds on
[0039](./0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md),
[0102](./0102-an-overlay-is-a-patch-applied-to-its-parent-on-every-load-and-validated-as-the-system-it-makes.md) ·
**format:** none (the schema's contract is unchanged; three definitions it accepted are now refused, see 3)

## Context

ADR 0011 says the validator's messages "deserve real effort", and that `incudo system validate` reports "errors with line
numbers and plain-language messages". The command went with the CLI (ADR 0039); *Add a system…* runs the same
`validateGameSystem`, and since ADR 0102 an overlay's errors are reported on the system it makes, not on the file.

### Measured first

Thirty-three mistakes an author makes, applied to the shipped Cairn and 5e definitions, and six JSON syntax slips:

- **The words are mostly good.** "`nmae` is not a known field — did you mean `name`?", "`step "background"` requires
  `"nothing"`, which this kind has no step for", "names `"Spel"`, which the system's elementTypes does not declare". The
  field names in them are the ones the author typed, which is what they search the file for.
- **The location is a position.** `characterKinds[0].buildSteps[2].types`: nobody counts entries in a 1,200-line file. The
  141 reference checks in `schema.ts` stop at the container (`characterKinds[0].buildSteps`) and name the entry in the
  message, because many check a kind's *resolved* sheet and steps, inherited ones included, which are not in its own text.
- **No line or column**, anywhere. For an overlay (ADR 0102) the position is the applied system's, not the file's.
- **Syntax errors are V8's.** A trailing comma reads "Expected double-quoted property name in JSON at position 10 (line 1
  column 11)"; a comment or a single quote reads as something else. They carry a line only because V8 adds one; Hermes
  words them differently.
- **Three ambiguities validate.** A stat declared twice (resolution keeps the last, silently: `stats.set(name.toLowerCase())`),
  an element type declared twice, and a generation method whose `min` is above its `max`, which no value can satisfy. Of the
  fifteen arrays ADR 0102 merges by identity, nine have a duplicate check and six do not: `elementTypes`, `stats`, a kind's
  `stats`, `generationMethods`, `sheet.sections`, `companions.stats` and `suggestedSources`. The overlay merge makes a
  duplicate worse than ambiguous: a patch to it reaches only the first.
- **They are cut short on screen.** The desktop shows 8 errors on an add and 5 per definition that failed to load. A failed
  definition's card says Incudo "will not load part of it", when it loads none of it (ADR 0011).

Three things do not need to change: the messages' wording, the paths `SchemaError` carries, and where the 141 checks
point, which is honest about inheritance.

## Decision

### 1. An error is shown with where it is: the line, and the path with ids in place of positions

`describeSystemErrors(errors, text, overlay?)` (`packages/ui`) turns each `SchemaError` into a `SystemProblem`:
`{ where, line?, column?, message, fromParent? }`.

- **`where`** is the path with each position in an identified array (ADR 0102's table) replaced by the entry's identity as
  the file writes it, under the field's name: `characterKinds "adventurer" › buildSteps "abilities" › budget › stat`.
  An unidentified array keeps its number, counted from 1 (`contributions #3`). Field names stay field names: the author
  searches for them. Nothing else is reworded.
- **`line` and `column`** are where that value starts in the text, or for a field that is missing, where the object that
  should hold it starts. A path the text does not reach (a kind's inherited section) is given the nearest ancestor it
  does reach.

The text is read by a JSON reader of core's own that records where each value starts (`readJsonText`), and that is used
only to locate: the value it reads is held to `JSON.parse` by a test over every JSON file in `systems/` and `schemas/`.

### 2. A syntax error says what is wrong, at a line and column, in words

The same reader refuses broken JSON with a line, a column and a sentence for the slips people make: a comma before `}`
or `]`, a comment, a single-quoted string, a missing comma between two entries, a bracket never closed, an empty file.
Anything else is "this is not valid JSON here". The store reads files with it, so the desktop and, later, the phone say
the same thing.

### 3. Three ambiguities are refused

- **An identity twice in any identified array** is refused, once, with a sentence naming the identity, through one check
  driven by ADR 0102's table (case ignored for stat names, which resolution lowercases). The nine existing checks keep
  their words; the new one covers the six that had none. A guard test duplicates an entry of each table path and holds the
  result to exactly one error.
- **A generation method whose `min` is above its `max`** is refused.

Both shipped systems validate unchanged. These are refusals of definitions the format used to accept, so a user's file
could stop loading; each was ambiguous or unsatisfiable, and the failure names the line.

### 4. In an overlay, an error points at the overlay's own line, or says it is in the parent's part

An error in the applied system (ADR 0102) is followed back to the overlay's text by identity: an identified entry the
overlay writes, a field it writes, an array it replaces. It gets the overlay's line. An error in a part the overlay does not
write (the parent's own sheet section naming a stat the overlay removed) has no line in the file; it says so:
`fromParent` is the parent's name, and the view reads "in Dungeons & Dragons 5th Edition's part, which something this file
changes or removes breaks".

### 5. Every error is shown

The add result and a failed definition's card list every error, the first five open and the rest folded. The card says
Incudo will not load the definition, not "part of it".

## Consequences

**Good**
- An author can go to a line. A non-programmer can find `"abilities"` in their file; they could not count to the third step.
- The phone, when it gets user systems, gets the same words and lines for free: none of this is in a shell.
- A patch can no longer quietly reach only the first of two entries with one name.

**Bad / accepted**
- **The 141 reference checks still point at the container** when the entry they name may be inherited. The line is the
  container's; the message names the entry.
- **A second JSON reader**, for positions. `JSON.parse` remains what reads a value everywhere else; the test holds the two
  to the same values.
- **Three refusals of files that used to load.** No shipped or sample file is affected; a user's could be.
