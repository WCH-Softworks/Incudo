# 0002 — Single monorepo with layered packages

**Status:** Accepted · 2026-09-09

## Context

Two apps plus shared engine code. Three options: one repo with workspaces, a code repo plus a
separate content repo, or separate repos per app with a published core package.

The project is solo and open source. Contributors are rare and their first contribution is
usually small.

## Decision

One repository, npm workspaces, with a strict layering:

```
packages/core            model + rules engine        (no deps, no platform)
packages/aurora-import   Aurora XML → Incudo      (depends on core)
packages/content         sources, cache, indexes     (depends on core)
packages/ui              shared components + hooks   (depends on the above + react)
apps/desktop             Tauri shell
apps/mobile              Expo shell
systems/<id>             game system definitions (data)
tools/incudo                 CLI — validates the engine with no UI
```

> **Note (ADR 0039):** `tools/incudo` was a CLI and is now `tools/verify`, which holds the tests that
> check the engine against the real corpus and saves. There is no CLI; the layers above are unchanged.

Import rules are in `docs/CODE-REUSE-POLICY.md` and enforced by TypeScript project references
plus ESLint `no-restricted-imports`.

Game content stays **out** of this repo: Incudo points at content indexes (AuroraLegacy's, or
anyone's) rather than hosting rulebook material. Only SRD-safe bundled content, if any, would
live here.

## Consequences

**Good**
- One PR can change the engine and both apps atomically — essential while the model is unstable.
- One `git clone`, one install, one CI config. Lowest possible friction for a drive-by contributor.
- No package publishing, no version-skew between core and apps.

**Bad / accepted**
- CI runs more than strictly necessary per change. Fine at this size; add affected-package
  filtering if it becomes slow.
- The repo will look intimidatingly large before it does much. Mitigated by a README that says
  where to start.
- Nothing physically stops a shell from reaching into another shell's code. Lint rules only.

## Alternatives considered

- **Separate repos per app** with `@incudo/core` on npm: correct at scale, wrong for a solo
  project — every engine change becomes publish-then-bump across three repos.
- **Code repo + separate content repo:** the split is real and may happen later for *homebrew
  authored by this project*, but with no first-party content today it would be an empty repo.
