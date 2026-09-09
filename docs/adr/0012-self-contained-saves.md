# 0012 — A save is self-contained: it opens with zero content sources

**Status:** Accepted · 2026-09-09
**Amends:** [ADR 0006](./0006-derived-character-state.md), [ADR 0007](./0007-native-formats.md)

## Context

[ADR 0006](./0006-derived-character-state.md) decided a character stores only its choices, and
listed the cost honestly: *"A character cannot be opened without its content sources. This is the
significant cost."* That cost has now been weighed and rejected.

The owner's requirement: *a save file generated in an app that has 200 books of sources should be
openable in a fresh app with zero sources.* The save file is the main product of the application.
A character you cannot open is not a saved character.

The system definition is explicitly **not** part of this — that comes from the app. The save
carries character data and the content it depends on, not the rules-structure metadata.

## Decision

**A `.incu` save embeds the content its character actually uses.**

A save is a **zip container** with a defined layout:

```
character.incu   (a zip)
├── manifest.json     formatVersion, systemId, kind, integrity, created/updated
├── character.json    choices, rolls, progress, freeform, overrides, source refs
├── content.json      the resolved element subset this character references
└── assets/
    └── portrait.png  real bytes, no base64
```

Zip rather than a hand-rolled binary container with offset headers: it is a boring, universal
format with a reader in every language and on every platform, it compresses the JSON (embedded
content is repetitive HTML — roughly 10:1), it stores PNGs as bytes, and it is inspectable by
renaming the file. Inventing a container format here would be work with no payoff.

**Both representations, one layout.** The app can also read and write the same tree *unpacked* as
a folder, for people who want their characters in git or edited by hand. Same file names, same
schemas; zip is the default because one file is what people email.

**What gets embedded.** Only the transitive closure of elements the character references —
chosen, granted, and referenced by their requirements. Typically 60–200 elements out of the
12,000 in a full corpus. Not the whole source, and not the sources the character does not touch.

**Sources are still recorded**, with versions, in `character.json`. They are now provenance and
an update path rather than a load-time dependency.

## Consequences

**Good**
- A save always opens. On a fresh install, on a phone, in five years, with no network and no
  content configured. This is the property that makes the file a real artefact.
- Sharing a character with a DM or a player just works — no "install these 14 sources first".
- Homebrew content a character depends on cannot go missing when a URL dies.
- Assets are bytes inside the container, so there is no second file to lose and no base64 tax.

**Bad / accepted**
- **Upstream content fixes no longer apply automatically.** This was a stated benefit of ADR
  0006 and it is genuinely lost. Replaced with an explicit action: when sources *are* available,
  the app compares recorded versions and offers *"Xanathar's has been updated since you built
  this — refresh?"*, showing what would change. Opt-in beats silent, and silent was always a bit
  frightening anyway.
- Saves grow from ~2 KB to roughly 50–300 KB compressed. Still trivial, and two orders of
  magnitude below Aurora's 3–8 MB.
- A save is no longer a text file you can diff in git at a glance. Mitigated by the unpacked
  folder form, which is exactly that.
- Levelling up or adding new options still needs sources for content the character does not yet
  have. Embedding covers *opening, viewing and playing* a character anywhere; it does not turn a
  save into a content library, and should not.
- Duplication across saves: ten characters from the same books each embed their own overlapping
  subset. Accepted — disks are large, and shared-cache-with-fallback would reintroduce exactly
  the dependency this ADR removes.

## Licensing note

An embedded save contains rulebook-derived content. For the user's own file on their own machine
this is unremarkable — they already have that content. Sharing a save shares that content, which
is the user's responsibility and no different from sending someone a filled-in character sheet.
Incudo does not host, index, or transmit saves. See [ADR 0010](./0010-licensing-and-funding.md)
and `docs/LICENSING.md`.

## What this replaces

`.incupack` from ADR 0007 is **dropped**. It existed to make a shareable, self-contained character
an export option; that is now simply what a save is, so a second format has nothing left to do.
