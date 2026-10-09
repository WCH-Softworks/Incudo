# Game systems

Each folder here is a **game system definition**: data describing what element types exist,
what stats exist, and what **kinds of character** the system can build — a PC, an NPC, a
legendary creature — each kind owning its own build flow, sheet and progression
([ADR 0009](../docs/adr/0009-character-kinds.md)).

Nothing in `@incudo/core` imports these. That is the point — see
[ADR 0003](../docs/adr/0003-system-agnostic-content-model.md).

The shape is defined by [`schemas/system.schema.json`](../schemas/system.schema.json), and that
schema is a contract rather than documentation: *if it validates, the app can build in it*
([ADR 0011](../docs/adr/0011-user-systems.md)).

| folder | what it is | why it is here |
|---|---|---|
| `dnd5e/` | D&D 5th edition. | The first definition and the one Incudo is actually tested against — the corpus, a set of real saves and every `aurora verify` number are 5e. |
| `cairn/` | A small, classless, level-less game by Yochai Gal. | It exists to break 5e-shaped assumptions in the engine while they are still cheap to fix. A structural sketch, not a licensed implementation — replace the content before shipping it. |

**A definition's own `description` is not the place for any of the column on the right.** The
launcher shows it on a card to someone choosing a game, so it is prose for a player: what the
game is, who publishes it, what it feels like. It used to read "the first system definition, and
the one Incudo is tested against… see docs/adr/0003", which is true, useful to a maintainer, and
exactly the wrong sentence in front of a user. Notes for maintainers go here.

A definition may also carry a `logo`, which is a **reference** and never inline bytes
([ADR 0007](../docs/adr/0007-native-formats.md)) — an `https:` URL or a path beside the
definition. Neither shipped system has one, and the app draws no substitute for a missing one:
it generates no artwork, not even a placeholder.

Official systems must clear the licensing bar in
[docs/LICENSING.md](../docs/LICENSING.md) before they are added here. User-authored systems
live in the app's data directory instead and are not subject to that policy — the project does
not distribute them. They load through exactly the same code path
([ADR 0011](../docs/adr/0011-user-systems.md)).

## Starting a system of your own

**New system…** on the app's launcher writes the file for you: give it a name and choose where to start
([ADR 0104](../docs/adr/0104-a-new-system-starts-from-a-file-the-app-writes-and-a-copy-keeps-what-it-was-copied-from.md)).

- **A small starter system**: Incudo's own, with two element types, three scores entered by hand, a level, a derived
  Health and a sheet. It builds a character with no content; rename and grow it into your game.
- **Changes to** a shipped system: an overlay (below) that changes nothing yet.
- **A copy of** a shipped system: the whole definition under your id, with `"copiedFrom"` naming the original. A copy
  loads the original's content sources and is offered what ships beside it (5e's starting equipment and official form),
  and later fixes to the original do not reach it.

The app asks where to save the `.json`, then adds it. To change the system, edit that file and add it again with
**Add a system…**, which replaces it by its id.

## Changing a shipped system: an overlay

To change a few rules of a system that ships here and keep receiving its fixes, write an **overlay**
([ADR 0102](../docs/adr/0102-an-overlay-is-a-patch-applied-to-its-parent-on-every-load-and-validated-as-the-system-it-makes.md)):
your own `id`, `name`, `version`, `"extends": "dnd5e"`, and only what differs.

```json
{ "formatVersion": 1, "id": "dnd5e-house", "name": "5e (our table)", "version": "1.0.0", "extends": "dnd5e",
  "stats": [{ "name": "sanity", "label": "Sanity", "default": 10 }],
  "characterKinds": [{ "id": "pc", "progression": { "max": 30 } }] }
```

An object merges with the parent's; an entry with an identity (a stat's `name`, a kind's or step's `id`) merges with
the parent's entry of that identity, or is added; `"remove": true` on such an entry removes it and `null` removes a
field; anything else replaces the parent's. The app applies it to the parent every time it starts and checks the result
as a whole system, then loads it with **Add a system…**, like any other. Its card says what it changes.

## Adding a system

1. Start from **New system…**'s starter (above), or copy `cairn/system.json` and edit it. Both are small enough to
   read in one go.
2. Declare every element type your content uses. Aurora content types are just strings;
   your types can be anything.
3. Declare stats. Anything derived (a modifier, a bonus that scales with level) goes in
   `derive` as an expression — systems are data and do not ship JavaScript.
4. Declare at least one character kind. If your game has no levels, that is
   `"progression": { "kind": "none" }` — not a special case, just another progression.
   A second kind that is *mostly* the first one uses `"extends"` and states only its
   differences; see how `legendary` sits on top of `npc` in `dnd5e/`.
5. Validate it: choose **Add a system…** in the app and pick your `system.json`. It runs the same
   validator the shipped systems go through, so a system the app accepts is one it can build in.
   The validator checks structure against the schema *and* that every reference resolves —
   element types your kinds name, stats your sheets show, kinds your `extends` points at — and
   says where each problem is: the line and column in your file, and the path with your own ids
   (`characterKinds "hero" › buildSteps "talents" › label: is required`). For a definition kept in this repository,
   `tools/verify/src/schemas.test.ts` validates every `systems/*/system.json` on `npm test`.
6. Confirm your content matches: every element type your content uses should be one you
   declared. The app lists what a source contributes in its Sources view.

If you find yourself needing engine changes to express your system, that is a bug report
worth filing — the vocabulary is allowed to grow, but only when real content forces it.
