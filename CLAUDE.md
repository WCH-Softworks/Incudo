# Incudo — working notes for Claude Code

A system-agnostic tabletop character builder for desktop and mobile. Free, MIT, open source.
A replacement for the discontinued Aurora Builder that reads its entire content ecosystem.

**Read first:** `ROADMAP.md`, then `docs/ARCHITECTURE.md`, then the ADR whose number a task
cites. `docs/adr/README.md` is the index. The ADRs record *trade-offs*, not just choices —
when something here looks odd, the ADR usually says why.

## Commands

```bash
npm install            # ~8s. If it starts pulling Expo, apps/* got added to workspaces — don't.
npm run typecheck      # tsc --build --force
npm test               # node --test, no build step
npm run incudo -- --help   # the CLI: validate | types | inspect
npm run incudo -- validate <index-url-or-local-path> [--strict] [--json]
```

The real regression suite is the CLI against the full Aurora corpus. A complete Aurora install
already exists on this machine and works **entirely offline**:

```bash
npm run incudo -- validate \
  "C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index" --aurora-folder
# 740 files, 12,058 elements, 0 errors, 57 unresolved, ~10s
```

`--aurora-folder` resolves files the way Aurora's downloader stores them (a folder per index,
files by `name`); `--local [--root DIR]` resolves them by repository path, for a git checkout.
They are different layouts — see docs/AURORA-FORMAT.md. Do not use one for the other.
Eight real Aurora saves sit beside it as `*.dnd5e`. They stay **local and out of the repo**:
read them for verification, never commit them or their contents.

## Hard constraints

**No TypeScript syntax Node cannot strip.** No parameter properties
(`constructor(private readonly x: T)`), no `enum`, no `namespace`, no decorators. Write the
field and assign it. This is why tests and the CLI run with zero build step — do not trade it
away. Relative imports use the `.ts` extension; `tsc` rewrites them on emit.

**Layering** (`docs/CODE-REUSE-POLICY.md`) — enforced, not aspirational:

| layer | may import | must never import |
|---|---|---|
| `packages/core` | stdlib only | anything platform-shaped |
| `packages/aurora-import`, `packages/content` | `core` | `fs`, `fetch`, `window`, Tauri, Expo |
| `packages/ui` | the above + `react` | `react-dom`, `react-native` |
| `apps/*` | everything | — |

`core` and `content` take injected `Fetcher` and `Storage`. Adding a runtime dependency to
`core`, `content` or `aurora-import` needs an ADR.

**No game-specific nouns in `core`.** If you are about to write `strength`, `spell` or
`armor class` outside a test fixture, you are in the wrong package. Element types and stats are
opaque strings declared by `systems/<id>/system.json` (ADR 0003).

**Characters store choices, never derived numbers** (ADR 0006) — with one exception: recorded
random results (`rolls`) are *inputs*, because a die roll has no formula (ADR 0007).

**A save must open with zero content sources** (ADR 0012). `.incu` is a zip embedding the
element subset the character uses, plus assets as real bytes. This is the product requirement,
not an optimization — if a change makes a save depend on configured sources to open, it is wrong.

**Aurora is import-only and frozen when done** (ADR 0008). No export. No speculative support.

**Never generate artwork.** No AI-generated images, logos, icons, textures or sample art, not
even as a temporary placeholder. This is a stated project commitment in the README, not a
preference. If a visual asset is needed, leave a clearly-marked gap and say so — do not fill it.
Diagrams drawn in code (SVG, Mermaid) and UI built from CSS are not artwork and are fine.

## Baselines that must not regress

Content corpus: **740 files · 12,058 elements · 0 errors · 57 unresolved references.**
45 of the 57 are `ID_INTERNAL_*` (Aurora generates them at runtime); 12 are upstream typos.
CI fails if that count grows.

## State of play

Working: core engine, Aurora content importer, content sources, CLI, two system definitions.
Not started: both app shells (only their `platform.ts` contracts exist).

**The code has not yet caught up to ADRs 0007, 0009 and 0012.** `GameSystem` still has flat
`buildSteps`/`sheet`/`levelRange`; `Character` still has `level` and lacks `kind`, `rolls` and
`assets`. Restructuring that is the current task, and it is deliberately breaking — better now
than after the system format becomes a public API (ADR 0011).

## Conventions

- Small, focused commits. Explain what you tried that didn't work — often the useful part.
- Diagnostics over guessing: when content is ambiguous, report it, don't silently pick.
- When a decision would be expensive to reverse, write an ADR before writing the code.
