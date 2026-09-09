# HeroForge

A modern, system-agnostic tabletop character builder for desktop and mobile.
Free, open source, and able to read the entire Aurora Builder content ecosystem.

> **Status: early.** The engine, the Aurora importer and the content layer work and are
> validated against 12,000 real elements. There is no UI yet. See [ROADMAP.md](./ROADMAP.md).

## Why

[Aurora Builder](https://aurorabuilder.com/) is the best offline D&D 5e character builder
there is, and it is effectively abandoned. A decade of community content lives in its XML
format — content that is still actively maintained at
[AuroraLegacy/elements](https://github.com/AuroraLegacy/elements). HeroForge is a
replacement that keeps all of it.

What it aims to do differently:

- **Not D&D-only.** The engine knows nothing about D&D. 5e is the first *system definition* —
  a data file — not the architecture. Users can fork the official ones or write their own; if it
  validates, the app can build in it.
- **More than one kind of character.** A system declares PC, NPC, legendary creature and
  companion kinds, each with its own build flow and sheet.
- **Desktop and mobile**, sharing the engine, the importer and the view-models.
- **Live or downloaded content.** Read a source straight from its repo without downloading
  it first (Aurora can't), or download it for full offline use. Streaming still writes
  through to the cache, so there is no offline switch to forget to flip.
- **Aurora import from day one** — content *and* saved characters — as a native input format,
  not a migration step. HeroForge keeps none of Aurora's formats: its own are JSON, and
  portraits are files rather than 5 MB of base64 inside the save.
- **Free.** MIT, no accounts, no paywall. If it helps you, there's a Ko-fi link below.

## Try the engine

There is no app yet, but there is a CLI, and it does real work:

```bash
npm install
npm run hf -- validate https://raw.githubusercontent.com/AuroraLegacy/elements/master/core.index
npm run hf -- types    https://raw.githubusercontent.com/AuroraLegacy/elements/master/core.index
npm run hf -- inspect  https://raw.githubusercontent.com/AuroraLegacy/elements/master/core.index ID_WOTC_PHB_CLASS_ROGUE
```

Against a full local checkout of AuroraLegacy: **740 files, 12,058 elements, 0 errors.**
The 57 dangling references it reports are documented in
[docs/AURORA-FORMAT.md](./docs/AURORA-FORMAT.md) — 45 are elements Aurora's own app
generates, and 12 are genuine typos in upstream content.

## Layout

```
packages/core            model + rules engine   (no dependencies, no platform APIs)
packages/aurora-import   Aurora XML -> HeroForge model
packages/content         content sources: live, cached, bundled, layered
packages/ui              shared view-models and components
apps/desktop             Tauri + React shell        (Phase 1)
apps/mobile              Expo shell                 (Phase 4)
systems/dnd5e            the D&D 5e system definition — data, not code
systems/cairn            a tiny non-D&D system, to keep the engine honest
tools/hf                 the CLI
```

## Documentation

| | |
|---|---|
| [ROADMAP.md](./ROADMAP.md) | the plan, from here to 1.0 and beyond |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | how the pieces fit |
| [docs/DATA-MODEL.md](./docs/DATA-MODEL.md) | elements, systems, characters |
| [docs/AURORA-FORMAT.md](./docs/AURORA-FORMAT.md) | the Aurora content format, reverse-engineered |
| [docs/AURORA-SAVE-FORMAT.md](./docs/AURORA-SAVE-FORMAT.md) | the Aurora save format, and what it taught us not to do |
| [docs/LICENSING.md](./docs/LICENSING.md) | which systems can ship officially, and why |
| [docs/CODE-REUSE-POLICY.md](./docs/CODE-REUSE-POLICY.md) | what may import what, and why |
| [docs/adr/](./docs/adr/) | the decisions, with their trade-offs |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Good first contributions right now: a system
definition for a game you play, or a fix for something the CLI reports.

## Content and licensing

HeroForge ships **no rulebook content**. It is an engine; you point it at content indexes,
exactly as Aurora's "Additional Content" tab does. The code is MIT ([LICENSE](./LICENSE)); the
content you load is under whatever licence its publisher chose.

A system ships *officially* only if its licence permits third-party tools that accept donations
— HeroForge is Ko-fi funded, so that is the bar. D&D 5e clears it (SRD 5.1 and 5.2.1 are
CC-BY-4.0: commercial use permitted, irrevocable, attribution required). Anything unassessed is
treated as not permitted. That policy governs what the *project distributes*; you can write a
system definition for any game and use it on your own machine. See
[docs/LICENSING.md](./docs/LICENSING.md).

## Support

HeroForge is free and always will be. If you'd like to buy me a coffee:
**[ko-fi.com/…](https://ko-fi.com/)** *(link to be filled in)*
