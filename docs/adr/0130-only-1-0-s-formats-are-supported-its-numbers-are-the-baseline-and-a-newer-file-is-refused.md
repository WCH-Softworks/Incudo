# 0130 — Only 1.0's formats are supported, its numbers are the baseline, and a file a newer Incudo wrote is refused

**Status:** Accepted · 2026-10-28 · records the maintainer's decision of 2026-10-15 (the 1.0 readiness review) and
their answer of 2026-10-28 (decision 6) · answers ROADMAP Phase 9's "stable formats with a real versioning and
migration policy" · amends [0011](./0011-user-systems.md) (the system format's "real migration policy from 1.0 onward")
and [0012](./0012-self-contained-saves.md) (the `.incu` format) · waits on and follows
[0119](./0119-aurora-content-is-converted-into-incudo-content-and-nothing-past-the-conversion-knows-aurora.md), which
changed the content, system and character formats first · **format:** no number moves; every reader refuses a number
above its own

## Context

Incudo has five formats a user holds a file of, and each carries a `formatVersion`:

| format | file | number at 1.0 | how it has moved |
|---|---|---|---|
| character | a `.incu`'s `character.json` (ADR 0012) | **14** | 1 to 14, one step per field an older reader would get wrong (ADR 0024 onward) |
| container | a `.incu`'s `manifest.json` (ADR 0012) | 1 | never |
| content | a converted source, a homebrew source, a save's `content.json` (ADR 0119) | 1 | new with ADR 0119 |
| system definition | `system.json`, shipped or a user's (ADR 0011) | 1 | never, through many optional additions |
| feature library | `incudo-features.json` beside the characters (ADR 0106) | 1 | never |

A form map (`schemas/form-map.schema.json`) carries a number too, but only Incudo ships one: it is not a user's file.

ADR 0011 promised the system format "a real migration policy from 1.0 onward", and none was ever written. Two rules were
followed all the same, and both are worth stating because they are the policy:

- **The character number moves exactly when a reader of the previous number would get a file of the new shape wrong
  without a word**: drop a field (`customFeatures` at 4, `play` at 8), read it as something else (a custom feature's
  `type` at 6), or re-collect content without what it names (`inventory` at 2). A field a reader may ignore without
  changing what the file means did not move it (`prepared`, `publications`), and the schema's description says so. A
  writer raises the number only for a character that needs it (`raiseFormatVersion`), so most characters are still
  written at 2, and the validator refuses each field below the number that introduced it.
- **The system format has stayed 1** because every addition was optional and its description says what a reader that
  does not know the key does ("offers the step as before, so it does not change formatVersion"). That is the same rule.

Measured on this branch before deciding: **no reader checked for a number above its own.** `readCharacterContainer`
read neither the manifest's number nor the character's, so a character written by a later Incudo at 15 would open,
derive with what this version understands, and lose the rest on the next Save, over the newer file. The content
checker said "only 1 can be read"; a system definition at 2 failed on a schema `const`; a feature library at 2 failed
the same way. None of them said the one thing the user can act on: a newer Incudo wrote this.

## Decision

1. **Only 1.0's formats are supported** (the maintainer, 2026-10-15). The baseline is the table above: character 14,
   container 1, content 1, system definition 1, feature library 1. `FORMAT_VERSIONS` in
   `packages/core/src/format-versions.ts` is where the readers' numbers live, and `tools/verify/src/format-versions.test.ts`
   holds every schema to it.

2. **The numbers are kept, not reset to 1** (the maintainer). Character format 14 is 1.0's, and the next character
   change after 1.0 is 15. Resetting would give two meanings to every number below 14.

3. **A file from the betas opens if it opens** (the maintainer). Nothing converts a beta's file into 1.0's shape. The
   character readers still accept every number from 1 to 14, because the schema does and the validator's per-field
   checks are what they were, but a beta file whose shape ADR 0119 changed (a negated filter embedded as a literal tag, a
   multiclass element recorded as a choice) is read as it is, and whatever that gives is what it gives.

4. **Converting an older format is after 1.0, and only for a breaking change** (the maintainer). A change that does not
   break an older file (decision 5's first case) needs no conversion: the newer reader reads the older file as it is. A
   change that does (an older file's field means something else, or is gone) ships with the conversion of the older
   number, so a user's 1.0 file opens in the version that changed it. No conversion is written for anything before 1.0.

5. **When a number moves.** For every format, after 1.0, the rule the character format has followed since ADR 0024:
   - **It does not move** for an addition that a reader of the current number may ignore without getting the file
     wrong: an optional key whose absence means what the file meant before. The schema's description says what such a
     reader does, as the system format's descriptions do now.
   - **It moves** when a reader of the current number would get a file of the new shape wrong without a word: drop it,
     read it as something else, or derive something different. Moving it means: the schema's `enum` or `const`, the
     number in `FORMAT_VERSIONS`, a writer that writes the new number only for files that need it (the character format's
     `raiseFormatVersion`; a person or the converter writes a definition's or a source's), the validator refusing the new
     shape below the new number, and a dated note in this ADR's table.
   - **A breaking change** is one that also changes what an existing file of the current number means. It moves the
     number and brings decision 4's conversion with it.

6. **A file a newer Incudo wrote is refused, naming why** (the maintainer, 2026-10-28, asked while writing this: refuse,
   open read-only, or open as before). Each reader compares the file's number with its own and, when the file's is
   higher, refuses it with one sentence, `newerFormatNote`: "This character was written by a newer version of Incudo
   (format 15; this version reads up to 14). Update Incudo to open it." Refused, not opened, because opening it would show
   a character missing what this version cannot read and a Save would write that loss back over the user's file. The
   readers: `readCharacterContainer` (the manifest and the character, so the library card and an Open say it),
   `checkContentBundle` (a source, a homebrew body, a save's content), `validateGameSystem` (a user's system on the
   launcher), `readFeatureLibrary` (the library is then unreadable, and so never written over, as ADR 0106 already does
   for a broken one). A number that is not a whole number above the reader's is not this case and fails as it did.
   Driven in the Tauri window on Windows (a scratch profile and library): a `.incu` claiming character format 15 is
   listed as "will not open", its one problem that sentence, beside one written today that opens; Open leaves the file
   as it was.

7. **What is not a format number.** A system's `version` is its author's and tells a reader nothing. `CONVERTER_VERSION`
   says which converter wrote a converted source; a newer converter converts the source again (ADR 0119 decision 10),
   so it never refuses one. A content source's `version` is upstream's. None of them follows this policy.

## Consequences

**Good**
- A user's file is never quietly made smaller by an older Incudo: the worst an older version does is say it cannot open
  it, and why.
- The rule for a bump is the one the character format already followed, written down, so 1.0 freezes a practice and
  not a guess.
- The baseline is held by a test, so a number that moves without its schema, or a schema without its number, fails.

**Bad / accepted**
- Beta files are not converted: a beta character may open differently in 1.0, or not at all.
- A user who opens a newer file on an older Incudo is told to update, with no way to see the character there. Opening
  it read-only was the alternative, and the maintainer chose refusal.
- After 1.0 a breaking change costs a converter for the number it replaces. That is the point: it makes such a change
  expensive enough to be designed rather than fallen into.

## The numbers since 1.0

| date | format | from | to | why |
|---|---|---|---|---|
| — | — | — | — | (1.0's baseline: character 14, every other format 1) |
