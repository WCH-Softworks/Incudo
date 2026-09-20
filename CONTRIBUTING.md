# Contributing

Thanks for looking. Please read this section before you spend time on code.

## The current phase: read, don't merge

**Incudo is not merging contributions yet.** Until the tool is finished, the architecture stays
under one pair of hands. At this stage a merged change costs more to live with than it does to
write — the data model is still moving (see the breaking work queued in `ROADMAP.md` Phase 0),
and every merged decision is one I would have to keep or unpick later.

This is a phase, not a permanent policy, and it is not a brush-off:

- **Open pull requests and issues.** I read all of them and I will tell you what I think. A PR I
  cannot merge today is still the clearest possible bug report, and the review is real.
- **Fork it.** MIT, no permission needed, no hard feelings. If your fork goes somewhere
  interesting, I want to know.
- **This is how maintainers get chosen.** When contributions open up, I will be inviting people
  based on forks and PR history I have already been reading — not on a form.

So: everything below is worth doing. Just know that its immediate value is the conversation and
the record, not a merge commit.

## Setup

```bash
npm install
npm run typecheck
npm test
```

Node 20+ (22 recommended). No build step is needed for the packages — the tests run TypeScript
directly via Node's type stripping.

**One consequence of that:** avoid TypeScript syntax Node cannot strip — no parameter
properties (`constructor(private readonly x: T)`), no `enum`, no `namespace`, no decorators.
Write the field and assign it. Relative imports use the `.ts` extension; `tsc` rewrites them
on emit.

## Where things go

Read [docs/CODE-REUSE-POLICY.md](./docs/CODE-REUSE-POLICY.md) before your first change. The
short version:

- A rule about the game belongs in `packages/core`, never in a component.
- `core`, `content` and `aurora-import` must not import platform APIs (`fs`, `fetch`,
  `window`, `react-native`). They take injected `Fetcher` and `Storage`.
- Adding a runtime dependency to those three packages needs an ADR.

## Most useful things to send

Ranked by how much they help, given nothing merges yet — the top two need no merge to be
valuable at all:

- **Content that does not load.** Add a homebrew source you actually use in the app's Sources
  view: anything it cannot read, or a character it builds wrongly, is likely a real bug. An issue
  with the index URL and what you saw is immediately actionable.
- **Importer edge cases.** If content in the wild breaks it, a failing test plus the offending
  XML snippet is the perfect issue — it goes straight into the corpus suite.
- **A system definition** for a game you play (`systems/<id>/system.json`). The most valuable
  *code* anyone can write, because a second real system is what keeps the engine honest. Note
  that shipping one officially also depends on its licence — see
  [docs/LICENSING.md](./docs/LICENSING.md).

## Testing

```bash
npm test        # unit tests, and the real-corpus suite in tools/verify where a corpus is installed
```

CI runs `tools/verify/src/corpus.test.ts` over the whole AuroraLegacy corpus. A change that
increases the count of unresolved references, or of warnings, fails the build. The budgets are
spelled out in `.github/workflows/ci.yml`, and [tools/verify/README.md](./tools/verify/README.md)
says how to run the same check locally.

## Decisions

If you are about to make a call that a future contributor might silently undo — a format
change, a technology choice, a new dependency in a core package — write an ADR in
`docs/adr/`. Copy the shape of an existing one. Recording the *trade-off* matters more than
recording the choice.

## Pull requests

Small and focused beats large and complete. Explain what you tried that did not work, if
anything — that is often the most useful part of the review.

Expect a reply rather than a merge, for now. If a PR is right and I cannot take it yet, I will
say so and say why, and it stays open.
