# 0107 — Shipped and user systems are read by one loader, and differ only in where they came from

**Status:** Accepted · 2026-10-11 · answers ROADMAP Phase 7's "User systems load through *exactly* the same path as official
ones, clearly labelled" · builds on [0011](./0011-user-systems.md), [0031](./0031-a-system-is-chosen-and-it-scopes-everything.md),
[0087](./0087-starting-equipment-is-a-data-file-beside-the-system-and-money-is-counted-in-the-units-the-system-declares.md),
[0102](./0102-an-overlay-is-a-patch-applied-to-its-parent-on-every-load-and-validated-as-the-system-it-makes.md),
[0103](./0103-a-system-error-says-where-in-the-file-by-line-and-by-the-ids-written-there.md),
[0104](./0104-a-new-system-starts-from-a-file-the-app-writes-and-a-copy-keeps-what-it-was-copied-from.md),
[0105](./0105-a-stat-name-one-slip-from-a-declared-one-is-a-warning-when-a-system-loads.md) · **format:** unchanged

## Context

ADR 0011: "Official and user systems load through exactly the same code path. The only difference is where the file came
from and how it is labelled. If official systems ever get a capability user systems lack, that is a bug." Both have always
reached `validateGameSystem`, the one validator. What happened around it was traced, file to `GameSystem`, in the desktop
(`boot.ts`, `App.tsx`, `UserSystemStore`), the phone (`boot.ts`) and the tests (`node-system.ts`).

**Measured, before this ADR:**

| step | shipped | the user's |
|---|---|---|
| read | a bundler JSON import, parsed: no text | `readJsonText`: positions recorded |
| reader | three copies: desktop `loadShippedSystems`, phone `loadShippedSystems`, tests `loadShippedSystem` | `UserSystemStore.load` and `.add` |
| validate | `validateGameSystem(value, schemas)`, no parent | the same, with shipped and the user's complete systems as parents |
| overlay | a shipped overlay would be refused (no parent) | applied, complete systems first |
| warnings (ADR 0105) | computed by the validator and dropped | located and listed under the card |
| problems (ADR 0103) | no line (no text) | line and column |
| starting equipment (ADR 0087) | checked against the shipped system it names | handed over through the lineage (ADR 0104) **unchecked** |
| form map (ADR 0079) | checked on its own; nothing in it depends on the system's definition | handed over through the lineage, the same |
| sources (ADR 0031) | `sourcesForSystem(lineage)` | the same |
| failure line | "Fix what is listed and add the file again", which a shipped file cannot be | the same, right |
| label | none | a "yours" badge, Remove; an overlay's "Built on …", a copy's "A copy of …" |

Two of these were the "capability" ADR 0011 calls a bug, one in each direction, and one had a consequence a user would meet:

- **A user's version of 5e was given 5e's starting equipment without being asked whether it fits.** An overlay that keeps
  silver as its standard (gold removed, platinum a hundred silver) validates; the builder offered a Fighter 5e's wealth roll
  in gold, took it, and wrote `money: { gp: 150 }`, which `validateCharacter` against that system refuses. The shipped file
  had only ever been checked against 5e.
- **A shipped definition could not be an overlay of another shipped one**, which a user's can.

The rest are the same path not quite being the same: warnings computed and dropped, problems without lines, three readers.

## Decision

1. **One loader reads every definition**, `packages/ui/src/system-loading.ts`. `readSystemDefinition(source, schemas,
   parent)` parses a definition's text with `readJsonText` (or takes a parsed value where the caller has no text), validates
   it with `validateGameSystem`, and locates its errors and warnings with `describeSystemErrors`. `loadSystemDefinitions`
   reads a set, complete systems before overlays, every complete system already loaded (and any `bases`) a possible parent.
   `UserSystemStore.load` and `.add`, the desktop's and the phone's `loadShippedSystems` and the tests' `loadShippedSystem`
   all call it. A shipped definition now publishes its warnings (none today, held by a test), and may be an overlay of
   another shipped one.
2. **The desktop reads a shipped definition from its text**, Vite's `?raw`, so a problem in one has a line, as a user's
   does. The phone's Metro gives JSON as a value; its shipped problems still have no line. That is the one difference left,
   and it is in where the bytes come from, not in the path.
3. **`systemCatalog(shipped, user)` puts the two together** and labels each system and failure by `origin`, `'shipped'` or
   `'user'`: the one difference ADR 0011 allows. The launcher renders it and computes nothing.
4. **A file shipped beside a system is checked against every system its lineage hands it to.** `startingEquipmentFits(file,
   system)` is the system half of `checkStartingEquipment` (the file is the system's or an ancestor's, its kind and steps
   exist there, every unit is one the system declares), asked of the shipped system when the file is read and of each
   user's system that would receive it. `startingEquipmentFor` (the builder's choice) offers a file only when it fits; one
   that does not offers nothing, and `systemCatalog` adds a warning to the card for each distinct reason: "The starting
   equipment that comes with Dungeons & Dragons 5th Edition does not fit this system, so none is offered: "gp" is not a unit
   of money the system declares." The form map has no system half and is unchanged.
5. **"Clearly labelled" is what the cards already show, plus the failures.** A user's system keeps its "yours" badge and its
   Remove, an overlay its "Built on …", a copy its "A copy of …" (ADRs 0031, 0102, 0104); a shipped one carries no badge,
   since ADR 0011 asks that user systems be marked, not official ones. What was wrong was the failure line: a shipped
   definition that does not load now says it comes with Incudo and that the copy of the app is faulty, and only a user's says
   to fix the file and add it again (`systemFailureNote`, `systemOriginLabel`).

## Consequences

**Good**
- A user's version of a game can no longer write a character its own system refuses through a file it did not author.
- Every reader of a system definition is one function, so a step added to it (a new kind of warning) reaches shipped and
  user systems alike without being remembered three times.
- The tests read the shipped systems as the apps do, from text, through the same loader.

**Bad / accepted**
- **A user's system cannot ship starting equipment or a form map of its own.** It receives its lineage's when they fit and
  none otherwise. That is authoring, and waits with the rest of "Systems for authors" (ROADMAP 1.x).
- **A card's warning about starting equipment sits under "This file loaded. … worth checking"**, though the file itself is
  well formed: it is the file's changes that make the shipped one not fit, which is the author's to know.
- The phone has no user systems (the maintainer's call); its shipped loading goes through the same loader all the same.

## Evidence

`tools/verify/src/system-loading.test.ts`, against the real schema and the shipped definitions' text: the shipped set loads
from text with no warning and no failure; 5e with a slip gives the same warnings at the same lines shipped as added by the
user; a broken definition is located by line and labelled by origin, the same problems either way; a shipped overlay of 5e
loads; the catalogue labels every system and a user's copy of 5e differs from 5e only in its id; an overlay that changes
nothing is offered 5e's starting equipment, the silver overlay none (its Fighter's purse empty and the character valid) with
the card's warning. Each fails under its named perturbation: warnings not published, positions dropped, no parent for an
overlay, no origins, the builder choosing by lineage alone, no card note. `npm test`: 1,694 pass, 0 fail. Driven in the
browser build: the launcher with the silver overlay ("yours", "Built on …", the warning) and a broken user file (its line
and the user's sentence), the user files written into the app's storage as `UserSystemStore.add` writes them. Not driven:
the Tauri window, a broken shipped definition in the running app (held by the test only), the phone.
