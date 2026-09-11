# Architecture Decision Records

Short documents recording decisions that were expensive to make or would be expensive to reverse.

**Write one when:** picking between technologies, changing a file format, adding a runtime
dependency to `core`/`content`/`aurora-import`, or making a call that a future contributor would
otherwise be tempted to silently undo.

**Don't write one for:** anything a code comment covers.

Format: Context → Decision → Consequences → Alternatives considered. Status is
`Proposed` | `Accepted` | `Superseded by NNNN`. Never edit an accepted ADR's decision — write a
new one that supersedes it.

| # | Title | Status |
|---|---|---|
| [0001](./0001-tech-stack.md) | Tech stack: TypeScript core, Tauri desktop, Expo mobile | Accepted |
| [0002](./0002-monorepo-and-code-reuse.md) | Single monorepo with layered packages | Accepted |
| [0003](./0003-system-agnostic-content-model.md) | Game systems are data, not code | Accepted |
| [0004](./0004-live-vs-downloaded-content.md) | Content sources are composable; live and offline are both first-class | Accepted |
| [0005](./0005-aurora-import.md) | Aurora import is a first-class, day-one feature | Accepted |
| [0006](./0006-derived-character-state.md) | Characters store choices, never derived numbers | Accepted |
| [0007](./0007-native-formats.md) | Incudo's own formats are JSON; images are never inlined | Accepted |
| [0008](./0008-aurora-compatibility-frozen.md) | Aurora compatibility is import-only, and it gets to be finished | Accepted |
| [0009](./0009-character-kinds.md) | A system declares several character kinds, not one | Accepted |
| [0010](./0010-licensing-and-funding.md) | A system ships officially only if its licence permits donation-funded tools | Accepted |
| [0011](./0011-user-systems.md) | Users can fork official systems and author entirely new ones | Accepted |
| [0012](./0012-self-contained-saves.md) | A save is self-contained: it opens with zero content sources | Accepted (amends 0006, 0007) |
| [0013](./0013-project-name.md) | The project is called Incudo | Accepted |
| [0014](./0014-base-stats-are-inputs.md) | Ability scores are inputs, in their own field | Accepted (amends 0006) |
| [0015](./0015-class-levels.md) | A character records which track each point of progression was spent on | Accepted (amends 0006, 0009) |
| [0016](./0016-stat-bounds-are-expressions.md) | A stat's bounds are expressions, and they apply to every stat | Accepted |
| [0017](./0017-open-decisions-not-steps.md) | Building a character is a set of open decisions, not a sequence of steps | Accepted (amends 0009) |
| [0018](./0018-tables-and-track-stats.md) | A stat may be read from a table, and a track may contribute one | Accepted |
| [0019](./0019-recorded-rolls-are-readable.md) | A recorded roll is readable by a derivation | Accepted |
| [0020](./0020-stats-keyed-on-declared-blocks.md) | An element's declared blocks may publish stats | Accepted |
| [0021](./0021-equipped-is-a-condition.md) | `equipped` is a condition, and it is not evaluated yet | Accepted |
| [0022](./0022-kinds-contribute-systems-do-not-ship-content.md) | A character kind may contribute a stat conditionally, and a system ships no content | Accepted |
| [0023](./0023-attunement-gates-and-reports.md) | Attunement gates an item's rules, and every gate explains itself | Accepted |
