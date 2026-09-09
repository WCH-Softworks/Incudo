# Licensing

Two separate things, kept separate on purpose.

## 1. Incudo's own code

MIT. See [LICENSE](../LICENSE). That is the whole story.

## 2. Game systems the project ships

**Policy ([ADR 0010](./adr/0010-licensing-and-funding.md)):** a system is added to `systems/`
only after its licence has been read and recorded as permitting third-party tools that accept
donations. Incudo is funded by a Ko-fi link, so "permits third-party tools but restricts
monetization" is not good enough.

Incudo ships **no rulebook content** — users point it at content indexes themselves. But an
official `system.json` is the project asserting support for a game and encoding its rules
structure, so it gets checked.

### Checklist for adding an official system

1. Find the actual licence text. Not a blog post about it, not a forum consensus.
2. Does it permit third-party tools/software at all?
3. Does it permit **commercial use**, or otherwise clearly permit donation funding?
4. Is it **irrevocable**? (A revocable licence is a dependency that can be withdrawn — the OGL
   1.0a crisis of 2023 is the case study.)
5. What attribution is required, and where must it appear?
6. Record it in the table below and in the system's `licence` block, with the date checked.

### Register

| system | licence | commercial use | irrevocable | status | checked |
|---|---|---|---|---|---|
| `dnd5e` | CC-BY-4.0 (SRD 5.1, SRD 5.2.1) | Yes | Yes | ✅ **Cleared** | 2026-09-09 |
| `cairn` | — | — | — | ⚠️ Structural sketch only; **replace the content before shipping** | — |
| `pf2e` | ORC License (Remaster) | Likely | Likely | ⏳ **Not assessed** — read the ORC text and Paizo's Compatibility License in full before any work | — |
| anything else | — | — | — | ❌ Assume not permitted until checked | — |

**D&D 5e detail.** SRD 5.1 and SRD 5.2/5.2.1 are published under Creative Commons Attribution
4.0 International. CC-BY-4.0 permits commercial use, is irrevocable, and requires only
attribution. This is why 5e is the system Incudo ships first — the licence position is
unusually clean. Attribution text goes in the system's `licence.attribution` field and is shown
in the app's About screen.

**Pathfinder 2e detail.** Paizo's ORC License is an open, irrevocable, system-neutral licence
and Pathfinder 2e Remaster content is published under it, which is promising. Promising is not
the standard: the ORC text and the Paizo Compatibility License must both be read in full and
recorded here before `systems/pf2e` exists.

## 3. Systems and content users add themselves

Not covered by this policy, because the project does not distribute them.

Anyone can write a `system.json` for any game and use it locally
([ADR 0011](./adr/0011-user-systems.md)). Incudo does not host, index, link to, or bless
user systems. What a user does on their own machine with rules they have legitimate access to is
between them and the publisher.

That separation is the whole design: **the tool stays general, the project's distribution stays
conservative.**

## 4. Content indexes

Incudo loads content the user points it at — AuroraLegacy's indexes or anyone else's. That
content is under whatever licence its publisher chose; Incudo neither relicenses it nor
redistributes it. Content is fetched by the user's own app, from the user's chosen URL.

---

*None of the people maintaining this project are lawyers. This document records reasoning and
dates so that decisions can be re-examined, not so they can be relied on as legal advice. When
in doubt, do not ship the system.*
