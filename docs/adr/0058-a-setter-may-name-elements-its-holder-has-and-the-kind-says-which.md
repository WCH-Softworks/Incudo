# 0058 — A setter may name elements its holder has, and the kind says which

**Status:** Accepted · 2026-09-25 · completes [0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md)'s
first gap · builds on [0005](./0005-aurora-import.md), [0009](./0009-character-kinds.md),
[0012](./0012-self-contained-saves.md), [0022](./0022-kinds-contribute-systems-do-not-ship-content.md),
[0032](./0032-a-build-step-may-offer-a-set.md) · **format:** an optional `setterGrants` on a character kind in the
system format (`formatVersion` stays 1)

## Context

ADR 0057 lets a DM start an NPC from a creature, and the NPC gets the creature's six scores, armour class, hit
points and speed. It does not get what the creature *does*. A creature names its traits, actions and reactions
in setters:

```xml
<element name="Triceratops" type="Companion" …>
  <set name="traits">ID_WOTC_MM_COMPANION_TRAIT_TRICERATOPS_TRAMPLING_CHARGE</set>
  <set name="actions">ID_WOTC_MM_COMPANION_ACTION_TRICERATOPS_GORE,ID_WOTC_MM_COMPANION_ACTION_TRICERATOPS_STOMP</set>
```

A setter is text. The engine gives a character an element only when a rule grants it or the user chooses it, so
Trampling Charge, Gore and Stomp never arrive, and the sheet's Traits and Actions sections stay empty unless the
DM finds them by hand in lists of every trait (146) and every action (204) in the loaded content. Aurora's app
evidently reads these setters in application code.

### What the corpus holds

Measured on AuroraLegacy/elements at `c28ce6c`, every setter on every element whose value contains an element id:

| setter | on | ids named | resolve | resolved to |
|---|---|---|---|---|
| `traits` | 109 `Companion` | 156 | 153 | 153 `Companion Trait` |
| `actions` | 136 `Companion` | 199 | 199 | 198 `Companion Action`, **1 `Companion Trait`** (the 2025 Quasit's Shapeshift) |
| `reactions` | 18 `Companion` | 18 | 18 | 18 `Companion Reaction` |
| `proficiency` | 97 `Weapon`, 88 `Item`, 27 `Armor` | 212 | 212 | 212 `Proficiency` |
| `weapon` | 37 `Magic Item` | 39 | 0 | — (weapon categories) |
| `armor` | 41 `Magic Item` | 41 | 0 | — |

- **Setters that name ids are not grants in general.** An item's `proficiency` names the proficiency needed to
  wield it, not one wielding it gives; a magic item's `weapon` and `armor` name categories nothing declares. A
  rule that read every id-shaped setter as a grant would hand every sword-holder a proficiency. Which setters
  grant is a statement about the content, so the system makes it, per setter and per element type.
- **Of the 376 ids creatures name, 373 resolve.** The 3 that do not are Boo's Astral Menagerie traits, named
  `ID_WOTC_BAM_…` and declared `ID_WOTC_MM_…`: an upstream typo, and the only traits no creature can reach.
- **Three ids end in a stray `>`** (the Tasha's Primal Companion's attacks) and resolve anyway, because upstream
  declares them with it. A reader that matched an id pattern would drop three attacks; the list is split on
  commas and trimmed, nothing more.
- **The 12 `<grant>`s the 141 creatures do carry all name something the setters also name.** Of the 373 named
  ids that resolve, those 12 are already granted and the other 361 are reachable only through the setters.
- 7 of the named elements carry rules (six `companion:<skill>:proficiency` sets on the Primal Companion's
  options, and a `soul bond:bonus`), so granting them also applies those, as a grant would.

## Decision

### 1. A kind may declare that a setter on an element of some types names elements its holder has

```jsonc
"setterGrants": [
  { "types": ["Companion"], "setter": "traits" },
  { "types": ["Companion"], "setter": "actions" },
  { "types": ["Companion"], "setter": "reactions" }
]
```

When the character holds an element of a listed type, every id in that setter's value (comma-separated, each
trimmed, empties dropped) is **granted by that element**, exactly as a `<grant>` it carried would be: reached in
the same expansion, on the same track, reported once as unresolved when nothing declares it, and gone when the
element is. It is unconditional, because a setter carries no `requirements` or `level`. Core names no setter and
no type. Replaced rather than merged along an `extends` chain, like `setterStats`.

A granted element keeps its own type. The Quasit's Shapeshift is a trait named in `actions`, and it appears
under Traits, as content declares it; requiring the type to match the setter would drop it.

### 2. One function, read by the derivation and by the save

`setterGrantIds(defs, element)` in `packages/core` is the only reader. The engine's expansion calls it beside an
element's `<grant>` rules; `collectCharacterContent` calls it for every element it collects when it is given the
kind, which `packCharacter` always does. A trait the derivation reaches and the save does not embed would open
without it from a save with no sources, which is ADR 0012's failure exactly; one function for both is how that
cannot drift. A save written before this change embeds none of these, and reopened with no sources it derives as
it did when saved; with its creature's source loaded it gains them, as a character does when content adds a grant.

### 3. The 5e NPC declares the three creature setters, and the player character declares none

The `npc` kind (and `legendary`, which inherits it) declares `traits`, `actions` and `reactions` on `Companion`.
The `pc` kind does not: a Beast Master holds its companion as an element, and granting the companion's bite to
the ranger would put the wolf's attack on the ranger's sheet. What a PC's companion is belongs to Phase 4's
"companions and sidekicks", which this does not decide. No player character derivation moves.

### 4. A set step does not offer what the character already has

A set (`multiple: true`, ADR 0032) offered everything of its types except what that step had itself chosen. With
the creature's Gore granted, the Actions step would still offer Gore. A set now leaves out every element the
character holds, which is the rule content `select` pools have followed since Phase 2 ("a pool never offers what
the character already has"). A DM who wants a second creature's attack still finds it; one who wants this one's
already has it.

## What this does not do

- **~~A trait cannot be taken away from an NPC.~~** Done by
  [ADR 0061](./0061-what-a-creature-gives-may-be-removed-from-its-npc-as-a-recorded-input.md), as the user's input and not as
  content cancelling content. As first written: It is granted, like a race's darkvision; there is no "suppress"
  for a grant (Phase 2's "one grant cannot cancel another"). A DM who wants a Triceratops without Stomp has, for
  now, no way to say so.
- **The 3 unresolved Boo's Astral Menagerie traits** are reported as unresolved on the NPC that holds the
  creature, as any dangling grant is. Not fixed; upstream's to fix.
- **The corpus budget does not count these references.** It reads content alone, with no kind, and setter grants
  exist only through a kind. The 3 are visible on the character, not in `corpus.test.ts`.
- **The creature's other setters** (`skills`, `saves`, `senses`, `languages`, damage immunities) are prose, and
  still not on the sheet.

## Alternatives considered

- **Any setter whose value is a list of resolvable ids is a grant.** Rejected by the measurement: 212 item
  `proficiency` setters resolve, and are requirements for using the item, not things it gives.
- **Copy the ids into the character as choices when the creature is picked.** It would record content in the
  character (ADR 0006), a creature corrected upstream would not correct its NPC, and picking a different creature
  would have to know which traits the DM had added and which were copied.
- **Have the importer turn the setters into `<grant>` rules.** The importer is frozen (ADR 0008), a `.incu`
  embeds parsed elements so every earlier save would keep the old shape, and whether a setter grants depends on
  the kind holding the element: the same `Companion` held by a ranger should not grant its bite to the ranger.
- **Show the named traits on the sheet without granting them.** The sheet would then show elements the character
  does not have, their rules would not apply, and the save would still not embed them.

## Evidence

- `packages/core`: `setter-grants.test.ts` — a named id is granted and reached, and gone when its holder is; an
  unresolved one is reported once; a declared type is required of the holder and not of what it names; a kind
  declaring none is unchanged; the ids are split on commas and trimmed, a stray `>` kept; and a character's
  content embeds what its holder's setter names, so it derives the same from its own save. Each fails when the
  engine's call or the collector's call is removed.
- `packages/ui`: a set leaves out what the character holds.
- `tools/verify`: `npc-creatures.test.ts` — for every creature in the current corpus, the NPC holds every
  resolving id its three setters name, and saved and reopened with zero sources holds the same elements; the
  unresolved are reported and printed, not pinned. The oracle over the thirty samples is compared by snapshot and
  baseline and does not move.

Measured after it was built, against AuroraLegacy/elements at `c28ce6c`: of the 376 ids the creatures name, every
one of the 373 that resolve is held by its creature's NPC and by that NPC reopened from its save with no source; the 3
that do not are reported unresolved on the NPC. The oracle's tables over the thirty samples are identical before and
after (snapshot on the base, baseline on the change). Each unit test was checked by removing the call it guards.

**Driven in the browser build only**, not the Tauri window, macOS or Linux, with an origin-private folder standing in
for the native folder picker. A Triceratops NPC arrived with Trampling Charge under Traits and Gore and Stomp under
Actions with nothing picked by hand; its Traits and Actions sets offered 145 and 202 options where they had offered
146 and 204, and Gore was not among them. Saved, the content source switched off (0 elements loaded) and reopened, it
showed the same stat block, traits and actions.
