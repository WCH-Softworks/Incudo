# 0101 — An Aurora save received on the phone is offered for import, and imported with the content a build loads

**Status:** Accepted · 2026-10-08 · answers ROADMAP Phase 6's "Import an Aurora save on the phone" · amends
[0099](./0099-a-file-shared-to-the-phone-is-added-as-a-picked-one-is-and-receiving-needs-the-app-s-own-build.md)
(decision 5: an Aurora save was sent to a computer) · builds on [0008](./0008-aurora-compatibility-frozen.md),
[0012](./0012-self-contained-saves.md), [0027](./0027-a-library-is-a-folder.md),
[0052](./0052-a-source-that-refers-to-content-no-enabled-source-has-is-reported-and-never-blocked.md),
[0055](./0055-a-source-records-the-parts-switched-off-and-the-load-skips-them.md),
[0086](./0086-a-phone-builds-and-edits-with-the-desktop-s-builder-its-content-loaded-when-a-build-opens.md),
[0100](./0100-on-a-metered-connection-the-phone-asks-before-a-fetch-that-downloads-a-source-and-the-mode-setting-goes.md) ·
**format:** none (no system or character format change)

## Context

ADR 0099 taught the phone to tell an Aurora `.dnd5e` from a character by its contents, and stopped there: "… is an Aurora
save. Import it in Incudo on a computer, then share the .incu file it makes to this phone." The reason given was content.
An import resolves the ids a save records against a corpus and embeds what they name (ADR 0012), and a phone loads no
content until a Build screen asks for it (ADR 0086). Since then the phone has learnt to load content in about 2.3 s once a
source is added and kept converted, and to ask before a download on a metered connection (ADR 0100). What stands between a
phone user and their Aurora characters is no longer the engine.

The desktop imports through `importAuroraSaveIntoLibrary` (`packages/ui/src/aurora-import.ts`), which needs an
`ElementIndex`, refuses an empty one, names the game from the file's extension, and returns a report with the ids nothing
loaded declares and the importer's diagnostics, which the desktop shows in a panel that stays until dismissed.

### Measured first

`tools/verify/src/phone-aurora-import.test.ts` (report-only) imports every sample through that function, against
AuroraLegacy/elements at `c28ce6c`:

| question | answer |
|---|---|
| With the whole corpus loaded? | 30 of 30 import. 22 name ids nothing loaded declares, 80 in all: content upstream renamed or removed since the saves (third-party weapon proficiencies, 2024 replacement markers), which the oracle reports as `content-missing`. Every save carries diagnostics, 178 warnings and no errors: an `<element>` with neither id nor `registered` (111), "not in the loaded content" (42), the runtime elements rebuilt (20), an unknown slot (4), one case-respelled id. Median 22 ms, slowest 39 ms in Node. |
| With only the core part loaded (every other part of AuroraLegacy switched off, ADR 0055)? | 30 of 30 still import, every one now missing something: 235 ids in all. ADR 0052's rule holds: reported, never blocked. |
| With nothing loaded? | Refused, as on the desktop: "Importing needs content loaded…", ending "(ADR 0012)", an ADR number on screen. |
| With a provider id for a name (`msf:44`, Android's Recent files, ADR 0099)? | **Refused**: "has no extension, so nothing in it says which game it is." The phone recognised the save by its contents and the importer then asks its name, which a phone often does not have. |
| A UTF-16 save? | Refused with a sentence: the importer decodes as UTF-8, finds no `<character>`, and says the file "did not read as an Aurora save". It never calls `TextDecoder('utf-16le')`, which throws on Hermes, so nothing throws. All thirty samples are UTF-8 with a byte order mark; no UTF-16 save has been seen, and none is supported. |
| What says which games read Aurora content? | The system format's optional `auroraTypeMap` ("only needed for systems that want to consume Aurora content"): 5e declares it, Cairn does not. |
| What would a first import cost? | Content is fetched when a source is **added** (ADR 0100). With a source already added, an import's load reads the cache (2.3 s converted, 6.6 s as files, ADR 0086). With none added, importing means adding one: AuroraLegacy in full, about 15 MB in 800 requests, 82 s here. |

## Decisions

1. **A received or picked Aurora save is offered for import, never imported unasked.** The alert that names what was
   received (`receivedView`) says "… is an Aurora save." and offers **Import** beside Close. The import reads content, and
   the first one may download a whole source, so it starts on a tap. The picker and a share answer alike, as ADR 0099
   decision 3 has them.
2. **The game is the file's extension when it has one, else the user's answer.** A name ending in a system's id is that
   system, and one naming a game this app does not have is refused with a sentence. A name with no extension (a provider's
   id, or none) is offered for the systems that declare `auroraTypeMap`: "Import it as a Dungeons & Dragons 5th Edition
   character?". The tap is the user saying which game, not Incudo guessing past the name, and the importer is then handed
   the file under a name ending in that system's id. No system declaring one: refused. Several: one button each.
3. **What the import needs is said before it runs** (`saveImportStep`, `packages/ui/src/received-saves.ts`):
   - the system has a source switched on: the import loads its content through `ContentSources.load` (the same load a
     Build screen makes and shares) and imports at once;
   - it has sources, all switched off: "Every content source for … is switched off. Switch one on in Content, then import
     again." with a button to the Content screen; nothing is switched on for the user;
   - it has none and suggests one: "Importing needs content for …. Add AuroraLegacy and import?" with ADR 0100's
     `addSourceNote` after it ("It is downloaded in full now.", and the metered sentence on a metered connection). Added
     kept converted, the default (ADR 0085), and changeable in Content afterwards; then the import runs;
   - none and nothing suggested: the same sentence, pointing to Content.
4. **A source switched on with parts off, or missing books, still imports** (ADR 0052): the result line says how many
   things the save uses are not in the content loaded, and that the character was imported without them.
5. **The import is the desktop's function**, `importAuroraSaveIntoLibrary`, through `CharacterLibrary.save`: a free name,
   never over a file, case ignored (ADR 0027). The result line says when the name was taken: "Imported Sample 01 as
   sample-01-2.incu; the library already had a file called sample-01.incu." Exactly one imported offers **Open**.
6. **The importer's diagnostics are shown on request.** The result alert says "The import noted N things." and offers
   **Notes**, a second alert listing them once each with their count, as the desktop's panel does. An alert cannot fold a
   list away, and 178 notes over thirty saves is the normal case, not a warning.
7. **While content loads, a line says so** over whatever screen is open, from `ContentSources`' progress:
   "Loading content to import Sample 01… 312 of 740", then "Importing…". Nothing on screen is replaced (ADR 0099
   decision 6).
8. **The desktop's empty-content sentence loses its ADR number**, which is no word for a user. The phone never reaches it
   (decision 3 is asked first) unless every file of every source failed to load.
9. **UTF-16 is not added.** It is refused with the importer's sentence on the phone and the desktop alike, and recorded
   here as what happens; supporting a save format Aurora never wrote would be the speculative support ADR 0008 rules out.

## Consequences

- An Aurora user can move their characters to a phone without a computer: share the `.dnd5e`, tap Import, and the first
  time add AuroraLegacy.
- The phone now loads content outside a Build screen, but only on a tap that says it will.
- `packages/aurora-import` is untouched; the import's words are `packages/ui`'s, and the shell computes nothing.

## Driven

In Node first: `phone-aurora-import.test.ts` imports every sample through `importReceivedSaves` under a provider id for a
name (`msf:N`) with the game answered, and each opens to the same sheet as the desktop's import of the same file, all
thirty.

Then on the Pixel 9 Pro emulator (Android 16), in the development build (ADR 0099), by `adb` taps, not a person's hands,
against AuroraLegacy as GitHub served it that day (`c28ce6c`, the commit `.corpus/` was at). Three samples pushed to
Downloads:

- **Shared from the Files app, no source added.** "An Aurora save … is an Aurora save." with Close and **Import**; Import
  asked "Add AuroraLegacy?" with "It is downloaded in full now." On LTE (Wi-Fi off) the same question ended with the
  metered sentence.
- **Picked from Recent files**, whose name is a provider id: "The file is an Aurora save."; Import asked "Import it as a
  Dungeons & Dragons 5th Edition character? The file's name does not say which game it is for."; then the same "Add
  AuroraLegacy?". **Add and import** downloaded and loaded the source (the line read "Loading content to import the file…
  615 of 799") and imported: "Imported Sample 01. One thing it uses is not in the content loaded, so it was imported
  without it. The import noted 5 things.", with Close, **Notes** and **Open**. Notes listed the five; Open logged the
  sheet as 7029 characters, sha256 `ca47e7d7…`, the desktop's import's exactly.
- **Three shared at once** (sample 01 again, 02, 03): "Aurora saves" and **Import 3 saves**; "Imported Sample 01 as
  sample-01-2.incu; the library already had a file called sample-01.incu", Sample 02 likewise beside an older file of its
  name (nine things missing), Sample 03. The three files, pulled back with `run-as` and opened in Node with the phone's own
  zip, give the desktop import's sheets: 7029 / `ca47e7d7…`, 9709 / `3f1ef986…`, 9616 / `842cc9db…`.
- **AuroraLegacy switched off**: "Every content source for Dungeons & Dragons 5th Edition is switched off. Switch one on
  in Content, then import again.", whose Content button opened the Content screen.

**Timings.** On a freshly booted emulator, an import with the source kept converted took 6.3 s from the tap: 3.6 s
loading content, 2.7 s importing and writing. The first runs were on an emulator that had been up for hours and was
swapping (172 MB free of 3 GB): the first download and load took 9 min (82 s in ADR 0086), a cached load 67 s and each
import about 25 s. Those are the machine's, not the code's, and are recorded so nobody reads them as a regression.

**Found by driving it, and changed:** the notes alert had only Close, so reading the notes lost the Open button; it has
Open too. A share that arrives while another app is in front shows its alert a few seconds after the app comes forward,
once the bundle has settled; nothing was lost.

**Not driven:** Expo Go (the same code; it receives no share, and its picker was not run for this), "Open with", the
`no-source` sentence (no shipped game reading Aurora content suggests no source), a real phone, iOS, a release build.

## Not done

A real phone; iOS; a release build; choosing how the added source is kept from the import's question (it is the default,
changeable in Content); importing a UTF-16 save.
