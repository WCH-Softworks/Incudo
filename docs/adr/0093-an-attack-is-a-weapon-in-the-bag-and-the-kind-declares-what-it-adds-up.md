# 0093 — An attack is a weapon in the bag, and the kind declares what it adds up

**Status:** Accepted · 2026-10-06 · answers ROADMAP Phase 4's "Attacks on the sheet" · builds on
[0003](./0003-system-agnostic-content-model.md), [0005](./0005-aurora-import.md),
[0012](./0012-self-contained-saves.md), [0020](./0020-stats-keyed-on-declared-blocks.md),
[0022](./0022-kinds-contribute-systems-do-not-ship-content.md), [0023](./0023-attunement-gates-and-reports.md),
[0024](./0024-inventory-is-a-list-of-instances.md), [0025](./0025-slots-publish-tags.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0044](./0044-hit-points-follow-the-method-the-character-uses.md),
[0069](./0069-what-a-description-embeds-is-shown-in-place-and-a-save-carries-it-for-its-text.md),
[0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md) and
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md)
· **format:** one optional field on a character kind and one on a sheet section in the system definition, and `as:
"number"` on a `setter` expression (`formatVersion` stays 1); one rule in the form map (its `formatVersion` stays 1);
none for characters

## Context

A player character's sheet had no attacks. ADR 0074 left them out with hit dice and death saves ("play-time state or text
nothing records yet"), and ADR 0073 left a held creature's `companion:attack` and `companion:damage`, which the Ranger's
Companion writes, read by nothing. The official 2014 form's three weapon rows were filled with the names of what the
character holds in its hands and nothing else.

### What content says

Measured by `tools/verify/src/attacks.test.ts` on AuroraLegacy/elements at `c28ce6c`, reported as `ℹ` lines.

- **97 `Weapon` elements**, each with a `damage` setter (its die, `1d8`, with the damage type as an attribute,
  `type="slashing"`), a `slot` (61 `onehand`, 36 `twohand`) and a `proficiency` setter naming one declared element (97 of
  97, never two). 15 carry `versatile` (the two-handed die), 57 `range` (every ranged weapon, and 18 thrown melee ones).
  **No weapon carries a rule** and none an enhancement.
- **What kind of weapon it is is a support tag**: `ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE`, `…_SIMPLE_RANGED`, and the
  2014 properties (`…_PROPERTY_FINESSE`, `…_THROWN`, `…_TWOHANDED`, …). **30 of the 58 distinct tags name no element**, among
  them every category, damage type and 2014 property: Aurora's app names them. The 2024 masteries (Sap, Vex, Slow), the
  firearm properties and the weapon groups are elements of type `Weapon Property` (85 tags) or `Weapon Group` (11).
- **292 `Magic Item`s adorn a weapon** (a `weapon` setter naming the categories it may adorn, ADR 0024's adorner), 177 with
  an `enhancement` setter (+1, +2, +3) and 77 with a `name-format` ("{{parent}} +{{enhancement}}"). The enhancement is a
  setter, never a rule: nothing adds it to anything.
- **What content adds to attacks is character-wide and named by the kind of attack or the weapon**: `ranged:attack` +2
  (Archery, twice, and a UA feature), `<weapon name>:attack` (Blade Mastery's `longsword:attack`, Fell Handed's, 12 rules)
  and `<weapon name>:damage` (Bracers of Archery's `longbow:damage` +2). Dueling's `melee:damage` is commented out
  upstream. Everything else that names an attack is a feature's own number (`sneak-attack:count`) or a casting block's.
- **The Ranger's Companion is the one writer of `companion:attack` and `companion:damage`** (each `= proficiency`), and
  every creature's actions print their own numbers in prose.

### What Aurora records

**Every save has an `<attacks>` block**, and six samples have rows in it, eight rows in all: name, range ("5 ft",
"150/600"), bonus ("+6 vs AC"), damage ("1d8+3 slashing"), the ability used, and the weapon's properties as words
("Ammunition, Heavy, Two-Handed"). **A row is written for every weapon in the bag, carried as well as equipped** (a
Barbarian's carried Greataxe, a 2024 Ranger's carried Longbow), and a versatile weapon once or twice (one sample has the
two-handed die as a second row). **All eight agree with the book**: the ability modifier (Strength, Dexterity for a ranged
weapon, the higher for finesse), plus the proficiency bonus when the character holds the element the weapon's
`proficiency` setter names, plus `ranged:attack` for a ranged weapon; the damage the die plus the same modifier. None is
enhanced, none uses a weapon-named stat, none is a finesse weapon whose holder has more Strength than Dexterity: the
samples referee the common case only.

### What the form takes

The 2014 form's attack boxes are three rows of `Wpn Name`, `Wpn1 AtkBonus`, `Wpn1 Damage` (and the same for 2 and 3,
some with trailing spaces in their names), and one large `AttacksSpellcasting` box.

## Decision

### 1. An attack is a bag entry of a type the kind names, carried or equipped

A kind may declare `attacks` (system format, optional, replaced along `extends`). Every inventory entry whose element is
of one of its `types` is an attack, in bag order, **whether equipped or carried**, as Aurora's sheet lists them and as a
printed sheet's attack rows are written. A kind with no `attacks` has none. 5e's `pc` declares `"types": ["Weapon"]`; the
NPC does not (a creature's actions are its attacks, printed).

What an attack is called is the entry's own name when the user gave one, else the first adornment's `nameSetter` with
`{{parent}}` the weapon's name and `{{x}}` the adornment's own setter `x` (5e: `name-format`, "Longsword +1"), else the
weapon's name.

### 2. The kind declares what an attack adds up, as contributions in an attack's own scope

`attacks.stats` is a list of contributions, `{ stat, value, requirements? }`, the shape of a kind's `contributions` (ADR
0022), evaluated **once per attack, after the derivation's fixed point**, in the order written. An attack stat is the sum
of the contributions to it; a reference reads an attack stat summed so far, else the character's. `attacks.bonus` and
`attacks.damage` name the two the sheet shows.

Inside that scope:

- **The attack's tags** are published under `attacks.tagStat` (5e: `weapon`): its weapon's and its adornments' support
  tags and names, lowercased. A requirement reads them as a slot's are read (ADR 0025): `[weapon:ID_INTERNAL_WEAPON_PROPERTY_FINESSE]`.
  Every other requirement reads the character, its slots included.
- **`{name}` and `{<setter>}` are placeholders** in a requirement and in a reference's stat, as a block's are in
  `blockStats` (ADR 0020): `{name}` is the weapon's name lowercased (`longsword:attack`), `{proficiency}` its
  `proficiency` setter, so a requirement of `"{proficiency}"` is "the character holds this weapon's proficiency". A
  placeholder the weapon does not answer drops the contribution.
- **A `setter` expression may read `as: "number"`**: the sum of that setter's numbers over the weapon and its
  adornments (5e: `enhancement`). An adornment that needs attunement on an entry not attuned is not read (ADR 0023).

No derived stat of the character moves, no problem is added, and what a weapon is (melee, ranged, finesse) is the
system's reading of content's tags: core names no ability, property or category.

5e's declaration: the ability modifier is Strength's, Dexterity's for a weapon tagged simple or martial ranged, the
higher of the two for a finesse one; the bonus is that, plus `proficiency` when `{proficiency}` is held, plus the
enhancement, plus `ranged:attack` for a ranged weapon, plus `{name}:attack`; the damage modifier is the ability
modifier, plus the enhancement, plus `{name}:damage`.

### 3. The die, the type, another die, the range and the properties are read off the weapon as written

`attacks.dice` names the setter holding the damage die and `damageType` its attribute naming the type; `alternatives`
names setters holding another die with the same modifier and what to call it (5e: `versatile`, "two-handed"); `range`
the setter shown as its range. None of these is parsed: the die is written as content writes it and the modifier after it
("1d8+3 slashing"), so `1` and `—` stay as written (ADR 0005). `properties` names the element types a support tag names a
property by (5e: `Weapon Property`, so the 2024 masteries and firearm properties read as content names them) and, as
`labels`, what a tag that names no element is called (5e: the 2014 properties, which only Aurora's app names). A tag
neither answers is not shown. Properties are listed by name.

### 4. A sheet section lists the attacks, and the document carries them

A sheet section may declare `attacks: true` (the validator refuses it on a kind with no `attacks`): it lists the
character's attacks, each as `SheetAttack` (name, bonus signed, damage, the alternatives, the range, the properties,
whether it is equipped). 5e's `pc` has an Attacks section after Combat. The Sheet pane, the print layout, the Markdown
export and the phone draw it from the sheet document and word it with one function (`attackAside`, beside `listedHead`):
"Longsword: +6, 1d8+3 slashing (two-handed 1d10+3 slashing; Versatile)".

### 5. The form's weapon rows are the first three attacks

A form map rule `{ "attacks": { "section", "rows": [{ "name", "bonus", "damage" }] } }` fills each row from one attack,
in order; an attack past the last row is named in what the fill leaves off, never squeezed in. It replaces the rule that
wrote the hands' contents into the name boxes. `AttacksSpellcasting` stays empty, as before.

### 6. A held creature shows what its holder adds to its attacks

5e's held-creature scope (ADR 0073) labels `companion:attack` and `companion:damage` and shows them in a section of its
stat block, only where they are not 0, saying that its actions print their own numbers without them. Its action text is
not rewritten: it is prose (ADR 0005). A system definition change only.

### 7. A save carries what its attacks name

`collectCharacterContent`, given the kind, embeds the elements an attack-type entry's support tags name of the
properties' types, **for their names only** (ADR 0069's text-only frontier): a 2024 Shortsword's Vex reopens as Vex with
no source. `DerivedCharacter.attacks` is in `summarize()`, so every test that reopens a save with no source compares it.

## What this does not do

- **Unarmed strikes, a Monk's martial arts, a spell attack as a row, natural weapons.** Content writes `martial
  arts:attack` and `unarmed:attack` as features' own numbers with no weapon behind them; a row needs an element in the bag.
- **Two-weapon fighting, Dueling, Great Weapon Fighting, extra attacks, critical ranges.** Nothing content writes as a
  number reaches an attack (Dueling's rule is commented out upstream), and a rule about which hand holds what is the
  user's to apply.
- **Ammunition, reach as a distance, a thrown melee weapon's two modes.** The range is the setter as written; a melee
  weapon without one shows none, where Aurora writes "5 ft".
- **Rewrite a held creature's actions with its holder's bonus**, or give a creature's scope attacks of its own.
- **Name an adorned item that way in the inventory.** Only an attack's name reads `name-format`.
- **Referee an enhancement, a weapon-named stat, a finesse weapon held by a stronger character or a magic weapon's own
  rules.** No sample has one; they are held by unit tests and perturbation.

## Alternatives considered

- **Attacks as character stats (`attack:<instance>:bonus`).** They would move `summarize()`'s stats for every armed
  character, sit in the namespace content writes into, and need instance ids in stat names. A scope evaluated after the
  fixed point publishes the same numbers and moves no stat.
- **Derive each weapon again, as a held creature is (ADR 0073).** A full derivation per weapon to evaluate a dozen
  contributions, and content's own rules would read a weapon scope nothing in content writes for.
- **Only equipped weapons.** Aurora writes a row for a carried weapon, and a player reading the sheet wants the
  greataxe on their back.
- **A row per die**, as one sample's two Longsword rows. The other three Longswords have one; the two-handed die beside
  the one-handed is the same fact once.
- **Name the 2014 properties from their ids** (`…_PROPERTY_TWOHANDED` → "Twohanded"). A guess at a spelling ("Two-Handed")
  that the system can state.
- **Write the overflow into `AttacksSpellcasting`.** It is the form's free-text box for whatever the player writes; a
  fourth attack is named as left off instead.

## Evidence

Each test names the perturbation that fails it, and each perturbation was run. Measured first and committed before any
code (`attacks.test.ts`, its first four tests).

- `tools/verify/src/attacks.test.ts`, after the measurement: **every weapon in each sample's bag is an attack on its sheet,
  in bag order, and all eight rows Aurora recorded agree** with the sheet's bonus, one of its damages and its properties
  by name ("Finesse, Light, Vex"). Perturbed, each failing it: the proficiency term, `ranged:attack`, the property labels,
  the property types, the finesse rule, and Dexterity for a ranged weapon each removed from the declaration. A 2014 Beast
  Master built through the builder shows its companion's "Added by Its Holder" rows, +2 and +2; removing the section or
  the stats' labels fails it.
- `packages/core/src/attacks.test.ts`: types, carried and equipped, bag order, an unresolved entry; the tag stat read by
  a requirement; `{training}` filled exactly (an id compares exactly) and a missing setter dropping the contribution;
  `{name}` in a reference; an attack stat read before the character's; a number setter summed over adornments and an
  unattuned one not read; the name from the user, an adornment's naming setter and the element; die, type, other die,
  range and properties as written. Perturbed: tags not published (7 failures), the requirement filled lowercased (3),
  adornments not read (5), an unattuned one read (3), references not filled (3), property types not read (3), attack
  stats not read first (9). Lowercasing a reference's stat is not caught: every context lowercases stat keys anyway.
- `packages/ui/src/sheet-attacks.test.ts`: the engine publishes attacks and moves no stat of the character (the stat keys
  are the same with and without a declaration); a section listing attacks is drawn when it lists nothing else; the damage
  wording; `attackHead` and `attackAside`; the Markdown, escaped. Perturbed: a section with only attacks dropped as
  empty; a name written unescaped.
- `packages/ui/src/form-fill.test.ts`: a section's attacks fill their rows in order and a third past two rows is named;
  perturbed, a damage box given the bonus and the rule's fields not checked against the form's.
  `tools/verify/src/pdf-sheet.test.ts` now reads the weapon boxes from the attacks: 6 samples filled, 24 empty, none with
  more than three.
- `tools/verify/src/schemas.test.ts`: an undeclared attack type, a condition that will not parse, and a section listing
  attacks on a kind with none are refused; the shipped declaration and a `setter` read as a number are accepted.
- **A reopen with no source**: `sheet-export.test.ts` compares every sample's Sheet packed and reopened with no source, and
  it fails when the property elements are not embedded (a 2024 Shortsword loses Vex); `summarize()` carries the attacks.
  The same test's personal-text check exempts an `attacks.*` value the sheet's own attack writes (Aurora copies a weapon's
  properties into the save's freeform; the sheet names them from content and the system).
- The oracle's thirty-sample table is **identical** before and after (`INCUDO_ORACLE_SNAPSHOT` on the measurement commit,
  `INCUDO_ORACLE_BASELINE` after the engine change, same checkout). `npm run typecheck` and `npm test` pass.
- **Driven in the browser build** (an origin-private folder standing in for the folder picker, and no content source
  ever added): Sample 15 and Sample 09 packed by the repository's own code, and a 2014 Human Beast Master Ranger 3 built
  through the builder with a +1 rapier, a carried longbow and a carried dagger. With no source: "Longbow: +9, 1d8+4
  piercing (range 150/600; Arrow; Ammunition, Heavy, Slow, Two-Handed)" and "Shortsword: +7, 1d6+4 piercing (Finesse,
  Light, Vex)"; "Rapier +1: +3, 1d8+1 piercing (Finesse)"; the baboon's "Added by Its Holder" rows. No console errors. Not
  driven: the phone.
- Driven in the Tauri window on Windows (2026-10-20; a fresh WebView2 profile and a scratch library folder, DOM events over the debug port, real keys and mouse where marked): a new Wizard's starting dagger and quarterstaff, the staff given +1 by "Attach a magic item…", read "Dagger: +4,
  1d4+2 piercing (range 20/60; Finesse, Light, Thrown)" and "Quarterstaff +1: +5, 1d6+3 bludgeoning (two-handed 1d8+3
  …)"; the print dialog opened on them, the PDF export held them, and the official form's three weapon rows were filled
  with them, the cantrips past the third named as left off.
