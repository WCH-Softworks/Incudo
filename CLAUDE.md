# Incudo — working notes for Claude Code

A system-agnostic tabletop character builder for desktop and mobile. Free, MIT, open source.
A replacement for the discontinued Aurora Builder that reads its entire content ecosystem.

**Read first:** `ROADMAP.md`, then `docs/ARCHITECTURE.md`, then the ADR whose number a task
cites. `docs/adr/README.md` is the index. The ADRs record *trade-offs*, not just choices —
when something here looks odd, the ADR usually says why.

## Commands

```bash
npm install            # ~25s. If it starts pulling Expo, apps/mobile got added to workspaces — don't.
npm run desktop        # the app, at http://localhost:5173. No Rust, no icon, start here.
                       # Opens on the character library; pick a folder to see anything in it.
npm run desktop:app    # the real Tauri window — needs Rust. Builds now; the icon arrived.
npm run typecheck      # tsc --build --force
npm test               # node --test, no build step
npm run incudo -- --help   # the CLI: validate | types | inspect | system | content | character
npm run incudo -- validate <index-url-or-local-path> [--strict] [--json]
npm run incudo -- system validate systems/dnd5e/system.json
npm run incudo -- character show <file.incu>   # derives from the save alone — ADR 0012
npm run incudo -- aurora inspect <file.dnd5e>  # what a save contains, without importing
npm run incudo -- aurora import <file.dnd5e> <out.incu> --index <index>
npm run incudo -- aurora verify <file.dnd5e> --index <index>   # diff against Aurora's own maths
npm run fixtures:rebuild   # regenerate tools/incudo/fixtures/aelin/ after a format change
```

The real regression suite is the CLI against the full Aurora corpus. A complete Aurora install
already exists on this machine and works **entirely offline**:

```bash
npm run incudo -- validate \
  "C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index" --aurora-folder
# 740 files, 12,058 elements (+83 generated), 0 errors, 1 unresolved, ~1.5s
```

`--aurora-folder` resolves files the way Aurora's downloader stores them (a folder per index,
files by `name`); `--local [--root DIR]` resolves them by repository path, for a git checkout.
They are different layouts — see docs/AURORA-FORMAT.md. Do not use one for the other.

Add `--offline` to make that enforceable. `LocalMirrorFetcher` falls through to the network
when a file is not in the mirror, which is right for a partial mirror and quietly wrong
everywhere else: an "offline" run that silently fetches proves nothing. With `--offline` a
miss is a named error giving both the URL refused and the mirror path checked. The command
above passes all 740 files with `--offline`, so that corpus really is complete.
Nine real Aurora saves sit beside it as `*.dnd5e`. They stay **local and out of the repo**:
read them for verification, never commit them or their contents.

## Hard constraints

**No TypeScript syntax Node cannot strip.** No parameter properties
(`constructor(private readonly x: T)`), no `enum`, no `namespace`, no decorators. Write the
field and assign it. This is why tests and the CLI run with zero build step — do not trade it
away. Relative imports use the `.ts` extension; `tsc` rewrites them on emit.

**Layering** (`docs/CODE-REUSE-POLICY.md`) — enforced, not aspirational:

| layer | may import | must never import |
|---|---|---|
| `packages/core` | stdlib only | anything platform-shaped |
| `packages/aurora-import`, `packages/content` | `core` | `fs`, `fetch`, `window`, Tauri, Expo |
| `packages/ui` | the above + `react` | `react-dom`, `react-native` |
| `apps/*` | everything | — |

`core` and `content` take injected `Fetcher` and `Storage`. Adding a runtime dependency to
`core`, `content` or `aurora-import` needs an ADR.

**No game-specific nouns in `core`.** If you are about to write `strength`, `spell` or
`armor class` outside a test fixture, you are in the wrong package. Element types and stats are
opaque strings declared by `systems/<id>/system.json` (ADR 0003).

**Characters store choices, never derived numbers** (ADR 0006) — with two exceptions, both
inputs with no formula: recorded random results (`rolls`, ADR 0007) and starting values the
user set (`baseStats`, ADR 0014). `baseStats` is a *base* that contributions add to;
`overrides` wins over everything and is a repair tool, not a place to put ability scores.
`inventory` (ADR 0024) is an input of the same family — what the user is carrying, which no
formula produces — and it is a list of instances rather than a set of element ids.

**A save must open with zero content sources** (ADR 0012). `.incu` is a zip embedding the
element subset the character uses, plus assets as real bytes. This is the product requirement,
not an optimization — if a change makes a save depend on configured sources to open, it is wrong.

**Aurora is import-only and frozen when done** (ADR 0008). No export. No speculative support.

**Nothing is ever published to npm.** Every package stays `"private": true`. The `@incudo/`
prefix is a local workspace naming convention, not a registry claim — the app is the product,
and the packages exist to organise it. Do not add `publishConfig`, a release workflow, changesets,
or per-package versioning, and do not remove `private`. If someone else claims the `@incudo` npm
scope, that is fine and changes nothing here.

That does **not** mean nothing is a public API. Two things are, and they need real versioning
discipline: the **system definition format** (users author these — ADR 0011) and the **`.incu`
save format** (users' own files — ADR 0012). Both carry `formatVersion`. Package versions do not
matter; those two do.

**Never generate artwork.** No AI-generated images, logos, icons, textures or sample art, not
even as a temporary placeholder. This is a stated project commitment in the README, not a
preference. If a visual asset is needed, leave a clearly-marked gap and say so — do not fill it.
Diagrams drawn in code (SVG, Mermaid) and UI built from CSS are not artwork and are fine.

The one gap this ever blocked is now filled by a person: `brand/` holds the real logo, and
`apps/desktop/src-tauri/icons/` is generated from it with `npx tauri icon`. **Downscaling and
re-encoding supplied art is not generating it**, and neither is deleting the mobile and
Windows-Store variants that command also writes. Compositing the glyph onto a coloured tile
*would* be a design decision, which is why it has not been done and is named as an open one
instead — see that directory's README. The two source PNGs were re-encoded on the way in (4.67 MB
each, stored uncompressed, down to 24 KB and 14 KB) and the decoded pixels are byte-for-byte
what was supplied.

## Baselines that must not regress

Content corpus: **740 files · 12,058 elements (+83 generated) · 0 errors · 1 unresolved
reference · 23 unmeetable requirements · 57 warnings.**

- **1 unresolved reference** — one upstream typo, `…VULNERAILITY…`. This is a *grant* to an
  id nothing declares, which means a character silently loses something. It is the only one
  left in 12,058 elements, and it should be 0 the day AuroraLegacy fixes the spelling.
- **23 requirements that can never be met** — reported, deliberately **not** budgeted. A
  requirement naming an id nothing declares is a membership test that reads false, and
  `!ID_X` against an id that will never exist is how the corpus says "unless the 2024
  replacement is in play". Five of the six `KNOWN_UPSTREAM_TYPOS` live here.
- **83 generated elements** — what Aurora's app materializes at runtime, supplied by
  `packages/aurora-import/src/generated-elements.ts`. Not counted in the 12,058, because
  they do not come from a file. It was 80 until the importer started reading `<equipment>`
  and found three more that only a *bag* names (ADR 0024's step 2).
- **57 warnings** — 56 `<grant>` elements with no id, and one id defined in two files.

This used to read "57 unresolved references, 57 warnings, equal by coincidence". Both halves
of that changed: the overlay resolved 51 of them, and splitting grant references from
requirement references separated one real breakage from twenty-three deliberate ones. The
coincidence is gone; do not go looking for it.

CI enforces this as a **budget, not a target**: `validate` takes `--max-unresolved`,
`--max-warnings`, `--expect-files` and `--expect-elements`, and the numbers live in
`.github/workflows/ci.yml`. Moving one is a deliberate edit to that file. The `--expect-*`
pair is not redundant — a corpus that failed to check out loads nothing, and nothing has no
unresolved references.

Aurora saves: **all 9 import; 1 element-missing, 0 spell-missing, 0 stat-mismatch**, and
**55 element-extra**, with **3 not-modelled** and **13 content-missing** reported and not
counted. All **8 recorded spell slot rows are compared and agree** since ADR 0018 — they used
to be 8 of the not-modelled notes, which is where 59 became 51. Since ADR 0020 the **8 save
DC rows and 8 attack rows** are compared against stats Incudo publishes rather than against a
formula the verifier owned.

**51 not-modelled became 3, and 53 element-extra became 55, with inventory step 3.** 47 of the
notes were "this element came from the bag" and one was "the bag moves this DC"; all 48 are
comparisons now and all 48 agree — including the eighth DC pair, the Tome of Clear Thought
wizard, whose Intelligence comes out 22 for a DC of 18 and an attack of 10. The two new extras
are one finding: a **Mithral Armor** adornment suppresses its host armour's
`ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE` grant inside Aurora's app and in no content file, with
Vigaro's mithral-less plate as the control case that proves it is suppression rather than
absence. Left visible rather than guessed at. Do not re-derive the old 51/53 from a stale doc.

Of the other 53 extras, the eight original saves are single-classed and contribute 52, all one
species — content AuroraLegacy added *after* those saves were written, confirmed against
upstream commit dates.

The ninth was built to be the multiclass oracle the other eight could not be (level 20
Paladin 2 / Warlock 18, two `<magic>` blocks). It accounts for the rest: one extra, a
darkvision grant that post-dates it, and the single **element-missing** —
`ID_INTERNAL_MULTICLASS_LEVEL_3`, an Aurora-app marker referenced by nothing in the 740
files and carrying no rules. That one is honestly unmodelled rather than budgeted; inventing
a rule for it would be the guess ADR 0005 rules out.

`incudo aurora verify` classifies all of them; see docs/AURORA-SAVE-FORMAT.md. Those files
are personal data and never enter the repo — and neither do screenshots of them.

## State of play

Working: core engine, Aurora content **and save** importer, content sources, CLI, two system
definitions, the `.incu` container, the JSON Schemas and the validator behind them, the whole of
the inventory work — a bag, slots, `equipped=`, attunement and a derived armour class —
**spell selection, filtered by list, school and slot level** (ADR 0030), and
**the desktop shell, which runs**: `npm run desktop` opens on a **character library** (ADR
0027), manages content sources (ADR 0028/0029), builds a character, **sets its ability scores by
all four of 5e's methods**, renders the sheet, reads and writes real `.incu` files into a folder
the user picks, and **imports Aurora `.dnd5e` saves into it**.
Not started: the mobile shell (only its `platform.ts` contract exists).

**A budgeted step's editor is a renderer over `BudgetState`, and everything it needs is in
`packages/ui/src/budget.ts`.** What a value costs, where the next step lands, whether the pool
covers it, which of six values is still unplaced, what a swap should move, what a change of
method keeps — all of it there, under `node --test`. `apps/desktop/src/panes/BudgetEditor.tsx`
computes nothing, which is CODE-REUSE-POLICY rule 2's stated test kept honest: "point buy let me
spend 28 points" is fixable in a package. Four things decided rather than fallen into:

- **A points method seeds every target at the cheapest value it prices.** Without it a target
  nobody touched has no base, and the derivation reads the stat's declared `default` — 10 in 5e,
  *higher* than the 8 point buy gives away free. A set nobody bought, that looks legal. The
  decision stays open on the unspent pool, which is what `BudgetState`'s two openness conditions
  were always for.
- **An assignment method swaps; it never duplicates.** Dropping the 15 on a target while another
  holds the only 15 hands that one whatever this target held.
- **A change of method keeps only what the new method can express**, and that is a rule about the
  *mode*, not the number: point buy and the standard array start clean because they are
  authorities on their own values, and free entry keeps what it is given. The case that forced it
  is the common one — every imported Aurora character has six real scores and **no recorded
  method**, so a blanket clear would have destroyed all nine sample characters' scores the moment
  someone touched "enter manually".
- **Rolling is in `packages/ui/src/dice.ts`, above the engine and below the shell.** ADR 0019
  forbids core learning to roll (a derivation runs on every keystroke, so a roller it could reach
  would eventually be called by one); `"4d6dl1"` is declared in `system.json`, which makes
  parsing it a rule about the game and not a component's business. `rollBudget` fills only the
  unrolled slots and the state a view reads is a pure function, so **no repaint can reroll**.

**The app asks which system before it shows anything, and that answer scopes the library**
(ADR 0031, amending ADR 0027). It used to import one `system.json` and print "Dungeons &
Dragons 5th Edition" in the header to a user who had chosen nothing. Four things follow, and
three of them are correctness rather than presentation:

- **A source belongs to a system**, recorded when it is added and **never inferred**. Nothing in
  a content index says which game it is for — an Aurora `.index` has no field for one and the
  format is frozen — so `sourcesForSystem` reads what the user said. An untagged source (any
  profile written before ADR 0031) belongs to *nothing* and is offered for assignment rather
  than counted as the current system's; counting it would put another game's content into a
  character and freeze it there when the save is written (ADR 0012).
- **A system card is written for a player, and `description` is user-facing prose.** It used
  to render 5e's "the one Incudo is tested against… see docs/adr/0003" on the launcher.
  Maintainer notes go in `systems/README.md`; nothing on a card cites an ADR. `logo` is
  optional, a **reference** rather than inline bytes (ADR 0007), and a card with none draws
  nothing — never a generated stand-in.
- **A user can add a system**, which ADR 0011 has promised since Phase 0 and nothing implemented.
  `UserSystemStore` (`packages/ui`) validates a picked `system.json` through the same
  `validateGameSystem` everything else uses, **revalidates on every load** rather than trusting
  the add-time verdict, refuses an id the app ships, and encodes the storage key — `remove` and
  `has` take an id from a caller, and a `Storage` key becomes a file path under `NodeStorage`,
  whose sanitiser permits `.` and `/`.
- **A system definition may `suggest` sources**, which is what keeps the tagging invisible: a
  user who clicks Add on 5e's AuroraLegacy suggestion has said which system it serves by
  picking it. `official` is a claim by whoever wrote the system definition, not a check by
  Incudo, and the UI has to say *who* is vouching.
- **A source is keyed on its URL**, so it can belong to one system at a time. Adding one that
  another system holds is refused with a sentence rather than silently retagged.
- **`Shell` is keyed on the system id.** Switching rebuilds every piece of per-system state.
  Same class of bug as the `use-builder.ts` memo that made "New character" do nothing.

**The library is the part to understand before touching the shell.** It is a folder the user
chooses, scanned on open, with no index file and no database — the folder *is* the list, because
the user edits it directly. Since ADR 0031 it publishes only the chosen system's characters —
and **keeps the whole scan privately**, which is not tidiness: `freeName` picks a filename
nothing on disk is using, and asking the *filtered* list would let a new D&D character be
written over a Cairn one of the same name. `LibraryState.elsewhere` counts what the filter
hides, because a folder of nine characters reading "nothing here yet" is indistinguishable from
having picked the wrong folder. `CharacterLibrary` (`packages/ui`) is the view-model; `CharacterStore`
(`core/platform.ts`) is the port, with three implementations: Tauri's dialog and fs plugins,
the browser's File System Access API, and a `node:fs` one that exists only in a test. **Listing
and opening reach for no source, no index and no fetcher**, which is ADR 0012 being used rather
than merely proved; two tests hold that line, one with a fake store and one over the nine real
saves. If either starts needing content loaded, the feature is wrong.

**Importing is the one library operation that does need content, and that is not a contradiction.**
A `.dnd5e` records Aurora's element ids and nothing about what they mean, so an import resolves
them against a corpus and copies what they name into the container; with no source enabled the
app says so rather than writing a character full of ids nothing can resolve.
`importAuroraSaveIntoLibrary` (`packages/ui/src/aurora-import.ts`) therefore takes an
`ElementIndex` and `character-library.ts` still takes none — keep it that way. Reading the file
itself is a fifth port, `FilePicker`, deliberately *not* a method on `CharacterStore`: every
method there means "inside the folder the user chose", and an import is one file outside it,
read once and forgotten. Two steps inside that function fail silently if dropped — the
`LayeredElementIndex` overlay of `imported.generated`, and `imported.extraIds` — so
`aurora-import.test.ts` asserts both by reading the container back with zero sources, and both
assertions were checked by perturbation.

**Two crashes ADR 0031 introduced and running it found, both in the first two minutes.** A
switch to Cairn killed the app with `System "cairn" has no character kind "pc"`: `choose()` set
the system and *then* awaited the character, leaving one render where the two disagreed and
`useBuilder` resolved a 5e kind against Cairn. And the same index was offered as a suggestion
while also listed as unassigned, with an Add button that would have retagged it in place. No
test had either, because every test builds one system's character against that system.

**Run the app before trusting this file about what works.** Every phase up to the shell was
verified against fixtures, a corpus and an oracle, and the first five minutes of actually using
it still found a view-model bug that no test had: a required build step with nothing picked
reported itself `complete`, so there was no way to choose a race or a class at all. Usability is
only testable by using it — see `apps/desktop/README.md`. It keeps paying: the library work
found three real bugs this way and **none of them had a failing test first** — a character
saved from the app recorded no sources at all, so ADR 0028's warning could never fire; nothing
loaded content at startup, so a reload left the builder empty until you visited Sources; and one
of the nine real portraits is a **JPEG**, which both halves of the library had assumed was a
PNG. The `.dnd5e` import kept the run going: importing one save twice, a minute apart, gave
**250 elements embedded and then 227** — a `packages/content` cache bug three subsystems away
that no count anywhere could have shown. What the shell has surfaced and not fixed is under
"Known from running it" below.

**The ability score editor found three more, and one was data loss.** Both of the serious ones
were in `apps/desktop/src/use-builder.ts` and had been there since the file was written.
Enabling or disabling a content source replaces `elements`, which rebuilds the `CharacterBuilder`
— **from the shell's `working.character`, which is the character as it was opened and is never
written back to.** Six scores, a race and a class silently back to straight 10s, with the
autosave then writing the reversion over the draft, so reloading did not bring it back. It ate a
character mid-session. And **"New character" did nothing at all**, because the memo saw the same
system and the same index; opening from the library only ever *appeared* to work, since a save
carries embedded content and so changed `elements` by accident. The hook now resumes from the
builder's own state and keys on `character.id`. Twelve green test files cover this code and none
of them rebuilds a builder mid-edit, which is the whole lesson: **the tests protect the rules,
running it protects the product.**

### Known from running it

- **~~`<select supports="$(...)">` still offers nothing.~~** Fixed (ADR 0030), and the shape
  of the fix is worth knowing before touching a filter. Resolving the interpolation was one of
  **four** things, and on its own it would have changed nothing visible: three separate defects
  in the `supports` language had to go first. `||` bound *tighter* than `,` (it is the looser
  operator, as in `requirements`); parentheses were never parsed at all, in 131 of the corpus's
  2,466 `supports=` attributes; and an operand could not name a **setter's value**, which is
  where a spell keeps its level and its school, so no levelled select could ever have matched
  however well the `$(…)` resolved. Those three alone take the interpolation-free select
  filters that match nothing from 343 to 124.
  Do not read a green `aurora verify` as evidence about any of this: it compares the elements
  a character *chose*, so a filter resolving to **everything** would move no count anywhere.
  The evidence is measurement and perturbation — see ADR 0030's numbers, and the engine tests
  that remove each half of the resolution and assert the list gets wider.
- **~~Loading a content index re-fetches every file.~~** Fixed (ADR 0029). The app composes
  `LayeredContentSource(cache → http)` now, so the cache `writeThrough` was already writing is
  finally read back. Measured in the running app: 18.4 s cold for 238 files, **0.5 s** on a
  reload, and 11.1 s after an explicit Refresh, which is how you can tell an eviction really
  happened.
- **~~A corpus read from that cache was not the same corpus.~~** Fixed, and worth remembering
  how it was found. `CachedContentSource.loadFile` returned everything the network layer did
  **except `appends`**, so all 171 `<append>` blocks were dropped on every load after the
  first. Nothing said so: same 740 files, same 12,058 elements, same 57 warnings — what changed
  was what a character's elements could *reach*. It surfaced as one Aurora save importing
  "250 elements embedded" and then 227 a minute later, and it would have written short saves
  for every user from their second session on, which is the ADR 0012 failure exactly. The
  lesson is the one ADR 0008 already recorded about `<supports>`: **counts do not catch a
  reachability bug**, so `compose.test.ts` now asserts the two layers *agree* rather than that
  the cache answers.

Ten things the shell has surfaced, two of them since fixed and struck through. The rest are
deliberately **not** fixed:

- **~~An answered `pick` cannot be changed.~~** Fixed. It was predicted here to be "a real screen
  rather than a two-line fix" and it was one `continue` becoming a branch: `BuilderState.picks`
  publishes the settled half of a top-level pick — rule key, what is chosen, what could be
  chosen instead — exactly as `steps[].budget` already did for a settled budget, and the pane
  renders "Choices already made" beside "Values already set". Candidates are rebuilt on every
  read rather than remembered, so a replacement is filtered against the character as it is now.
  **This is not a Back button and ADR 0017 is untouched**: a settled pick is not somewhere you
  navigate to, it is something on screen that kept its control. The pane's header comment had
  been using "no Back button" as cover for the hole, which is how it survived.
- **~~A decision could only ever record one element, and disappeared once it held enough.~~**
  Fixed in two passes, both found live rather than by a test. First: a player chose a Skill
  Proficiency after a Sage background, and a second pick left the *first* one stuck on screen
  with no way to add to it — `choose(id, [value])` replaces, so `BuilderPane` was always sending
  a single-item array and `setChoice` always overwrote whatever was there. `OpenDecision` gained
  `chosen: ElementId[]` alongside `candidates` (ADR 0032's decision 1, landed ahead of the rest
  of that ADR), and the pane's write while a pool is open became
  `choose(id, [...decision.chosen, value])` — "replace" for a `pick`, where `chosen` is always
  `[]`, and "add to" for a `select` asking for more than one, with no branch needed between the
  two. Second, reported once the first fix made it reachable: filling the *last* slot made the
  whole decision vanish, exactly the hole ADR 0017 had already fixed for a top-level pick — a
  second Skill Proficiency had nowhere to be changed once chosen, any more than Race did before
  `picks` existed. The engine gained `answeredChoices` beside `pendingChoices`, publishing every
  slot's answer and what any one slot could hold instead once a pool has nothing left to
  choose — `pendingChoices` itself is untouched, so the CLI and the self-containment test needed
  no changes — and `packages/ui` folds these into the same `picks`/`SettledPick` array a
  top-level pick already used. A full Skill Proficiency now renders in "Choices already made"
  exactly like Race: one `<select>` per filled slot, independently changeable, each excluding
  every *other* slot's current answer so two slots can never agree on one. The engine's
  candidate-and-remaining math needed nothing for either pass — `candidatesFor` and `remaining`
  already handled a multi-element `Choice` correctly, proved by a same-render three-answer test
  that predates both fixes — so both bugs were entirely in the pane and in what the engine chose
  to publish once a pool closed.
- **The character sheet renders no features, traits, proficiencies or languages.**
  `SheetPane.tsx` does `if (!stats.length) return null`, and the `features` and `proficiencies`
  sections declare `types` with no `stats`, so they are dropped whole. The CLI renders them
  (`character-commands.ts`, `derived.elements.filter(e => section.types.includes(e.type))`), so
  a level 1 wizard's sheet reads eight proficiencies and two class features there and six
  ability scores and some numbers in the app. Same shape as every other divergence here: the
  pane reimplements a slice of what the CLI already does properly.
- **A granted ability point is unspendable except under a points method.** `BudgetState.granted`
  reports it and the editor shows it, but only a cost table says what a point buys, so a
  standard-array or rolled character cannot spend one. Inventing "a point is +1" is the guess
  ADR 0005 rules out. It fires zero times today: nothing in the 740 files contributes to
  `ability points`, and a 5e ASI is a `+1` straight to the stat.
- **Scanning a library reads every container in full.** There is no manifest-only fast path,
  because the zip codec inflates the whole archive — nine saves is imperceptible, two hundred
  will not be. Same for the portrait bytes a grid holds in memory. ADR 0027 names the
  mitigation (a summary and thumbnail cache keyed by path and mtime) and deliberately does not
  build it.
- **Nothing moves a recorded source version.** ADR 0028's `moved` state is computed and shown,
  and the "refresh this character against the newer source" flow it points at does not exist,
  so a character says a source has moved until someone builds that.
- **Importing N saves rescans the library N times.** `CharacterLibrary.save` refreshes after
  every write, because the collision suffix reads the current listing — so importing the nine
  real saves reads 45 containers. Imperceptible at nine and the same root cause as the entry
  above it: there is no manifest-only fast path. Not fixed, and not worth fixing before the
  summary cache ADR 0027 names.
- **Three `supports` operands are still unread, and are reported rather than guessed at**
  (ADR 0030, ADR 0005). `!` **negation** inside a filter — 13 uses, read as a literal tag, so
  `Artificer Infusion, !TCOE Base` offers an empty list; unambiguous and simply not done, and
  the obvious next one. `Ritual` — 17 uses, where a spell carries `<set name="isRitual">true</set>`
  and Aurora evidently maps a true boolean setter to a tag named after it; deriving the tag name
  from the setter name is a guess with no second witness. `Class` — 15 uses, on the level
  4/8/12/16/19 ability score improvement, matching no tag on any of the 12,058 elements and no
  setter's value at all. The shell shows "No candidate in the loaded content matches this
  choice" for these, which is honest but not the whole truth.
- **There is no export.** Saving writes into the library folder; "save a copy somewhere else"
  needs a write counterpart to `FilePicker` and does not exist.
- **An NPC or legendary creature has no way to set ability scores.** Both kinds declare a
  required `abilities` step with `"types": []` and **no `budget`** — the inert shape ADR 0017
  names, which matches no pending choice and reports itself complete. The editor is a budget
  renderer and knows nothing about 5e, so this is one `budget` block per kind in
  `systems/dnd5e/system.json` with `manual` as its only method (a monster's scores are printed,
  not bought). Left unwritten while the phase is about a PC.

ADRs 0007, 0009, 0012, 0014, 0015, 0016, 0017, 0018, 0022, 0023, 0024, 0025, 0026, 0027, 0028, 0029, 0030 and 0031 are implemented; **0032 is proposed, and its `OpenDecision.chosen` half is now
built** — the multi-pick bug it names is fixed, but `multiple: true` on a build step (campaign
options) is not. Read the ADR's status note before reaching for a multi-select anywhere. Phase 1
is done — **`packages/aurora-import`
is frozen to bugfix-only** (ADR 0008). `GameSystem` declares `characterKinds[]`, each owning its
`buildSteps`, `sheet`, element types, baseline `grants` and `progression`
(level | rating | xp | none); `Character` has `kind`, `progress`, `rolls`, `baseStats`,
`advancement`, `generation`, `inventory` and `assets`. A `.incu` is a zip of `manifest.json` + `character.json` + `content.json` + `assets/`,
readable and writable as an unpacked folder too, and `incudo character verify` proves a save
re-derives identically with zero sources configured.

Three things Phase 1 changed that are easy to trip over:

- **A character kind carries a baseline.** `kind.grants` plus `progression.elementIdPattern`
  give every character elements nobody chose — the 5e base armour class, one `ID_LEVEL_N` per
  level. They are *not* stored on the character, so `collectCharacterContent` needs the kind
  passed in or the save will not embed them and ADR 0012 quietly breaks.
- **`packages/aurora-import` supplies 83 elements no content file declares.** The 5e system
  definition names seven of them in `kind.grants`. That coupling is deliberate — 5e content in
  this project *is* Aurora content — but it is why a missing kind grant warns rather than errors.
  The last three arrived with the bag: Aurora's inventory proxies, which only a real
  `<equipment>` block names.
- **Five Aurora constructs were being silently dropped**: element-level `<supports>`
  (3,611 blocks — *every* support tag in the corpus), element-level `<requirements>` (1,845),
  `<append>` (171), `equipped=` (79, none of which is `"true"`, all read as `false` — fixed by
  ADR 0021), and `<spellcasting><list>` (17, fixed by ADR 0030 — the tag
  `$(spellcasting:list)` needs, which had never reached the engine). Every one was found by
  counting what the corpus contains rather than by reading the format. See
  docs/AURORA-FORMAT.md.

**The builder has no current step** (ADR 0017). `CharacterBuilder` publishes `decisions` — one
flat, always-current list — and `steps` is a grouping with `available`/`blockedBy`, not a
sequence to walk. There is no `goToStep` and no Back button; `focus()` is presentation and
nothing depends on it. A decision opened at level 4 arrives in the same list as every other.
`Character` gained a sixth input, `generation`, recording which method a budgeted step used.
A budget is written through `setBudgetStat`, `adjustBudgetStat`, `rollBudget`, `clearBudgetRolls`
and `setGenerationMethod` — all validated, all on the builder. `setBaseStat` still exists and
bypasses every rule; it is for a caller that has no budget, not for an editor.

**Hit points are the one number no oracle checks** (ADR 0019). Aurora's saves record the
per-level rolls and never the total, so `aurora verify` has nothing to diff. Do not describe
`hp` as verified; it is derived from the published rule and from the rolls, and that is all.

Two things ADR 0018 added that are easy to reach for wrongly:

- **A `table` expression, and `trackStats` on a character kind.** `trackStats` is the piece
  ADR 0015 stopped one step short of: for every track the character has, if `when`'s element
  is in that track, contribute `value` to `stat`, with `track:progress` reading that track's
  own count and `{name}` in `stat` making it per-track instead of an aggregate. Reach for it
  whenever the answer is "once per class" and the system cannot name the classes — hit points
  are the next one.
- **Content already declares a great deal of what looks missing.** Every casting class in the
  corpus ships its own slot table as level-gated `<stat>` rules, and its weighting as a marker
  grant. Before modelling a number Aurora computes, grep the 740 files: twice now the answer
  has been "content says it and Incudo was not reading it".

**A `select` pool is keyed on (element, name), not on the rule.** Aurora writes a growing
allowance as several same-named `<select>`s, one per level that widens it — a warlock's
cantrips are `number="2"` at level 1 plus one each at 4 and 10 — and the allowance is their
sum. The importer has always keyed a `Choice` that way (`<owner>/select:<name>`, the only key
`setChoice` and a builder's `OpenDecision` can address); the engine used to check each rule's
own `number` against the whole list, so every imported caster reported errors it had not
earned. Do not reintroduce per-rule quotas. What is genuinely lost is which slot a pick was
made under: 89 groups in the corpus have rules that differ in `supports`, `requirements` or
`type`, so a pending pool offers the union of the candidates of the rules with room left, and
nothing checks that a recorded pick was legal for its slot. See docs/AURORA-FORMAT.md.

**A pool never offers what the character already has.** `candidatesFor` has always excluded a
pool's own `chosen`; `collectPendingChoices` widens that to every element the character holds,
which is the only place the question can be asked — a background's "two languages of your
choice" is a support-tag select and a race's Elvish is a plain `<grant>`, and neither file can
know about the other. An Elf taking Sage sees 41 languages rather than 43, without Elvish or
Common, and still owes two. The case that looks like a counter-example is not: a rogue's
Expertise offers `ID_EXPERTISE_SKILL_ACROBATICS`, whose requirement is the *different* element
`ID_PROFICIENCY_SKILL_ACROBATICS`, so wanting what you have is expressed by needing what you do
not. **`aurora verify` cannot see any of this** — it compares elements a character chose, not
ones it was offered — so a green run is not evidence; perturbation in `engine.test.ts` is.

**A slot publishes a set of tags, and `equipped=` is evaluated** (ADR 0025, step 4). A character
kind declares its `inventory`: which slots exist, what stat each publishes into, which setters
become tags, and which setter marks attunement. Core says none of `body`, `armor`, `primary`,
`versatile`, `any` or `none`. Four things to know before touching it:

- **Three kinds of question, one syntax.** `[armor:heavy]` reads a setter's *value*,
  `[primary:versatile]` reads a setter's *presence* (its value is a die), and
  `[primary:double-bladed scimitar]` reads the element's *name*. That is why a slot publishes a
  set and `equals` became a membership test — string equality stays for the corpus's other 8
  `equals` checks, all `type =`, and there are **no `flag` checks anywhere**.
- **A slot's `stats` list is its capacity.** One stat holds one item, so `["primary",
  "secondary"]` is two hands and a slot with no stats holds any number of cloaks. Nothing had to
  guess a capacity, which is the whole reason that field does not exist.
- **The equipment state is resolved once, before the fixed point.** Occupancy depends on the bag
  and the index and never on the derivation; a tag set hung on a `ResolvedStat` would be a pass
  behind. Do not move it into the loop.
- **A kind with no `inventory` ignores `equipped=`**, exactly as a kind with no progression
  ignores `level=`. Evaluating with no slots is the state ADR 0021 measured and refused: every
  positive check false, every negation true.

The corpus carries 79 `equipped=` attributes and **78 reach the engine** — the 79th is Dueling's
`melee:damage`, commented out upstream.

**Nothing moved when this landed, and that is worth almost nothing.** Before it, all 78 rules
applied unconditionally, so evaluating can only ever *remove* a contribution. Only eight
conditions exist across the nine saves (a monk's Unarmored Defence and its five movement modes,
the Defense fighting style twice) and all eight are true; nobody in the corpus of saves carries a
shield, so `[shield:any]` has never been true. **Perturbation is the evidence**, and it lives in
`packages/core/src/equipment.test.ts` and the engine tests. Do not cite the green `aurora verify`
run as proof the gating is right.

**A bag is a list of instances, and the container embeds all of it** (ADR 0024). `Character`
gained `inventory` and `character.json`'s `formatVersion` moved to **2** — the first time it has,
after `baseStats`, `advancement` and `generation` each stayed at 1. Readers accept both. Three
things in the shape are measurements, not taste: an entry is an **instance** (one save carries two
greatswords with different enchantments, so an element-keyed bag loses a real character's items);
`slot` is an **override** and normally absent (the saves' `location` agrees with the element's own
`slot` setter 15 times out of 15); and adorners **nest** with no id of their own (Aurora gives them
none, and minting one would make an import non-deterministic). `collectCharacterContent` seeds
from every entry **including the carried ones** — that asymmetry is deliberate, because only the
*equipped* ones will seed the derivation at step 3. Nothing derives from the bag yet, and
neither step 1 nor step 2 moved a baseline.

**The importer fills the bag, and `slot` is written zero times** (step 2). All 45 instances
across the nine saves come across — 26 equipped, 12 attuned, 15 adorners, 4 stacked rows, 1
user-given name — and every ADR 0024 measurement held on the real files, including the one it
offered as falsifiable: no recorded `location` ever disagreed with the element's own `slot`, so
the override is never written. `instanceId` is Aurora's `identifier` GUID, and an item without
one is numbered by its position rather than given a minted id, because minting would make
`aurora import` non-deterministic. An unrecognised `location` is reported and never written
through: Aurora's three location strings and content's 18 slot values are two vocabularies.

**Equipped derives, carried does not, and the bag is now a compared thing** (step 3).
`deriveCharacter` seeds from `equippedElementIds` next to the choices and the advancement — an
equipped entry's element and its adornments, once each however large `quantity` is. A carried
entry seeds nothing, while `collectCharacterContent` still embeds all of it; that asymmetry is
ADR 0024 decision 7 and is the half Aurora refereed, 26 of 26 equipped items in its `<sum>` and
18 of 19 carried ones outside it. Three consequences worth knowing before touching this:

- **`aurora verify` no longer excuses anything from the bag.** The `statsFromInventory`
  carve-out is gone, and with it the last two readers of `proficiency` and `abilityModifier` in
  the verifier's options — the file holds no arithmetic of its own at all now. The bag survives
  there only as a *hint* on an `element-missing` message, naming which pile the id came from.
- **An equipped plate's `ac:armored:armor 18` is summed since step 5**, and a barbarian in plate
  no longer *also* shows Unarmoured Defence, which is what step 4 fixed.

**The inventory work is finished — all five steps** (`docs/INVENTORY-AND-AC-PLAN.md`). Step 5
built ADR 0022's `contributions` and spent it on `ac` and on ADR 0023's attunement limit
(ADR 0026). Four things to know before touching the armour class:

- **`ac` is derived and checked by nobody**, exactly like `hp` (ADR 0019). No `.dnd5e` save
  records an armour class, so `aurora verify` gains no comparison and never will — a green run
  after changing the formula means nothing about the formula. Never describe `ac` as verified.
  The nine sample saves read 18, 18, 17, 18, 18, 13, 16, 20, 16; the evidence for those is the
  Player's Handbook worked by hand plus perturbation in `tools/incudo/src/armour-class.test.ts`.
- **It is six conditional rows, not the four the plan predicted.** A cap cannot express the
  Player's Handbook sentence that heavy armour *also does not penalise* a negative Dexterity
  modifier, so the term has a floor too. Both plate wearers in the nine have a Dexterity modifier
  of exactly 0 and both medium-armour wearers exactly +2, so **the saves cannot tell the six-row
  table from the four-row one, or the medium cap from no cap at all.** Do not read their
  agreement as evidence.
- **A contribution joins content's bonus buckets, it does not land after them.** That is the
  whole reason the field exists: 5e writes `ac:armored:dexterity:cap` 2 in `base` and Medium
  Armor Master writes 3, and the answer is 3. Summed afterwards it reads 5.
- **`pc`'s `ac` deliberately has no `default`.** The engine adds a `derive` on top of whatever a
  stat holds, so leaving the system-level `default: 10` in place would put a second 10 on every
  character. `npc` and `legendary` keep it and derive nothing — a monster's armour class is
  printed, not summed, and neither kind declares an inventory for `[armor:none]` to be about.

**An unattuned item contributes nothing, and says so** (ADR 0023). The gate landed at step 4 and
the **limit** at step 5, once `contributions` existed to hold the base of 3. All 12
attunement-requiring equipped items across the nine saves are attuned and none of the nine is
over the limit (1, 0, 1, 0, 3, 2, 1, 1, 3), so both halves fire zero times there — there is no
oracle and there cannot be one; do not describe either as verified. Three things the corpus
settled that are easy to miss: adorners are separate elements, so gating one gates the magical
half and leaves the greatsword a greatsword; `attunement:max` is already declared by content 11
times, in both `bonus="base"` override and unbucketed `+1` shapes, which both come out right
against a base of 3 contributed in the same bucket; and `attunement:current` is counted per
**entry** and only when the entry has something to be attuned to, because Aurora carries one flag
per instance and none per adorner. The prose in `addition="by a wizard"` is display text and is
never evaluated.

**Identity is embedded in a save; mechanics are not** (ADR 0022). `collectCharacterContent`
seeds from `baselineElementIds(kind, progress)`, so every element a kind grants is copied into
`content.json` and frozen there, while `system.json` is the one thing a save deliberately does
*not* embed. That is why all seven of the 5e kind's `grants` carry zero rules, and why only nine
of the overlay's 83 elements carry any — the six ability score improvements and the three
inventory proxies, where the rule *is* the identity. Put a game rule on an element and you have put it in every save written
before you fixed it. A kind's `contributions` is where a conditional baseline rule goes
instead, and **a system definition ships no content** — decided and closed, so do not reach
for `.incuset` when a system needs a rule.

**A declared block does four things, and the fourth is a filter** (ADR 0030). Three are the
stat keyings below; the fourth is that a `<select>` attached to a block may write its filter in
terms of what that block and the derivation publish. A kind's `blockFilters` says how a
`$(key)` expands: `tags` is a **fallback chain** over the block's name and attributes (first to
resolve wins, and the result is parsed as a sub-expression, because an Eldritch Knight's list is
`Wizard,(Abjuration||Evocation)`), and `tagsFromStats` globs stat names and turns positive
matches into an OR of their captures. `fillFrom` is not decoration: a warlock's pact table
publishes exactly **one** positive slot stat, and without filling downwards a level 18 warlock is
offered 5th-level spells and nothing else — the two real warlock saves hold levels 1 through 5.
Reach for `tagsFromStats` before recomputing anything; ADR 0018 already made every slot table
derive, and a second copy is the one that goes stale.
An expansion that finds nothing returns `NEVER_MATCHES` and is **not** reported as unresolved.
"You have no spell slots yet" and "Incudo cannot read this filter" are different sentences and
conflating them has already cost one wrong diagnosis.

**There are four keyings of a stat** (ADR 0020, then ADR 0022). A stat is contributed to a
character by content, or once per *track* (`trackStats`, ADR 0018), or once per *declared block*
(`blockStats`), or once by the *kind itself* (`contributions`). The fourth is the base case the
middle two are iterating specialisations of, and what it adds is a `requirements` — which is why
"a character wearing no armour has an armour class of 10" has a home and could not have had one
on an element. The third exists because the second cannot reach it: the namespace content
uses is the `<spellcasting>` block's name, and an Eldritch Knight's is `eldritch knight`
while its ADR 0015 track is `fighter`. `blockStats` substitutes `{name}` from the block and
`{anything else}` from the block's attributes — including inside a `ref`, which is how
`{ability}:modifier` becomes `charisma:modifier`. If a placeholder does not resolve, nothing
is contributed and the derivation says so.

**`aurora verify` used to mark its own homework on the save DC**, and the way it did it is
worth remembering before trusting the next agreeing number. It carried `saveDcBase: 8` and
compared its own `8 + proficiency + ability` against Aurora's `8 + proficiency + ability`.
That is real evidence about the modifier and the bonus and no evidence at all about the DC,
which did not exist. The 8 is now in `systems/dnd5e/system.json` and the check reads the
published stat. Both directions were proved live by perturbation, not by the check passing.

Two things that follow from the format work, for anyone changing this code:

- **The system format is now a public API in practice.** Breaking it again is expensive.
  `schemas/system.schema.json` is the contract; `packages/core/src/json-schema.ts` is the *one*
  validator the CLI and the app share. Do not write a second one.
- **`summarize()` in the CLI is the definition of "derived output".** The self-containment test
  compares it, so anything added to a derivation that depends on *what content is loaded* rather
  than on the character must stay out of it — candidate lists are the example.

## Conventions

- Small, focused commits. Explain what you tried that didn't work — often the useful part.
- Diagnostics over guessing: when content is ambiguous, report it, don't silently pick.
- When a decision would be expensive to reverse, write an ADR before writing the code.
