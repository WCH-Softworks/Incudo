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

| folder | what it is |
|---|---|
| `dnd5e/` | D&D 5th edition. The system Incudo is actually tested against. |
| `cairn/` | A deliberately tiny, classless, level-less system. It exists to break 5e-shaped assumptions in the engine while they are still cheap to fix. |

Official systems must clear the licensing bar in
[docs/LICENSING.md](../docs/LICENSING.md) before they are added here. User-authored systems
live in the app's data directory instead and are not subject to that policy — the project does
not distribute them. They load through exactly the same code path
([ADR 0011](../docs/adr/0011-user-systems.md)).

## Adding a system

1. Copy `cairn/system.json` and edit it. It is deliberately small enough to read in one go.
2. Declare every element type your content uses. Aurora content types are just strings;
   your types can be anything.
3. Declare stats. Anything derived (a modifier, a bonus that scales with level) goes in
   `derive` as an expression — systems are data and do not ship JavaScript.
4. Declare at least one character kind. If your game has no levels, that is
   `"progression": { "kind": "none" }` — not a special case, just another progression.
   A second kind that is *mostly* the first one uses `"extends"` and states only its
   differences; see how `legendary` sits on top of `npc` in `dnd5e/`.
5. Validate it:

   ```bash
   npm run incudo -- system validate path/to/system.json
   ```

   This is the same validator the app runs on load, so a system that passes here loads there.
   It checks structure against the schema *and* that every reference resolves — element types
   your kinds name, stats your sheets show, kinds your `extends` points at.
6. Confirm your content matches: `npm run incudo -- types <your-index>` lists every type the
   content actually uses, which should be a subset of what you declared.

If you find yourself needing engine changes to express your system, that is a bug report
worth filing — the vocabulary is allowed to grow, but only when real content forces it.
