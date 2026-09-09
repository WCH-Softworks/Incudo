# Contributing

Thanks for looking. This is a solo project that would like not to be.

## Setup

```bash
npm install
npm run typecheck
npm test
```

Node 20+ (22 recommended). No build step is needed for the packages or the CLI — tests and
the CLI run TypeScript directly via Node's type stripping.

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

## Good first contributions

- **A system definition** for a game you play (`systems/<id>/system.json`). This is the most
  valuable thing anyone can add, because it is what keeps the engine honest.
- **Anything the CLI reports.** `npm run incudo -- validate <index> --strict` against a homebrew
  source you use is likely to find real bugs.
- **Aurora format edge cases.** If content in the wild breaks the importer, a failing test
  with the offending XML snippet is a perfect issue.

## Testing

```bash
npm test                                    # unit tests
npm run incudo -- validate ./path/to/core.index # the real regression suite
```

CI runs the importer over the whole AuroraLegacy corpus. A change that increases the count
of unresolved references fails the build — the current baseline is in
[docs/AURORA-FORMAT.md](./docs/AURORA-FORMAT.md).

## Decisions

If you are about to make a call that a future contributor might silently undo — a format
change, a technology choice, a new dependency in a core package — write an ADR in
`docs/adr/`. Copy the shape of an existing one. Recording the *trade-off* matters more than
recording the choice.

## Pull requests

Small and focused beats large and complete. Explain what you tried that did not work, if
anything — that is often the most useful part of the review.
