# Game systems

Each folder here is a **game system definition**: data describing what element types exist,
what stats exist, how the build flow is shaped, and how the character sheet is laid out.

Nothing in `@heroforge/core` imports these. That is the point — see
[ADR 0003](../docs/adr/0003-system-agnostic-content-model.md).

| folder | what it is |
|---|---|
| `dnd5e/` | D&D 5th edition. The system HeroForge is actually tested against. |
| `cairn/` | A deliberately tiny, classless, level-less system. It exists to break 5e-shaped assumptions in the engine while they are still cheap to fix. |

Official systems must clear the licensing bar in
[docs/LICENSING.md](../docs/LICENSING.md) before they are added here. User-authored systems
live in the app's data directory instead and are not subject to that policy — the project does
not distribute them. They load through exactly the same code path
([ADR 0011](../docs/adr/0011-user-systems.md)).

## Adding a system

1. Copy `cairn/system.json` and edit it.
2. Declare every element type your content uses. Aurora content types are just strings;
   your types can be anything.
3. Declare stats. Anything derived (a modifier, a bonus that scales with level) goes in
   `derive` as an expression — systems are data and do not ship JavaScript.
4. Validate with `npm run hf -- types <your-index>` to confirm every type your content
   uses is declared.

If you find yourself needing engine changes to express your system, that is a bug report
worth filing — the vocabulary is allowed to grow, but only when real content forces it.
