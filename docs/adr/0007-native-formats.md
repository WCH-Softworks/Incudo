# 0007 — HeroForge's own formats are JSON, and images are never inlined

**Status:** Accepted · 2026-09-09 · **amended by [ADR 0012](./0012-self-contained-saves.md)**

> **Amendment.** `.heroforge` is now a zip container that embeds the content a character uses,
> and `.hfpack` is dropped — a separate "shareable" format has nothing left to do once every
> save is self-contained. The JSON-not-XML decision and the no-inline-images rule below are
> unchanged, and assets now live as real bytes inside the container.

## Context

HeroForge reads Aurora's XML, but it is not keeping it. Aurora is discontinued
([ADR 0008](./0008-aurora-compatibility-frozen.md)), so its format is an import target, not a
foundation. HeroForge needs its own character format, content format and system format.

XML is a reasonable standard and the owner has no objection to it. But the stack is TypeScript
end to end, where JSON is the native literal: `JSON.parse` is built in, correct, and fast, while
XML needs a parser this project would have to own (it already owns one, reluctantly, for the
importer). JSON is also smaller for the same data and diffs better in git.

Aurora's saves are also a catalogue of what to avoid — see
[docs/AURORA-SAVE-FORMAT.md](../AURORA-SAVE-FORMAT.md). A 3.1 MB save recording 57 decisions,
with 5 MB portraits inline as base64 and a 37,000-entry exclusion list.

## Decision

**Everything HeroForge writes is JSON.**

| file | contents |
|---|---|
| `<name>.heroforge` | a character. JSON. |
| `<name>.hfcontent` | a compiled content bundle (an imported index, normalized). JSON. |
| `system.json` | a game system definition. JSON. |

Every one carries `formatVersion` as its first field.

**Images are never inlined.** A character references assets by relative path:

```json
"assets": { "portrait": "assets/vigaro-portrait.png" }
```

A bare `.heroforge` file is text and stays small. When one portable file is wanted — sending a
character to a DM — that is `.hfpack`, a zip with the JSON, the assets, and optionally the
subset of content elements the character uses. Zip because it is a boring, universal container
that keeps images as bytes rather than as 33%-inflated text.

**Nothing derived is stored.** No `<sum>`, no `<magic>`, no denormalized display cache. The one
refinement to [ADR 0006](./0006-derived-character-state.md): **recorded random results are
inputs, not derivations.** Aurora's `rndhp` is the discovery that forced this — a die roll has
no formula, so it must be stored:

```json
"rolls": { "hp:level:2": 7, "hp:level:3": 4 }
```

**Sources are an allowlist.** The handful a character uses, with versions — never Aurora's
exclusion list.

## Consequences

**Good**
- No parser dependency for the project's own formats; `JSON.parse` is the whole reader.
- A character file is a couple of KB and reviewable in a diff.
- Assets stay bytes. A 5 MB PNG is 5 MB, not 6.7 MB of text inside a document you have to parse
  before you can show a name.
- `.hfpack` gives portability without making every save pay for it.

**Bad / accepted**
- Two artefacts to manage instead of one, and the app must handle a missing asset gracefully
  (show a placeholder, keep the reference, do not lose it).
- JSON has no comments and no schema in-band. Mitigated with JSON Schema files under
  `schemas/`, which are needed anyway for user-authored systems
  ([ADR 0011](./0011-user-systems.md)).
- Hand-authoring content in JSON is more tedious than XML. Accepted: Phase 6 ships an editor,
  and the importer means nobody has to hand-author to get started.

## Alternatives considered

- **Keep XML for symmetry with Aurora.** Rejected: symmetry with a discontinued app is not a
  benefit, and it would mean owning an XML writer as well as the reader.
- **SQLite for characters.** Real advantages for a library of hundreds. Rejected for 1.0: it
  ends "a character is a file you can email, diff, and put in git", which is worth more.
- **Inline base64, like Aurora.** Rejected on the evidence above.
