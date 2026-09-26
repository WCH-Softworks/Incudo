# Incudo

*(in-KU-do, from the Latin* incus*, an anvil)*

A tabletop character builder for desktop and mobile that works with any game system. Free and
open source.

> **Status: early.** The desktop app builds, saves and imports characters offline, for player
> characters and NPCs. The mobile app is not started. See [ROADMAP.md](./ROADMAP.md).

## Why

I have used [Aurora Builder](https://aurorabuilder.com/) for years, and it is still the best
offline character builder for D&D 5e. It is also discontinued. Its community content is still
maintained at [AuroraLegacy/elements](https://github.com/AuroraLegacy/elements), and no other
tool can read it.

Incudo reads all of it, and adds the following:

- **Any game system.** The engine has no built-in knowledge of D&D. A game is described by a
  *system definition*, a data file, and D&D 5e is the first one. You can copy an official
  definition and change it, or write your own. If it passes validation, the app can build
  characters with it.
- **Several kinds of character.** A system can declare more than one kind, each with its own
  build steps and sheet. D&D 5e has player characters, NPCs and legendary creatures.
- **Desktop and mobile.** Both apps share the engine, the importer and the view-models.
- **Content read online or downloaded.** A content source can be read straight from its
  repository, or downloaded for offline use. Either way, what is read is cached.
- **Aurora import.** Incudo imports Aurora content and Aurora saved characters directly. Its own
  formats are separate: characters are saved as JSON, and portraits are stored as image files.
- **Free.** MIT licensed, with no accounts and no paywall. There is a Ko-fi link below.

## Built with AI

Incudo's code is written by AI coding tools, and it will continue to be maintained that way.

- Every change is directed and reviewed by a person before it is committed.
- Bugs are the maintainer's responsibility. Report them as you would for any project.
- As with any software, read the code before relying on it for anything important.

**This project will never contain AI-generated artwork.** That includes the logo, icons, sample
content and temporary placeholders.

Artwork comes from artists who offer their own original work, or it is commissioned and paid
for. In both cases the artist is credited and keeps their rights. If you are an artist and this
interests you, open an issue.

The logo, an anvil under a gear, was drawn by the maintainer and is in [`brand/`](./brand/). The
desktop app's icons are resized copies of it, made with `npx tauri icon`; see
[`apps/desktop/src-tauri/icons/`](./apps/desktop/src-tauri/icons/). The logo is a working
version, not a final one.

Game content is not AI-generated either. It comes from the content sources you add, which are
written and maintained by people. Incudo reads that content and does not change it.

## Try it

```bash
npm install
npm run desktop       # the app, at http://localhost:5173
npm run corpus:sync   # optional: download the AuroraLegacy content for the full test suite
npm test
```

The app opens on a character library. Choose a folder, add a content source, and build a
character.

Incudo loads the full AuroraLegacy corpus, about 740 files and 14,000 elements, with no errors.
The tests that check this run in CI against the current version of that repository; see
[`tools/verify`](./tools/verify/README.md). The one unresolved reference they report is a typo in
the upstream content; see [docs/AURORA-FORMAT.md](./docs/AURORA-FORMAT.md).

## Layout

```
packages/core            data model and rules engine (no dependencies, no platform APIs)
packages/aurora-import   reads Aurora content and saves into Incudo's model
packages/content         content sources: online, cached, bundled, layered
packages/ui              shared view-models and components
apps/desktop             desktop app (Tauri and React)
apps/mobile              mobile app (Expo), not started
systems/dnd5e            the D&D 5e system definition (data, not code)
systems/cairn            a small non-D&D system, used to test that the engine stays generic
tools/verify             tests against real content and saves; not shipped
```

## Documentation

| | |
|---|---|
| [ROADMAP.md](./ROADMAP.md) | the plan up to 1.0 and after |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | how the parts fit together |
| [docs/DATA-MODEL.md](./docs/DATA-MODEL.md) | elements, systems and characters |
| [docs/AURORA-FORMAT.md](./docs/AURORA-FORMAT.md) | the Aurora content format |
| [docs/AURORA-SAVE-FORMAT.md](./docs/AURORA-SAVE-FORMAT.md) | the Aurora save format |
| [docs/LICENSING.md](./docs/LICENSING.md) | which game systems can be distributed with Incudo |
| [docs/CODE-REUSE-POLICY.md](./docs/CODE-REUSE-POLICY.md) | which packages may import which |
| [docs/adr/](./docs/adr/) | design decisions and their trade-offs |

## Contributing

**Incudo is not merging contributions yet.** Until the first release, I am keeping the
architecture under one maintainer, because the data model is still changing. This will change
later.

In the meantime:

- **Issues are open to everyone.** I read all of them and reply. Pull requests are limited to
  collaborators for now.
- **You can fork the project.** It is MIT licensed.
- **Future maintainers will come from here.** When contributions open, I will invite people whose
  issues and forks I have been following.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## Content and licensing

Incudo ships **no rulebook content**. You add content sources yourself. The code is MIT licensed
([LICENSE](./LICENSE)), and each content source is under its publisher's own licence.

A game system is distributed with Incudo only if its licence allows third-party tools that accept
donations, since Incudo is funded through Ko-fi. D&D 5e meets that requirement: the SRD 5.1 and
5.2.1 are released under CC-BY-4.0, which allows commercial use and requires attribution. A
system whose licence has not been assessed is not distributed. This applies only to what the
project distributes. You can write a system definition for any game and use it yourself. See
[docs/LICENSING.md](./docs/LICENSING.md).

## Support

Incudo is free and will stay free. If you want to support it:
**[ko-fi.com/willcaphir](https://ko-fi.com/willcaphir)**
