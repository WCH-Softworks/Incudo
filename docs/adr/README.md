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
| [0007](./0007-native-formats.md) | HeroForge's own formats are JSON; images are never inlined | Accepted |
| [0008](./0008-aurora-compatibility-frozen.md) | Aurora compatibility is import-only, and it gets to be finished | Accepted |
| [0009](./0009-character-kinds.md) | A system declares several character kinds, not one | Accepted |
| [0010](./0010-licensing-and-funding.md) | A system ships officially only if its licence permits donation-funded tools | Accepted |
| [0011](./0011-user-systems.md) | Users can fork official systems and author entirely new ones | Accepted |
| [0012](./0012-self-contained-saves.md) | A save is self-contained: it opens with zero content sources | Accepted (amends 0006, 0007) |
