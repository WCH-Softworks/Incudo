# Data model

Three things: **content** (elements), **system** (what the elements mean), **character**
(which elements you picked). Types live in `packages/core/src/model.ts`.

## Content

```ts
type ElementId = string;   // "ID_WOTC_PHB_CLASS_ROGUE" or "incudo:cairn:class-knave"

interface Element {
  id: ElementId;
  type: string;            // declared by the GameSystem, not by core
  name: string;
  source: string;
  setters: Record<string, Setter>;
  rules: Rule[];
  supports: string[];
  description?: string;    // HTML
  sheet?: SheetHints;
  multiclass?: MulticlassBlock;
  spellcasting?: SpellcastingBlock[];
  origin: { sourceId: string; fileUrl?: string; format: 'aurora' | 'incudo' };
}
```

`Rule` is a discriminated union on `kind`:

| kind | fields |
|---|---|
| `grant` | `type`, `id`, `level?`, `requirements?`, `spellcasting?`, `prepared?`, `equipped?` |
| `select` | `type`, `name`, `supports?`, `number`, `level?`, `optional?`, `default?`, `requirements?` |
| `stat` | `name`, `value` (number \| string \| StatExpr), `bonus?`, `level?`, `max?`, `requirements?` |
| `supports` | `tag` |

`requirements` is a parsed `RequirementExpr` tree, not a string — parsing happens once at import.

### Why elements are untyped-by-design

There is no `Spell` interface with `level: number; school: string`. A spell's level lives in
`setters.level`. This looks lossy and is deliberate: the moment core knows what a spell is, it
knows what D&D is, and the second game system becomes a rewrite. Systems that want typed access
provide accessors in their own definition; the UI reads through those.

## System

```ts
interface GameSystem {
  id: string;                       // "dnd5e"
  name: string;
  version: string;
  formatVersion: 1;
  licence: LicenceRef;              // see ADR 0010 — required on official systems
  elementTypes: ElementTypeDef[];   // the list Aurora hardcodes
  stats: StatDef[];                 // declared stats, defaults, derivations
  characterKinds: CharacterKindDef[];   // PC, NPC, legendary, companion …
  extends?: string;                 // a user overlay names its parent — ADR 0011
}

interface CharacterKindDef {
  id: string;                       // "pc" | "npc" | "legendary" | …
  name: string;
  default?: boolean;
  extends?: string;                 // "legendary" is a delta on "npc"
  progression: Progression;
  elementTypes: ElementType[];      // which types this kind may use
  stats?: StatDef[];                // added to the system's
  buildSteps: BuildStepDef[];
  sheet: SheetLayoutDef;
}

type Progression =
  | { kind: 'level'; min: number; max: number }   // 5e PCs
  | { kind: 'rating'; stat: StatKey }             // 5e monsters: challenge rating
  | { kind: 'xp'; stat: StatKey }                 // buy advances directly
  | { kind: 'none' };                             // Cairn, most OSR
```

**`buildSteps` and `sheet` belong to the kind, not the system** — a monster stat block and a PC
sheet have nothing in common but the stats underneath. `progression` is generalized for the same
reason: "level" was the last big PC assumption left in the engine's face. See
[ADR 0009](./adr/0009-character-kinds.md).

A system definition is **data** (`systems/<id>/system.json`), not code. That is the constraint
that keeps the engine honest. Where a system genuinely needs computation (5e's proficiency bonus
is `2 + floor((level-1)/4)`), it declares it as a small expression in `StatDef.derive`, evaluated
by core's expression evaluator — not as a JS function.

## Character

```ts
interface Character {
  formatVersion: 1;
  id: string;
  systemId: string;                 // "dnd5e"
  kind: string;                     // "pc" | "npc" | … — ADR 0009
  name: string;
  sources: SourceRef[];             // ALLOWLIST of indexes, at which versions
  progress: number;                 // level, challenge rating, or xp — per the kind
  choices: Choice[];                // the entire build, as element ids
  rolls: Record<string, number>;    // recorded random results — INPUTS, not derivations
  freeform: Record<string, string>; // notes, appearance, backstory
  assets?: Record<string, string>;  // relative paths: { portrait: "assets/vigaro.png" }
  overrides?: Record<string, number | string>;  // manual escape hatch
}

interface Choice {
  ruleKey: string;       // which select this answers, stable across rebuilds
  elementIds: ElementId[];
}
```

**A character stores no derived numbers.** No AC, no HP total, no spell slots. Those come from
running the rules.

Two refinements learned from reading real Aurora saves
([docs/AURORA-SAVE-FORMAT.md](./AURORA-SAVE-FORMAT.md)):

- **`rolls` holds recorded random results.** Aurora's `rndhp="10,10,1,3,…"` is rolled hit points
  per level — the one thing that looks derived but has no formula. Treating it as derived would
  silently reroll everyone's HP on load.
- **`sources` is an allowlist, never a blocklist.** Aurora stores the elements a character has
  *disabled*: 37,235 IDs in one 3.1 MB file. Beyond the size, a blocklist silently *includes*
  everything published after it was written.

Consequences of storing only choices, all intended:

- character files are ~2 KB and diff beautifully in git
- upstream content fixes apply retroactively
- an out-of-date content source is *detectable*: `sources` records the version the character was
  built against, so the app can warn instead of silently changing the character
- `overrides` exists because the alternative is users being stuck when content is wrong

## Derivation

```
Character.choices
      │
      ▼
resolve elements  ──►  collect rules (respecting level + requirements)
      │
      ▼
apply stat rules (bonus buckets, max caps)  ──►  StatBlock
      │
      ▼
evaluate system-declared derived stats       ──►  DerivedCharacter
      │
      ▼
report pending selects (what the user still has to choose)
```

`DerivedCharacter` is what every UI renders. It carries `pendingChoices` and `problems`
(unresolved IDs, unmet requirements, over-selection) so the builder UI is a view over the engine's
own diagnostics rather than a second implementation of the rules.

## File formats

| extension | what |
|---|---|
| `.incu` | a character. JSON, `formatVersion` first, safe to commit to git |
| `.incuset` | a compiled content bundle (an imported index, normalized) |
| `system.json` | a game system definition |


**A `.incu` save is a zip container, and it is self-contained** — it opens on a fresh
install with zero content sources configured ([ADR 0012](./adr/0012-self-contained-saves.md)):

```
character.incu   (a zip; the same tree can also live unpacked as a folder)
├── manifest.json     formatVersion, systemId, kind, integrity
├── character.json    choices, rolls, progress, freeform, overrides, source refs
├── content.json      the element subset this character references (~60–200 elements)
└── assets/portrait.png
```

The system definition is *not* embedded — that comes from the app. Everything else the character
needs to be opened, viewed and played does travel with it. Sources are recorded for provenance
and for an opt-in "content has been updated, refresh?" flow, not as a load-time dependency.

Inside the container everything is JSON with `formatVersion` first, and images are real bytes —
never base64. See [ADR 0007](./adr/0007-native-formats.md), which is largely a list of things
Aurora's save format taught us not to do.

JSON Schemas for all three live in `schemas/`. They are not documentation: the system schema is
the contract that makes "if it parses, the app can build in it" mean something
([ADR 0011](./adr/0011-user-systems.md)).
