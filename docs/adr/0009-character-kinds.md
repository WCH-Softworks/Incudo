# 0009 — A system declares several character kinds, not one

**Status:** Accepted · 2026-09-09

## Context

"Character" is not one thing, even inside a single game. In D&D 5e:

- A **PC** has levels, a class, a background, ability score improvements, equipment, spell
  slots, and a two-page sheet.
- An **NPC / monster** has a challenge rating instead of a level, a stat block instead of a
  sheet, and no build flow worth the name — you pick traits and actions directly.
- A **legendary creature** adds legendary actions, lair actions, and regional effects.
- A **companion / familiar / sidekick** is different again.

The AuroraLegacy corpus already reflects this: `Companion`, `Companion Action`,
`Companion Trait`, `Companion Reaction`, and the 2025 Monster Manual's `creatures.xml`, all
sitting alongside the PC types. Aurora's app only really builds PCs.

Modelling only PCs and bolting on the rest later means the build flow, the sheet layout and the
level model all have PC assumptions welded in — the same trap as hardcoding D&D itself
([ADR 0003](./0003-system-agnostic-content-model.md)), one level down.

## Decision

A `GameSystem` declares **one or more character kinds**. The kind owns everything that differs
per kind:

```jsonc
"characterKinds": [
  {
    "id": "pc",
    "name": "Player Character",
    "default": true,
    "progression": { "kind": "level", "min": 1, "max": 20 },
    "elementTypes": ["Race", "Class", "Background", "Feat", "Spell", ...],
    "buildSteps": [ ... ],
    "sheet": { "sections": [ ... ] }
  },
  {
    "id": "npc",
    "name": "NPC / Monster",
    "progression": { "kind": "rating", "stat": "challenge" },
    "elementTypes": ["Creature", "Trait", "Action", "Reaction"],
    "buildSteps": [ ... ],
    "sheet": { "sections": [ ... ] }
  },
  { "id": "legendary", "extends": "npc", "elementTypes": ["+Legendary Action", "+Lair Action"] }
]
```

`extends` exists so "legendary NPC" is a delta on "NPC" rather than a copy — the same
fork-style overlay mechanic that user systems use
([ADR 0011](./0011-user-systems.md)), applied inside a system.

A character records its kind: `"systemId": "dnd5e", "kind": "npc"`. The engine is unchanged —
it still resolves elements and rules — but the *shape* of a build comes from the kind.

`progression` is generalized deliberately: `level` (5e PCs), `rating` (5e monsters), `none`
(Cairn, and most OSR games), `xp` (systems that buy advances directly). "Level" was the last
big PC assumption sitting in the engine's face.

## Consequences

**Good**
- NPC and legendary-creature support is a data change, not an architecture change.
- The 2025 Monster Manual content in the corpus becomes usable rather than merely importable.
- Level-less systems stop being a special case — `progression.kind: "none"` is just another kind.
- A DM building a whole encounter uses one tool.

**Bad / accepted**
- `GameSystem` gets a level of nesting, and `systems/dnd5e/system.json` grows. Acceptable;
  it is data, and it can be split into files per kind.
- `buildSteps` and `sheet` move from the system onto the kind. This is a **breaking change to
  the system format**, which is cheap now and expensive later — hence doing it before the
  desktop shell exists rather than after.
- Shared stats across kinds (both PCs and monsters have Strength) need to stay declared once at
  system level, with kinds adding their own. Kinds inherit the system's `stats` and may extend
  them.

## Revisit if

A system appears whose kinds differ so much that they are really two systems sharing a name. At
that point the answer is two system definitions, not more machinery here.
