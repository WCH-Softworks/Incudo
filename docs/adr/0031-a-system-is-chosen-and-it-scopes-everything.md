# 0031 — A system is chosen before anything else, and the choice scopes the library

**Status:** Accepted · 2026-09-13 · **amends [0027](./0027-a-library-is-a-folder.md)** ·
builds on [0011](./0011-user-systems.md), [0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md)

## Context

The app said "Dungeons & Dragons 5th Edition · no content loaded" in its header from the first
frame, to a user who had never been asked. `boot.ts` was one line:

```ts
import dnd5e from '@repo/systems/dnd5e/system.json';
```

Two system definitions ship, users may author more ([ADR 0011](./0011-user-systems.md)), and the
whole premise of [ADR 0003](./0003-system-agnostic-content-model.md) is that 5e is the first
system definition rather than the architecture. The app contradicted that in its own title bar.

Three things were broken underneath the missing question, and only the first is cosmetic:

- **Nobody chose.** One hardcoded import, no way to reach Cairn at all.
- **Opening a character ignored its own `systemId`.** `LibraryEntry.systemId` has existed since
  ADR 0027 and is read straight off the manifest; `openFromLibrary` never looked at it. A Cairn
  save opened from the library was derived against the 5e definition, silently, because
  `deriveCharacter` takes a system and a character and has never had reason to ask whether they
  agree.
- **A source belongs to no system.** `ConfiguredSource` had no `systemId`, so every enabled
  source loaded into every character. Keep a Cairn index and a D&D index at once and both go
  into the same `ElementIndex` — and into the content a save embeds, where ADR 0012 freezes it
  forever.

### Why a source cannot be *asked* what it serves

This is the part that decides the design, and it is a measurement rather than a preference.

Nothing in a content index says which game it is for. An Aurora `.index` has no field for one
and never will — the format is frozen ([ADR 0008](./0008-aurora-compatibility-frozen.md)) — and
`ContentIndex` carries `format: 'aurora' | 'incudo'` and nothing else. Two indexes of two
different games are shaped identically.

The tempting inference is the element types a source contributes, compared against the system's
`elementTypes` and `auroraTypeMap`. It fails twice: it needs the source **loaded** before it can
answer (18.4 s cold for the Aurora corpus, so the launcher would block on the network — the
exact thing ADR 0027 removed), and it is still a guess, which is what
[ADR 0005](./0005-aurora-import.md) rules out. Two Aurora indexes of different games would look
the same to it.

So the association has to be **recorded**, and the only moment it is known is when the user adds
the source.

## Decision

### 1. The launcher comes first, and the choice scopes the library

A first screen that lists the shipped systems, with the facts each can be judged on — how many
characters in the library folder are its, how many sources are assigned to it and how many of
those are enabled. The answer is persisted (`system:current`) and restored on the next launch,
so it is a question asked once rather than a gate hit every time.

**This amends ADR 0027**, which put the library first, and the amendment is deliberate rather
than a drift. ADR 0027's argument was against a *content* gate: the app used to open on Sources
and do nothing until 238 files had come down, which contradicted ADR 0012. That argument holds
completely and the launcher does not touch it — **picking a system leads straight to the
library, never to "now add a source"**, and every save still opens with nothing configured. What
the launcher gates is a question the app cannot answer for the user and was answering anyway.

The library is then **filtered** to the chosen system: choose D&D and you see D&D characters,
and only those. That is stronger than flagging them, and it is what makes the choice mean
something.

**A filter must not be a disappearance.** A folder of nine characters viewed as another system
saying "nothing here yet" is indistinguishable from having picked the wrong folder, which is the
mistake a user actually makes. So `LibraryState` gained `elsewhere`: what the filter is hiding,
counted by system, rendered as a sentence with a way to switch. A container that will not *read*
has no manifest and therefore no system to judge it by, so it stays visible under every system
rather than vanishing from all of them.

The system also stops being a label in the header and becomes a control.

### 2. A source is tagged with the system it was added under

`ConfiguredSource.systemId`, optional, recorded and never inferred. `sourcesForSystem` is what
the content loader asks; only the current system's enabled sources are loaded.

**An untagged source belongs to no system**, and that matters more than it looks. A profile
written before this ADR has none, and quietly counting those as the current system's is exactly
the failure this whole ADR is about — it would put a Pathfinder index into a D&D character the
first time someone kept two. `unassignedSources` surfaces them in their own section with a
"this is <system> content" button. They are a question, not an answer, and they are never
hidden: a source that silently stopped loading is the worse failure.

### 3. A system definition may **suggest** sources, and vouch for them

```jsonc
"suggestedSources": [
  { "url": "…/AuroraLegacy.index", "name": "AuroraLegacy",
    "description": "…Maintained by the AuroraLegacy project, not by Incudo.",
    "official": true }
]
```

This is what makes the tagging invisible in the common case: a user who picks 5e and clicks
**Add** on the suggestion has said which system the source serves by picking it, and never sees
a system field. It also replaces the empty URL box that was the first thing a new user met — the
same job Aurora's "Additional Content" tab did.

It lives on the system rather than in a catalogue beside the app so that a user-authored system
can point at its own content and a fork inherits what it was forked from. It is a **pointer, not
content**: [ADR 0022](./0022-kinds-contribute-systems-do-not-ship-content.md)'s rule that a
system definition ships no elements is untouched, and nothing is fetched until the user picks
one.

`official` means *the author of this system definition vouches for this index*. **A claim, not a
check** — anyone can write `true` in their own system — so the UI says who is vouching rather
than presenting it as a verdict, and it deliberately says nothing about the content's licence,
quality or affiliation. These point at other people's projects
([ADR 0010](./0010-licensing-and-funding.md)).

### 4. A source belongs to one system at a time, and says so

A source is keyed on its URL, because that is the only thing a character's `SourceRef` can be
matched against (ADR 0028). So one index cannot be configured under two systems, and adding one
that another system holds would **retag it in place and take it away from that system**. That is
refused with a sentence rather than done silently. Making the key `(url, systemId)` would fix it
properly and would change what a `SourceRef` matches, which is a save-format concern; not worth
it for a case nobody has hit.

### 5. `formatVersion` moves nowhere

`suggestedSources` is additive and optional on the system format — the sixth such change in a
row (ADR 0011). `SourceProfileData` stays at 1 for the same reason, and an entry with no
`systemId` is a state the code handles rather than a migration it performs.

## What running it found, which no test had

Both of these were introduced by this change and both were found in the first two minutes of
using it, which is the pattern CLAUDE.md keeps recording.

- **`System "cairn" has no character kind "pc"`, and the app died.** `choose()` set the system,
  then awaited the character. That leaves one render where `system` is the new one and
  `character` is still the old one; `Shell` mounts on that pair and `useBuilder` calls
  `resolveCharacterKind(cairn, 'pc')`. The character is loaded first now and both go into one
  render. No test had it because every test builds one system's character against that system.
- **The same index offered as a suggestion *and* listed as unassigned**, with an Add button
  that would have retagged it in place. The suggestion filter compared against the current
  system's sources; it compares against the whole profile now. This is what turned up decision 4.

Two things are checked rather than eyeballed: the partition and the collision rule in
`packages/ui/src/character-library.test.ts`, and — because a filter's real failure mode is
looking empty — a set of real Aurora saves in `tools/verify/src/library.test.ts`, imported into
a folder and then viewed as Cairn, which must report `[{ systemId: 'dnd5e', count: 9 }]` and
still open one the moment the system is switched back.

**The bug the filter nearly caused, and the reason `freeName` reads what it reads.** The library
keeps the whole scan privately and filters only what it publishes, because `freeName` picks a
filename nothing on disk is using. Asking the *filtered* list would have let a new D&D character
be written straight over a Cairn one with the same name — silent data loss, from a change whose
entire subject is what to show on a screen. There is a test named after it.

## Follow-ups that landed with it

Two things the first cut of the launcher got wrong, both caught by reading the screen rather
than the code.

**A card was written for a maintainer.** It rendered `description` verbatim, and 5e's read
"The first system definition, and the one Incudo is tested against. Nothing in `@incudo/core`
imports this file — it is data. See docs/adr/0003." Every word true, and every word aimed at
whoever maintains the definition rather than at someone choosing a game. Cairn's was worse: its
*name* was "Cairn (example non-D&D system)". So `description` is now documented in the schema
as **user-facing prose**, both shipped definitions were rewritten, and the maintainer's notes
moved to `systems/README.md` where they were always meant to be. Nothing on a card cites an
ADR. The facts line changed with it — "0 characters · no content sources yet" was a database
row, and reads "No characters yet · content ready" now.

A definition may also carry a **`logo`**, optional, and a **reference rather than inline bytes**
because ADR 0007 says images are never inlined in Incudo's own formats. Neither shipped system
has one, and a card with no logo draws **nothing** — never a generated glyph or an initial in a
coloured circle, which is the standing commitment in the README and exactly the sort of place it
would slip.

**There was no way to add a system.** ADR 0011 has promised user-authored systems since Phase 0
and the format has been a public API since ADR 0007, but `boot.ts` imported the shipped
definitions at build time and that was the whole of it — the promise was unreachable from the
product. `UserSystemStore` in `packages/ui` reads a picked `system.json` through the **same**
`validateGameSystem` the CLI and the shipped definitions go through, keeps it in `Storage`, and
lists it beside them with a "yours" badge and a Remove.

Four rules in it are worth knowing:

- **Revalidated on every load, not trusted from when it was added.** Incudo's schema moves under
  a file the user wrote months ago; a definition that no longer validates is reported, not
  half-loaded, which is what ADR 0011 actually promises.
- **An id the app ships is refused**, with a sentence pointing at `extends`. A character records
  its system by id and nothing else (ADR 0012), so two systems answering to one id makes "which
  rules is this character's?" unanswerable in a file the user already saved.
- **The file is stored verbatim**, not round-tripped through `JSON.stringify`. Key order and
  spacing are the author's.
- **The storage key is encoded.** `remove` and `has` take an id from a caller rather than from a
  schema-validated definition, and a `Storage` key becomes a file path under `NodeStorage`,
  whose sanitiser permits `.` and `/`. An id of `../../something` would otherwise reach outside
  the app's own directory. There is a test named after it.

Removing a definition removes **no character**: a save keeps every element it uses, so the
characters stay on disk and reappear the day the definition comes back. Removing the system
currently in play drops to the launcher rather than leaving a `Shell` bound to a definition that
is gone.

## Consequences

**Good**
- The app stops telling the user what they chose. Cairn is reachable for the first time, which
  also means the second system definition is exercised by something other than a unit test — it
  immediately showed its own build steps, its own progression label and an honest "no content
  loaded".
- A character is derived against its own system. The silent mismatch is gone by construction:
  the library only offers what matches, and a draft belonging to another system is not loaded.
- Content stops leaking between systems, including into the frozen content of a save.
- `Shell` is keyed on the system id, so switching rebuilds every piece of per-system state.
  This is the same class of bug as the `use-builder.ts` memo that made "New character" do
  nothing (see CLAUDE.md), and keying is what stops it recurring.

**Bad / accepted**
- **A second gate before the library.** ADR 0027 argued hard against a first screen and this
  adds one. Mitigated by persisting the answer, so it appears once rather than every launch, and
  by never putting content behind it — but it is a real cost and the ADR it amends should be
  read alongside this one.
- **Switching systems reloads content**, because `Shell` remounts. Half a second warm (ADR 0029)
  and the full cold cost otherwise. Acceptable while switching is rare; it would not be if the
  app grew a per-system tab bar.
- **The launcher scans the library to show a character count**, which reads every container in
  full. That is the cost ADR 0027 already names and deliberately does not optimise — nine saves
  is imperceptible, two hundred will not be, and the summary cache it names is still unbuilt.
- **A logo is fetched from wherever the definition points**, which for a user-authored system
  is a URL the app did not choose. It is an `<img src>` and nothing more — no credentials, no
  script — but it is a request, and a hostile definition could use one to see that you opened
  the launcher.
- **`official` is self-asserted.** A fork of the 5e definition inherits `official: true` on
  AuroraLegacy and can add its own. The UI names the voucher, which is the honest presentation,
  but there is no verification and there is no plan for one.
- Nothing migrates an existing profile. Every source a user already had becomes "not assigned"
  and must be claimed once, by hand. Deliberate: the app does not know, and one click is cheaper
  than a wrong guess frozen into a save.

## Alternatives considered

**Ask at "New character" instead of before the library, and let each entry's `systemId` decide
on open.** Recommended first, and rejected by the maintainer for a reason the recommendation had
underweighted: characters should not be *cross-visible*. If you chose D&D you want a D&D
library, not a mixed one you have to read carefully. That is a product position about what the
library is, and it makes the system a property of the session rather than only of the character
— which the launcher then follows from.

**Filter the library but keep the other systems' characters visible and greyed out.** Keeps the
folder honest at a glance and loses the whole point: the list is supposed to be *your* game's.
The `elsewhere` count is the compromise — the fact survives, the clutter does not.

**Infer a source's system from the element types it contributes.** No user input, and it needs
the source loaded to answer, so the launcher would block on 18.4 s of network to show a
checkmark. Still a heuristic afterwards. This is ADR 0005's "report it, don't guess" applied to
the one place the app was about to guess for convenience.

**Ship a catalogue of known sources beside the app rather than on the system.** One file to
maintain, no format change. It cannot be extended by a user-authored system, and a fork of 5e
would lose its parent's suggestions — which is precisely the case ADR 0011 exists for.

**Key a configured source on `(url, systemId)` so one index can serve two systems.** The right
model if two systems ever legitimately share a corpus (a 5e variant overlay is the obvious
candidate). It changes what a character's `SourceRef` matches, which reaches the save format, so
it is not a thing to do speculatively. Refusing with a sentence costs nothing and leaves the door
open.
