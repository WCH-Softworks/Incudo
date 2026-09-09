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
npm run incudo -- --help   # the CLI: validate | types | inspect | system | content | character
npm run incudo -- validate <index-url-or-local-path> [--strict] [--json]
npm run incudo -- system validate systems/dnd5e/system.json
npm run incudo -- character show <file.incu>   # derives from the save alone — ADR 0012
npm run fixtures:rebuild   # regenerate tools/incudo/fixtures/aelin/ after a format change
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

**Nothing is ever published to npm.** Every package stays `"private": true`. The `@incudo/`
prefix is a local workspace naming convention, not a registry claim — the app is the product,
and the packages exist to organise it. Do not add `publishConfig`, a release workflow, changesets,
or per-package versioning, and do not remove `private`. If someone else claims the `@incudo` npm
scope, that is fine and changes nothing here.

That does **not** mean nothing is a public API. Two things are, and they need real versioning
discipline: the **system definition format** (users author these — ADR 0011) and the **`.incu`
save format** (users' own files — ADR 0012). Both carry `formatVersion`. Package versions do not
matter; those two do.

**Never generate artwork.** No AI-generated images, logos, icons, textures or sample art, not
even as a temporary placeholder. This is a stated project commitment in the README, not a
preference. If a visual asset is needed, leave a clearly-marked gap and say so — do not fill it.
Diagrams drawn in code (SVG, Mermaid) and UI built from CSS are not artwork and are fine.

## Baselines that must not regress

Content corpus: **740 files · 12,058 elements · 0 errors · 57 unresolved references.**
45 of the 57 are `ID_INTERNAL_*` (Aurora generates them at runtime); 12 are upstream typos.
CI fails if that count grows.

## State of play

Working: core engine, Aurora content importer, content sources, CLI, two system definitions,
the `.incu` container, the JSON Schemas and the validator behind them.
Not started: both app shells (only their `platform.ts` contracts exist).

ADRs 0007, 0009 and 0012 are now implemented. `GameSystem` declares `characterKinds[]`, each
owning its `buildSteps`, `sheet`, element types and `progression` (level | rating | xp | none);
`Character` has `kind`, `progress`, `rolls` and `assets`. A `.incu` is a zip of
`manifest.json` + `character.json` + `content.json` + `assets/`, readable and writable as an
unpacked folder too, and `incudo character verify` proves a save re-derives identically with
zero sources configured.

Two things that follow from that, for anyone changing this code:

- **The system format is now a public API in practice.** Breaking it again is expensive.
  `schemas/system.schema.json` is the contract; `packages/core/src/json-schema.ts` is the *one*
  validator the CLI and the app share. Do not write a second one.
- **`summarize()` in the CLI is the definition of "derived output".** The self-containment test
  compares it, so anything added to a derivation that depends on *what content is loaded* rather
  than on the character must stay out of it — candidate lists are the example.

## Conventions

- Small, focused commits. Explain what you tried that didn't work — often the useful part.
- Diagnostics over guessing: when content is ambiguous, report it, don't silently pick.
- When a decision would be expensive to reverse, write an ADR before writing the code.
