# 0011 — Users can fork official systems and author entirely new ones

**Status:** Accepted · 2026-09-09 · **amended by [ADR 0039](./0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md)**

> **Note (ADR 0039):** the `incudo system new` and `incudo system validate` commands named below no
> longer exist. Validation is *Add a system…* in the app, through the same `validateGameSystem`;
> scaffolding belongs in the app's system flow (ROADMAP Phase 7). The contract is unchanged: one
> validator, shared.

## Context

Two forces meet here. [ADR 0010](./0010-licensing-and-funding.md) means the project will ship
official support for relatively few systems. [ADR 0003](./0003-system-agnostic-content-model.md)
means a system is only a data file. So the tool can support far more games than the project can
distribute — provided users can supply the data file themselves.

The requirement, in the owner's words: users should be able to modify official systems
fork-style, and author a system that is not officially implemented — *"not from scratch"*, but
by writing a JSON file, and **if it parses, the app should be able to build in it.**

"Not from scratch" is the important qualifier. Nobody should face an empty file.

## Decision

### Three ways in, in increasing order of effort

1. **Fork an official system.** Copy `systems/dnd5e` into the user's own space and edit it. Full
   freedom, no relationship to upstream, no upstream updates.
2. **Overlay an official system** (the preferred path). A small patch file that names its parent
   and states only the differences:

   ```jsonc
   { "extends": "dnd5e", "id": "dnd5e-homebrew",
     "name": "5e (our table)",
     "stats":  { "add": [{ "name": "sanity", "default": 10 }] },
     "characterKinds": { "patch": { "pc": { "progression": { "max": 30 } } } } }
   ```

   Upstream fixes still flow in. This is the same `extends` mechanic character kinds use.
3. **Author a new system** from a scaffold. `incudo system new <id>` writes a documented, minimal,
   *working* system — the Cairn definition is deliberately small enough to serve as that
   starting point — which the user then grows.

### Validation is the contract

"If it parses, the app can build in it" only holds if parsing means something. So:

- A published **JSON Schema** (`schemas/system.schema.json`) is the definition of the format.
- `incudo system validate <path>` reports errors with line numbers and plain-language messages,
  and it is the same validator the app runs on load.
- Validation is **structural, not semantic**. A system can be valid and still be a bad model of
  its game; that is the user's business. What validation guarantees is that the app will not
  crash and will not silently misread it.
- A system that fails validation is refused with the reasons shown — never partially loaded.

### Where user systems live

Under the user's data directory (`systems/` inside the app's data folder), never inside the
installed application. They survive updates and are listed alongside official systems, clearly
marked as user systems. The app does not upload, index, or share them.

**Official and user systems load through exactly the same code path.** The only difference is
where the file came from and how it is labelled. If official systems ever get a capability user
systems lack, that is a bug.

## Consequences

**Good**
- The tool's reach is not limited by the project's licensing caution.
- The overlay path means a house rule does not fork someone off the update stream — the most
  common reason homebrew tooling goes stale.
- Loading official and user systems identically is the strongest possible test that systems
  really are data ([ADR 0003](./0003-system-agnostic-content-model.md)). It becomes impossible
  to quietly special-case D&D.
- Phase 5's exit criterion — someone who is not the maintainer adds a system without touching
  engine code — is now a supported feature rather than an aspiration.

**Bad / accepted**
- The system format becomes a public API. Breaking it breaks users' work, so it needs
  `formatVersion` and a real migration policy from 1.0 onward. (This is a reason to get the
  character-kinds restructuring done *now*, before anyone depends on it — see ADR 0009.)
- Bug reports will arrive from broken user systems. The validator's error messages are the main
  defence, and they deserve real effort.
- An overlay whose parent changes underneath it can break. Overlays record the parent version
  they were written against and warn on mismatch, the same mechanism as content sources
  ([ADR 0004](./0004-live-vs-downloaded-content.md)).
- Sharing user systems is out of scope for 1.0. People will do it by sending files, which is
  fine. A registry is a post-1.0 idea and carries the licensing questions of ADR 0010.
