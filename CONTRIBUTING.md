# Contributing

Please read this before you spend time on code.

## Contributions are not being merged yet

Until the first release, I am keeping the architecture under one maintainer. The data model is
still changing, and every change I merge now is one I would have to keep or undo later. This will
change after the first release.

For now:

- **Pull requests can only be opened by collaborators.** This restriction will be lifted when
  contributions open.
- **Issues are open to everyone.** I read all of them and reply.
- **You can fork the project.** It is MIT licensed and needs no permission. If your fork does
  something interesting, open an issue and tell me about it.
- **Future maintainers will come from here.** When contributions open, I will invite people whose
  issues and forks I have been following.

The rest of this file describes how the project works, for anyone reading or forking the code.

## Setup

```bash
npm install
npm run typecheck
npm test
```

Node 22.9 or later is required. The packages have no build step: the tests run TypeScript
directly using Node's type stripping.

Because of that, do not use TypeScript syntax Node cannot strip: parameter properties
(`constructor(private readonly x: T)`), `enum`, `namespace` and decorators. Declare the field and
assign it instead. Relative imports use the `.ts` extension, and `tsc` rewrites them when it
emits.

## Where code goes

Read [docs/CODE-REUSE-POLICY.md](./docs/CODE-REUSE-POLICY.md) before your first change. In short:

- A game rule belongs in `packages/core`, never in a component.
- `core`, `content` and `aurora-import` must not import platform APIs (`fs`, `fetch`, `window`,
  `react-native`). They receive a `Fetcher` and a `Storage` from the app.
- Adding a runtime dependency to those three packages requires an ADR.

## Most useful issues

In order of how much they help:

- **Content that does not load.** Add a content source you use in the app's Sources view. If the
  app cannot read it, or builds a character from it incorrectly, it is probably a bug. Include
  the index URL and what you saw.
- **Importer problems.** If real content breaks the importer, include the XML that causes it. A
  failing test is even better.
- **A system definition** for a game you play (`systems/<id>/system.json`). A second real system
  is the best test that the engine is not tied to D&D. Whether one can be distributed with Incudo
  depends on its licence; see [docs/LICENSING.md](./docs/LICENSING.md).

## Testing

```bash
npm run corpus:sync   # download the current AuroraLegacy content into .corpus/
npm test              # unit tests, plus the real-content tests when .corpus/ exists
```

Without `.corpus/`, the real-content tests are skipped and say so.

CI runs the same tests against the current AuroraLegacy repository. A change that increases the
number of unresolved references or warnings fails the build. The limits are in
`.github/workflows/ci.yml`, and [tools/verify/README.md](./tools/verify/README.md) explains how to
run the checks locally.

Tests must not depend on a particular machine. Do not commit file paths, user names or character
names.

## Decisions

If a change could later be undone by someone who does not know why it was made, such as a format
change, a technology choice or a new dependency in a core package, write an ADR in `docs/adr/`.
Follow the structure of an existing one. Record the trade-offs, not only the choice.

## Commits and pull requests

Keep changes small and focused. If you tried something that did not work, say what it was; that
is often the most useful part of a review.
