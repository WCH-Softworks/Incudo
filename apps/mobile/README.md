# HeroForge mobile

Expo (React Native). **Not scaffolded yet** — this is ROADMAP Phase 4, deliberately after
the desktop builder so the shared core is proven first.

`src/platform.ts` is already here because it is the contract with the shared packages.

## Order of work

1. **Sheet first.** Reading and playing a character on a phone is the common case; building
   one on a phone is not. Ship the sheet, then the builder.
2. Download mode is the default here — see [ADR 0004](../../docs/adr/0004-live-vs-downloaded-content.md).
3. `MobileStorage` is intentionally left throwing rather than stubbed with AsyncStorage:
   downloaded content is megabytes, and shipping the wrong storage backend by accident is
   worse than a clear error.

## Exit criteria

The same `.heroforge` file opens identically on desktop and mobile, and `@heroforge/core`
still has zero platform-specific code.
