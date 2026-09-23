# Sample saves — the plan

**For the maintainer, sitting in Aurora.** Twenty-one characters to build by hand, each ten to fifteen
minutes, in the order below, and nine optional short ones after them. Nothing here needs code: it is a
shopping list, written so you can follow it without opening any other file.

## Purpose

Every test that runs against real Aurora saves today runs against *your* saves, so it runs on one
machine and skips everywhere else — CI included — and a skipped test is a green one. These samples
replace them: **generic, anonymous characters, committed to the repository, that every test and every CI
run reads.** They are built to close the gaps the ten saves you have leave open (the matrix below), each
one aimed at a behaviour the engine has never been shown a real Aurora answer for.

Once they exist, the tests stop depending on a personal Aurora install, ADRs can cite them as evidence,
and anyone who clones the repository can run the same oracle you do.

## Conventions (apply to every sample)

**Before the first one.** In Aurora, update all content from the official index (Aurora Legacy) and check
that *Player's Handbook (2024)* and *Tasha's Cauldron of Everything* are there. Then, on the Sources tab,
**leave every source enabled**. A save records what you *disabled*, and a long exclusion list is what
makes a save three megabytes; with nothing disabled it is a few dozen kilobytes, and twenty-odd files
stay cheap to keep in git.

**Per sample.**

- **File name** `sample-NN-<short-descriptor>.dnd5e` (the descriptor is in each heading), saved into
  `tools/verify/fixtures/saves/`.
- **Character name** exactly `Sample NN` (`Sample 07`). Leave the player name, gender, age, height,
  weight, eyes, skin, hair, backstory, notes and quest **empty**.
- **No portrait.** Do not pick a picture, and if Aurora offers a default one, remove it. A portrait is
  megabytes of image data and the path it was loaded from is written into the file.
- **No custom item names, no item notes.** Items keep the names content gives them.
- **Content: the 2014 printing** (*Player's Handbook*, *Dungeon Master's Guide*, *Tasha's*, …) unless the
  sample is marked **2024**. With every source enabled, Aurora offers many things twice (the 2014 and the
  2024 Paladin, the two Shields); take the one whose source matches. Where content has three Artificers,
  take *Tasha's*.
- **Options:** the campaign options listed in the sample, and **nothing else** — the Options tab may
  remember the last character. `Feats` and `Multiclassing` are separate options; a sample says which.
- **Ability scores:** the method and the numbers in the sample. The save records the six scores it ended
  with and **not the method**, so a rolled or point-buy sample tests the numbers (odd scores, a 15 before
  racial bonuses), not the method.
- **Hit points:** *average* at every level unless the sample says *rolled*. (Level 1 is the die's maximum
  either way.) Where a sample is rolled, click Roll once per level and **keep what it gives you**.
- **Bag:** exactly the gear a sample lists, and delete what Aurora adds by default. An empty bag is a
  fine bag.
- **Personality, ideal, bond, flaw:** take the first entry of each list. They are tables of content, not
  free text.
- **A build line names an option as Aurora shows it.** If Aurora refuses a choice (a prerequisite the
  sample missed, a name it does not offer), take the nearest legal one and **write the substitution
  under that sample in this file**. The tests read the saves, not this document, so a substitution
  costs nothing; a silently wrong sample costs a day.

**Languages.** Take the ones a sample names. Otherwise, wherever a race or background offers a language,
choose in this order and take the first the character does not already know: Elvish, Dwarvish, Draconic,
Gnomish, Halfling, Orc, Sylvan, Undercommon.

**Multiclassing and proficiencies.** A class entered after level 1 gives only its *multiclass*
proficiencies, so no skill picks at all for most classes (the Rogue and the Ranger give one skill). A
sample lists exactly the skills that apply.

**The standard array** is 15, 14, 13, 12, 10, 8. **Point buy** is 27 points, so
`15,14,13,10,10,10` and `15,15,15,8,8,8` are both exactly 27. **Human (standard)** adds +1 to all six
scores and asks for one extra language (take Elvish). Every array below is *before* racial bonuses.

**Optional, and your call — a readout.** Aurora's file never records hit points or armour class, but its
screen shows them. If you also write down, per sample, **hit points, armour class, speed and (for a
caster) how many spells Aurora lets you prepare**, in a short file `READOUT.md` beside the saves, those
numbers become the only referee `hp` and `ac` have ever had. They are typed by a person from a screen, so
the tests would label them as such. The samples where this matters most say so.

## What the ten saves you have cover, and the gaps

The ten are described here **only by class split**, as reported. They are personal data and stay out of
the repository; this table is why the samples exist and goes stale the day they land.

| # | class split |
|---|---|
| 1 | Cleric 8 (Life) |
| 2 | Monk 5 (Sun Soul) |
| 3 | Paladin 2 / Warlock 18 (Hexblade) |
| 4 | Rogue 8 (Scout) |
| 5 | Warlock 12 (Hexblade) |
| 6 | Wizard 8 (Evocation) |
| 7 | Bard 8 (Eloquence) |
| 8 | Fighter 12 (Eldritch Knight) |
| 9 | Wizard 12 (Bladesinging) |
| 10 | Wizard 4 / Rogue 4 (Arcane Trickster), built from `tools/verify/src/rogue-wizard-build.ts` |

| Behaviour that is not pinned | Ten saves | Closed by |
|---|---|---|
| A half-caster at an **odd** level inside a multiclass (rounding down vs up) | Paladin 2 rounds the same either way | **02**, 17 |
| The **Artificer**: its own block, its round-**up** multiclass rule, infusions (`!` negation in a filter) | none | **01**, **03** |
| Full + half + third caster together; **three ordinary blocks** | Wizard/Rogue has two | **04** |
| Two ordinary blocks **beside pact magic**, with a third-caster; the `Ritual` filter | none (Paladin/Warlock has one ordinary block) | **05**, 06 |
| Two half-casters (rounded per class, or on the sum) | none | 18 |
| **Interleaved** class levels, and a **first class** other than the one the levels end on | blocks only | **06** |
| Every class once: **Barbarian, Druid, Ranger, Sorcerer, Artificer, a Paladin above level 2** | none of the five | 01, 02, 10, 11, 12 |
| **2024** editions (half-casters from level 1, background ability scores, weapon mastery) | none | 17, 22–30 (and 15, 16) |
| Whole-list preparer (Cleric/Druid/Paladin/Artificer); spellbook preparer with **`prepared` set**; `always-prepared` | one Cleric, two Wizards; **no test reads the flags** | **07**, **08**, 01, 03, 12 |
| Fewer spells prepared than the maximum; prepared ≠ known | none | **08**, 07 |
| **Level 1** and **level 20** extremes; a full slot table to 9th; 19 rolled hit dice | level 18 at most | **07**, **08**, 20 |
| **Feat vs ability score improvement**, and a half-feat that also raises a score | eight of the nine took a feat | **07** (ASI only), 09, 10, 06 |
| A **variant Human / Custom Lineage**, a racial cantrip from the class's own list | one variant Human | 11, 08 |
| **Rolled** hit points | rolls exist in the saves | **09**, 20 |
| **Armour of each weight and a shield**: nobody wears a shield; a **negative** Dexterity modifier in heavy armour; a Dexterity modifier **above the medium cap** | both plate wearers at +0, both medium wearers at exactly +2 | **09**, **10** |
| **Magic armour with an adorner**, and attunement **at** the limit of three (and one over it) | attuned items, none over | 13, 21 |
| **Unarmoured Defence**: Barbarian (never seen), and both at once | Monk only | 11, 19 |
| Campaign option combinations: Feats + Multiclassing; Customized Ability Score Increases / Proficiencies / Language | Feats, multiclassing | 06, 11, 12 |
| A **single-class subclass caster at an odd level** (spells known, own slots) | Eldritch Knight 12 is even | 14 |

Ability-score *methods* are deliberately not in that table: the file does not record one.

## The order, and what is what

**P1** closes a named "not pinned" item or a hole in the armour derivation: build these first, in order.
**P2** broadens classes, options and 2024. **P3** is edge cases and optional.

| P | # | file | what it is | levels |
|---|---|---|---|---|
| 1 | 01 | `sample-01-artificer-5` | Artificer, Alchemist, infusions | 5 |
| 1 | 02 | `sample-02-paladin-3-sorcerer-3` | half-caster rounding | 3 + 3 |
| 1 | 03 | `sample-03-wizard-4-artificer-3` | Artificer round-up | 4 + 3 |
| 1 | 04 | `sample-04-wizard-4-paladin-3-fighter-3` | full + half + third, three blocks | 4 + 3 + 3 |
| 1 | 05 | `sample-05-wizard-3-rogue-3-warlock-3` | two blocks + pact + third | 3 + 3 + 3 |
| 1 | 06 | `sample-06-rogue-4-wizard-4-interleaved` | interleaved levels, Rogue first | 8 |
| 1 | 07 | `sample-07-cleric-20-war` | level 20, whole-list preparer, ASI only | 20 |
| 1 | 08 | `sample-08-wizard-1-high-elf` | level 1, spellbook flags | 1 |
| 1 | 09 | `sample-09-fighter-5-plate-shield` | heavy armour, shield, Dex −1 | 5 |
| 1 | 10 | `sample-10-ranger-5-half-plate` | medium armour above the Dex cap | 5 |
| 2 | 11 | `sample-11-barbarian-5-custom-lineage` | Barbarian, Custom Lineage | 5 |
| 2 | 12 | `sample-12-druid-6-moon-customized` | Druid, three Tasha's options | 6 |
| 2 | 13 | `sample-13-rogue-5-magic-armour` | magic armour, three attuned | 5 |
| 2 | 14 | `sample-14-fighter-7-eldritch-knight` | third-caster at an odd level | 7 |
| 2 | 15 | `sample-15-2024-ranger-5` | 2024 half-caster from level 1 | 5 |
| 2 | 16 | `sample-16-2024-wizard-5` | 2024 spellbook | 5 |
| 2 | 17 | `sample-17-2024-paladin-3-sorcerer-3` | 2024 half-caster rounding | 3 + 3 |
| 3 | 18 | `sample-18-paladin-3-ranger-3` | two half-casters | 3 + 3 |
| 3 | 19 | `sample-19-barbarian-3-monk-3` | two Unarmoured Defences | 3 + 3 |
| 3 | 20 | `sample-20-fighter-20-champion` | level 20, seven improvements | 20 |
| 3 | 21 | `sample-21-attunement-over-limit` | a fourth attuned item, if Aurora allows | 5 |
| 3 | 22–30 | `sample-22…30-2024-<class>-3` | the nine 2024 classes not built above | 3 each |

---

## P1

### 01 · `sample-01-artificer-5` · Artificer 5 (Alchemist)

**Purpose.** The only class no test has ever seen. Its own casting block (half-caster from level 1, prepares
from its whole list), its infusion pools (`Artificer Infusion, !TCOE Base` is the `!` negation filter Incudo
does not read yet), and always-prepared subclass spells. Single class, so this sample carries no shared
caster level; **03** does.

**Options.** None (Feats off, Multiclassing off). **Content:** Tasha's Artificer.

**Build.** Human (standard), Sage. Standard array: INT 15, CON 14, DEX 13, WIS 12, CHA 10, STR 8.
- **Artificer 1.** Skills Investigation, Perception. Tool: Smith's Tools (the "Artisan Tool" pick). Cantrips
  Guidance, Mending.
- **2.** Infuse Item: learn four infusions — Enhanced Defense, Enhanced Weapon, Replicate Magic Item,
  Homunculus Servant.
- **3.** Artificer Specialist: Alchemist. Alchemist's tool proficiency; its always-prepared spells.
- **4.** Ability Score Improvement: INT +2 (18).
- **5.** Alchemist's level-5 features and always-prepared spells.
- **Prepared** (Aurora allows INT modifier + half the level, 5): Cure Wounds, Faerie Fire, Detect Magic,
  Lesser Restoration, Haste. Leave the always-prepared ones as Aurora sets them.
- **Gear:** none.

**Tests will assert.** Imports without errors; 0 stat-mismatch and 0 spell-missing; slots 4/2/2; save DC and
attack bonus for the Artificer block compared; the four recorded infusions come back as chosen. Whether
the *builder offers* them is a different question: `!` negation is read as a literal tag today, so that
pool is known to offer nothing, and this sample is what will measure the day it is read. Rebuild through
the builder equals the import; opens with zero sources.

**No test can referee.** Hit points; that the prepared five are legal (no model of preparation yet).

### 02 · `sample-02-paladin-3-sorcerer-3` · Paladin 3 / Sorcerer 3

**Purpose.** A half-caster at an **odd** level beside a full caster. Paladin 3 is one half-caster level
rounded **down** (1) and 1.5 unrounded, so the shared caster level is **4** (slots 4/3) rounded down and
**5** (4/3/2) rounded up. Aurora records the level, and nothing the ten saves hold can tell the two apart
(a Paladin 2 reads 1 either way). Also a Sorcerer, which no save has, and Draconic Resilience's unarmoured
armour class.

**Options.** Multiclassing. (Feats off.)

**Build.** Human (standard), Soldier. **Point buy** `15,14,13,10,10,10`: STR 15, CHA 14, CON 13, DEX 10,
WIS 10, INT 10.
- **Paladin 1.** Skills Insight, Persuasion. Lay on Hands, Divine Sense.
- **2.** Fighting Style: Defense. Spellcasting. Divine Smite.
- **3.** Sacred Oath: Devotion. Divine Health.
- **Sorcerer 1** (character level 4). Sorcerous Origin: Draconic Bloodline, ancestry Gold. Cantrips Fire
  Bolt, Mage Hand, Prestidigitation, Ray of Frost. Spells known Shield, Magic Missile.
- **Sorcerer 2.** Spell known: Sleep. **3.** Metamagic: Quickened Spell, Twinned Spell. Spell known: Misty Step.
- **Prepared** (Paladin 3: CHA modifier + 1 = 3): Bless, Cure Wounds, Command.
- **Gear:** none (Draconic Resilience needs no armour on).

**Tests will assert.** `multiclass:spellcasting:level` **4** and Aurora's `<magic level="4">` agree; the two
own slot rows (Paladin 3: 3 first-level; Sorcerer 3: 4/2) agree; two save DCs, two attack bonuses. The
**perturbation that rounds a half-caster up moves the level to 5 and fails** — that is what makes this
sample worth having. Rebuild equals import. **The multiclass Aurora marker is the one allowed
`element-missing`.**

**No test can referee.** Hit points; armour class (Draconic Resilience, unarmoured).

### 03 · `sample-03-wizard-4-artificer-3` · Wizard 4 / Artificer 3

**Purpose.** The Artificer's *own* multiclass rule: half its levels rounded **up** (the corpus gives it a
separate marker, `…SLOTS_HALF_UP`, and nothing else uses it). Artificer 3 is 2 rounded up, 1 rounded down,
so the shared caster level is **6** (4/3/3) against 5 (4/3/2). Also two prepared lists at once (a spellbook
and a whole-list class) and a second Artificer subclass.

**Options.** Multiclassing. (Feats off.) **Content:** Tasha's Artificer.

**Build.** Human (standard), Sage. Standard array: INT 15, DEX 14, CON 13, WIS 12, CHA 10, STR 8.
- **Wizard 1.** Skills Investigation, Insight. Cantrips Fire Bolt, Mage Hand, Prestidigitation. Spellbook
  Magic Missile, Shield, Mage Armor, Sleep, Detect Magic, Find Familiar. Find Familiar form: Owl.
- **2.** Arcane Tradition: School of Evocation. Spellbook Burning Hands, Thunderwave.
- **3.** Spellbook Misty Step, Scorching Ray.
- **4.** Ability Score Improvement: INT +2 (18). Cantrip Ray of Frost. Spellbook Invisibility, Mirror Image.
- **Artificer 1** (character level 5). Cantrips Mending, Message. **2.** Infusions: Enhanced Defense,
  Enhanced Weapon, Replicate Magic Item, Homunculus Servant. **3.** Artificer Specialist: **Armorer**.
- **Prepared, Wizard** (INT modifier + level = 8): Magic Missile, Shield, Mage Armor, Sleep, Detect Magic,
  Burning Hands, Misty Step, Scorching Ray. **Prepared, Artificer** (INT modifier + 1 = 5): Cure Wounds,
  Faerie Fire, Identify, Longstrider, Alarm — none of them the Wizard's; Aurora may refuse a spell the
  character already has, and if it does, take another.
- **Gear:** none.

**Tests will assert.** Caster level **6**, slots by block (Wizard 4: 4/3; Artificer 3: 3), two DCs, two
attack bonuses; rounding the Artificer down reads 5 and fails. Rebuild equals import.

**No test can referee.** Hit points; prepared lists.

### 04 · `sample-04-wizard-4-paladin-3-fighter-3` · Wizard 4 / Paladin 3 / Eldritch Knight 3

**Purpose.** All three fractions in one character: full (Wizard, 4), half rounded down (Paladin 3 → 1),
third rounded down (Eldritch Knight 3 → 1). **Three ordinary casting blocks**, which no save has: the
shared level is **6** (4/3/3), and each block records its own row (Wizard 4: 4/3; Paladin 3: 3; Eldritch
Knight 3: 2).

**Options.** Multiclassing. (Feats off.)

**Build.** Human (standard), Sage. Standard array: INT 15, STR 14, CHA 13, CON 12, DEX 10, WIS 8.
Prerequisites: INT 13, STR 13 and CHA 13, all met.
- **Wizard 1–4.** As in **03** (same skills, cantrips, spellbook picks, Evocation at 2, INT +2 at 4).
- **Paladin 1** (character level 5): no skills (multiclass). **2.** Fighting Style: Defense.
  **3.** Sacred Oath: Devotion.
- **Fighter 1** (character level 8): no skills (multiclass); Fighting Style: Great Weapon Fighting;
  Second Wind. **2.** Action Surge. **3.** Martial Archetype: Eldritch Knight. Cantrips Shocking Grasp, Light. Spells
  known Alarm, Chromatic Orb, Comprehend Languages. (Two abjuration/evocation and one of any school; none
  of them is the Wizard's, and Devotion's own Protection from Evil and Good is avoided.)
- **Prepared, Wizard** as in **03**; **Paladin** (CHA modifier + 1 = 3): Bless, Cure Wounds, Command.
- **Gear:** none.

**Tests will assert.** Three `<spellcasting>` blocks; caster level **6**; each block's own slot row; three
DCs and three attack bonuses. The corpus has never been run against a third block, so this is where a
"two blocks" assumption would show. **No test can referee** hit points; prepared lists.

### 05 · `sample-05-wizard-3-rogue-3-warlock-3` · Wizard 3 / Arcane Trickster 3 / Warlock 3

**Purpose.** ADR 0041's named uncovered case: **two ordinary blocks beside pact magic, with a
third-caster.** The shared level is **4** (Wizard 3 + Trickster 3 → 1), so 4/3, and the pact's two 2nd-level
slots are a separate row that never enters the pool. Also the `Ritual` support filter, through Pact of the
Tome's ritual picks.

**Options.** Multiclassing. (Feats off.)

**Build.** Human (standard), Sage. Standard array: INT 15, DEX 14, CHA 13, CON 12, WIS 10, STR 8.
- **Wizard 1–3.** Skills Investigation, Insight. Cantrips Fire Bolt, Mage Hand, Prestidigitation. Spellbook
  Magic Missile, Shield, Mage Armor, Sleep, Detect Magic, Find Familiar; Burning Hands, Thunderwave at 2
  (Evocation); Misty Step, Scorching Ray at 3.
- **Rogue 1–3** (character levels 4–6): one skill, Stealth (multiclass). Expertise Stealth and Thieves'
  Tools. **3.** Roguish Archetype: Arcane Trickster. Cantrips Minor Illusion, Message. Spells known
  Feather Fall, Disguise Self, Charm Person (take the any-school one first).
- **Warlock 1–3** (character levels 7–9): Patron: The Great Old One. Cantrips Eldritch Blast, Chill Touch.
  Spells known Hex, Armor of Agathys (1), Hellish Rebuke (2), Expeditious Retreat (3). **2.**
  Invocations: Agonizing Blast, Book of Ancient Secrets. **3.** Pact Boon: Pact of the Tome
  (Aurora may want the boon picked before Book of Ancient Secrets is offered: pick the boon first).
  Book of Shadows cantrips: any three the pool offers. Rituals: two the pool offers that the character
  does not already have (Alarm and Comprehend Languages are usually fine).
- **Gear:** none.

**Tests will assert.** Three blocks; caster level **4**; own rows Wizard 3: 4/2, Trickster 3: 2, pact: 2
slots of 2nd level; three DCs, three attack bonuses. The pact row stays out of the pool and the shared
level does not count the Warlock. The recorded ritual picks come back as chosen; whether the builder
*offers* them waits on the `Ritual` filter being read. **No test can referee** hit points.

### 06 · `sample-06-rogue-4-wizard-4-interleaved` · Rogue 4 / Wizard 4, levels alternating

**Purpose.** The levels go **Rogue, Wizard, Rogue, Wizard, …** rather than in blocks, and the **first
class is the Rogue**. The existing Wizard 4 / Rogue 4 has the opposite order, and order matters: the first
class brings the saving throws and full starting proficiencies, the second only the multiclass ones.
Same caster level (5, slots 4/3/2) by construction, so any difference is order. Also `Ritual Caster` (the
`Ritual` filter, a feat with an ability prerequisite) beside an ASI at the other level, in one character.

**Options.** Feats and Multiclassing.

**Build.** Human (standard), Sage. Standard array: DEX 15, INT 14, CON 13, WIS 12, CHA 10, STR 8.
Level order (character level, class): 1 Rogue, 2 Wizard, 3 Rogue, 4 Wizard, 5 Rogue, 6 Wizard, 7 Rogue,
8 Wizard.
- **1 Rogue 1.** Skills Stealth, Perception, Sleight of Hand, Insight. Expertise Stealth, Thieves' Tools.
- **2 Wizard 1.** Cantrips Fire Bolt, Mage Hand, Prestidigitation. Spellbook Magic Missile, Shield, Mage
  Armor, Sleep, Detect Magic, Find Familiar.
- **3 Rogue 2.** Cunning Action. **4 Wizard 2.** Arcane Tradition: Evocation. Spellbook Burning Hands,
  Thunderwave.
- **5 Rogue 3.** Roguish Archetype: Arcane Trickster. Cantrips Minor Illusion, Message. Spells known
  Feather Fall, Disguise Self, Charm Person.
- **6 Wizard 3.** Spellbook Misty Step, Scorching Ray.
- **7 Rogue 4.** Improvement: **Ability Score Improvement**, DEX +2. Spell known Color Spray.
- **8 Wizard 4.** Improvement: **Feat: Ritual Caster**; ritual spells Alarm, Comprehend Languages (Wizard
  list). Cantrip Ray of Frost. Spellbook Invisibility, Mirror Image.
- **Gear:** none.

**Tests will assert.** Caster level 5, slots 4/3/2; the same numbers as the existing Wizard/Rogue where
they can agree; each level attributed to the class it was taken in, in this order; the builder rebuild is
the hardest thing here (it replays a level at a time in this order). **No test can referee** hit points.

### 07 · `sample-07-cleric-20-war` · Cleric 20 (War), ability score improvements only

**Purpose.** **Level 20**, the whole slot table down to 9th level, a **whole-list preparer** with
**always-prepared** domain spells, and a save that takes **only** ability score improvements (Feats off,
so every improvement is +2 and the cap of 20 is reached exactly).

**Options.** None. (Feats **off**, Multiclassing off.)

**Build.** Human (standard), Acolyte. Standard array: WIS 15, CON 14, STR 13, CHA 12, DEX 10, INT 8.
- **Cleric 1.** Divine Domain: War (martial weapons and heavy armour). Skills History, Persuasion.
  Cantrips Guidance, Sacred Flame, Thaumaturgy. **4.** Cantrip Spare the Dying. **10.** Cantrip Resistance.
- **Improvements:** 4 WIS +2 (18); 8 WIS +2 (20); 12 CON +2 (17); 16 CON +2 (19); 19 STR +2 (16).
- **Prepared** (Aurora allows WIS modifier + level, 25; mark fewer, and if it insists on all of them, mark
  25 and note it here): Bless, Cure Wounds; Lesser Restoration, Spiritual Weapon; Revivify, Spirit
  Guardians; Death Ward, Banishment; Mass Cure Wounds, Flame Strike; Heal; Resurrection; Holy Aura; Mass
  Heal. Leave the domain's always-prepared spells as Aurora sets them.
- **Gear:** none.

**Tests will assert.** Slots 4/3/3/3/3/2/2/1/1; DC and attack; WIS 20 with the cap; five improvements and
no feat; a rebuild through all 20 levels; opens with zero sources. **Not refereed:** hit points; the 14
prepared (no model of preparation, which is exactly why this sample sets both kinds of flag).

### 08 · `sample-08-wizard-1-high-elf` · Wizard 1 (High Elf)

**Purpose.** **Level 1**, and a **spellbook preparer with `prepared` set on some spells and not others**.
A High Elf's racial cantrip comes from the Wizard's own list, so a pool must not offer what the race
already gave. Prepared here is *fewer than the maximum* on purpose.

**Options.** None.

**Build.** High Elf, Sage. Standard array: INT 15, DEX 14, CON 13, WIS 12, CHA 10, STR 8; the High Elf adds
DEX +2, INT +1 (so DEX 16, INT 16). Languages by the order above (the High Elf's extra one and Sage's two).
Racial cantrip: Prestidigitation.
- **Wizard 1.** Skills Investigation, Insight. Cantrips Fire Bolt, Mage Hand, Ray of Frost. Spellbook Magic
  Missile, Shield, Mage Armor, Sleep, Detect Magic, Find Familiar; Find Familiar form: Owl.
- **Prepared** (allowed: INT modifier + 1 = 4): **three only** — Magic Missile, Shield, Mage Armor. The
  other three stay in the book unprepared.
- **Gear:** none.

**Tests will assert.** Level 1 opens with the Wizard's slots (2 first-level), one block, DC and attack;
the racial cantrip is not also offered as a Wizard pick; hit points are the die's maximum (6) plus the
Constitution modifier (+1) = 7, worked by hand. **Not refereed:** that 3 of 6 are prepared — the sample exists so that the day
preparation is modelled there is a real save that says so.

### 09 · `sample-09-fighter-5-plate-shield` · Fighter 5 (Champion), plate and shield, Dexterity −1

**Purpose.** The armour class rows nobody has seen. **Heavy armour ignores Dexterity, including a negative
modifier** (a row added because the ten saves cannot tell it from the four-row table: both plate wearers
have exactly +0), and **a shield**, which no save carries. Also rolled hit points and a half-feat.

**Options.** Feats. (Multiclassing off.)

**Build.** Human (standard), Soldier. **Rolled** hit points. Standard array: STR 15, CON 14, CHA 13,
WIS 12, INT 10, **DEX 8** (Human +1 → DEX 9, modifier −1; STR 16).
- **Fighter 1.** Fighting Style: Defense. Skills Perception, Survival (Soldier already gives Athletics and
  Intimidation). Second Wind.
- **2.** Action Surge. **3.** Martial Archetype: Champion. **4.** Improvement: **Feat: Heavy Armor Master**
  (+1 STR, needs heavy armour proficiency). **5.** Extra Attack.
- **Gear:** Plate, Shield, Longsword — all three **equipped**, nothing else.

**Tests will assert.** The derived armour class **21** by hand (plate 18, shield +2, Defense +1, no Dexterity
term): the figure that would read 20 if a negative modifier were subtracted. Feat prerequisite reads the
heavy-armour proficiency. The rolled hit points are recorded and read back. **Not refereed by Aurora's
file:** armour class and hit points, which is the reason to write down the on-screen numbers (see the
readout note).

### 10 · `sample-10-ranger-5-half-plate` · Ranger 5 (Hunter), half plate, Dexterity above the cap

**Purpose.** The medium-armour cap (+2), which the ten saves cannot show because both medium wearers have
a modifier of exactly +2, where "capped" and "not capped" agree. Dexterity 17 (+3) reads **17** with the
cap and **18** without. A half-feat that raises a score, a 2014 Ranger, and a half-caster from level 2.

**Options.** Feats. (Multiclassing off.)

**Build.** Wood Elf, Outlander. **Point buy** `15,15,15,8,8,8`: DEX 15, WIS 15, CON 15, STR 8, INT 8, CHA
8; the Wood Elf adds DEX +2, WIS +1 (DEX 17, WIS 16). Languages by the order above (Outlander's one).
- **Ranger 1.** Skills Stealth, Perception, Nature (Outlander gives Athletics and Survival). Favored Enemy:
  Undead. Natural Explorer: Forest.
- **2.** Fighting Style: Archery. Spellcasting: spells known Cure Wounds, Ensnaring Strike.
- **3.** Ranger Archetype: Hunter; Hunter's Prey: Colossus Slayer. Spell known: Hunter's Mark (or Aurora's
  next legal one). **4.** Improvement: **Feat: Observant** (+1 WIS → 17).
- **5.** Extra Attack. Spell known: Pass Without Trace.
- **Gear:** Half Plate, Longbow — equipped.

**Tests will assert.** Armour class **17** by hand (half plate 15, Dexterity capped at +2), and that
removing the cap reads 18; slots 4/2 for a Ranger 5 (own table); DC and attack. **Not refereed:** hit
points and armour class by Aurora's file.

---

## P2

### 11 · `sample-11-barbarian-5-custom-lineage` · Barbarian 5 (Berserker), Custom Lineage

**Purpose.** The Barbarian's **Unarmoured Defence** (10 + Dexterity + Constitution; a shield is allowed),
never seen. The Tasha's **Custom Lineage**, whose `+2` is gated on a background's grant and whose language
is swapped by an option. Feats and one Customized option together.

**Options.** Feats and **Customized Language**. (Multiclassing off.)

**Build.** Custom Lineage, Outlander. Standard array: STR 15, CON 14, DEX 13, WIS 12, CHA 10, INT 8. Lineage:
Size Medium; ability +2 to STR (17); feat **Tough**; variable trait darkvision; language (the Customized
Language pick): Orc.
- **Barbarian 1.** Skills Intimidation, Perception. Rage, Unarmored Defense.
- **2.** Reckless Attack, Danger Sense. **3.** Primal Path: Path of the Berserker. **4.** Improvement:
  **Ability Score Improvement**, STR +2 (19). **5.** Extra Attack, Fast Movement.
- **Gear:** Greataxe, Shield — equipped, **no armour**.

**Tests will assert.** Armour class **15** by hand (10 + Dex +1 + Con +2 + shield 2); the Customized Language
select replaces the Common grant; the +2 lands once. Removing the shield reads 13. **Not refereed:** armour
class and hit points (Tough's +2 per level is a rule of the feat).

### 12 · `sample-12-druid-6-moon-customized` · Druid 6 (Moon), three Tasha's options

**Purpose.** A whole-list preparer that is a *different* class from the Cleric; **Customized Ability Score
Increases, Customized Proficiencies and Customized Language together** (each swaps a fixed grant for a
choice, and none has been shown a real Aurora answer). Rolled ability scores.

**Options.** **Customized Ability Score Increases, Customized Proficiencies, Customized Language.** (Feats
off, Multiclassing off.)

**Build.** Hill Dwarf, Hermit. Ability scores **rolled** (4d6, drop lowest): re-roll the set until WIS ≥ 14
and CON ≥ 12, then assign WIS, CON, DEX, INT, CHA, STR in descending order. The dwarf's ability increases
are the Customized ones: **WIS +2, CON +1**. Proficiencies and language the other two options let you
choose in place of the dwarf's fixed ones: Survival and Animal Handling if offered (any two the character
does not already hold if not), and language Sylvan.
- **Druid 1.** Skills Nature, Perception. Cantrips Guidance, Druidcraft. **2.** Druid Circle: Circle of
  the Moon. **4.** Improvement: ASI, WIS +2. Cantrip Produce Flame. **6.** Circle features.
- **Prepared** (WIS modifier + 6; mark **nine**, or the most Aurora allows if that is fewer): Cure Wounds,
  Entangle, Healing Word, Thunderwave; Barkskin, Moonbeam, Pass Without Trace; Call Lightning, Dispel Magic.
- **Gear:** none.

**Tests will assert.** Slots 4/3/3, DC and attack; each Customized option removes its fixed grant and offers
its pool (the Dwarf's fixed +2 Constitution is not also applied). **Not refereed:** prepared list, hit
points.

### 13 · `sample-13-rogue-5-magic-armour` · Rogue 5 (Thief), magic armour, three attuned

**Purpose.** **Light armour, a magic armour adorner, and attunement exactly at the limit of three.** The
Amulet of Health *sets* Constitution (19) instead of adding to it, a different kind of stat rule from
every other item. The engine's armour class and attunement gate have no real answer to check against.

**Options.** None.

**Build.** Lightfoot Halfling, Criminal. Standard array: DEX 15, CON 14, INT 13, WIS 12, CHA 10, STR 8; the
Halfling adds DEX +2, CHA +1 (DEX 17).
- **Rogue 1.** Skills Perception, Acrobatics, Insight, Investigation (Criminal gives Deception and
  Stealth). Expertise Stealth, Thieves' Tools.
- **2.** Cunning Action. **3.** Roguish Archetype: Thief. **4.** Improvement: ASI, DEX +2 (19). **5.** Uncanny
  Dodge.
- **Gear:** Studded Leather **with the "Armor, +1" adorner**, equipped; **Cloak of Protection**, **Ring of
  Protection**, **Amulet of Health**, each equipped and **attuned** (three of three). Take the 2014
  printings (*Dungeon Master's Guide*).

**Tests will assert.** Armour class **19** by hand (studded leather 12, Dex +4, armour +1, cloak +1, ring
+1); saves +1 from the cloak and ring; Constitution 19 from the amulet; attunement count 3
of 3 with no report. Unattuning any one moves exactly that item's rules and nothing else (perturbation).
**Not refereed:** armour class and hit points by Aurora's file.

### 14 · `sample-14-fighter-7-eldritch-knight` · Fighter 7 (Eldritch Knight)

**Purpose.** A single-class subclass caster at an **odd level** past 3: the spells-known and cantrip steps
and the block's own slot row at 7 (4/2), where the ten saves hold an Eldritch Knight at 12 only. No
multiclass pool: nothing else in this sample moves a shared level.

**Options.** None.

**Build.** Human (standard), Soldier. Standard array: STR 15, CON 14, DEX 13, INT 12, WIS 10, CHA 8.
- **Fighter 1.** Fighting Style: Dueling. Skills Perception, Survival (Soldier gives Athletics and
  Intimidation). **2.** Action Surge. **3.** Martial Archetype: Eldritch Knight; cantrips Shocking Grasp,
  Light; spells known Shield, Magic Missile, Alarm. **4.** ASI STR +2 (17); spell known Chromatic Orb.
  **5.** Extra Attack. **6.** ASI STR +2 (19). **7.** War Magic; spell known Scorching Ray (a 2nd-level
  evocation spell, which the Knight's slots now reach).
- **Gear:** Longsword, Shield.

**Tests will assert.** Slots 4/2; five spells known; DC and attack; the Eldritch Knight block's list. **Not refereed:** hit points, armour class (no armour here).

### 15 · `sample-15-2024-ranger-5` · **2024** Ranger 5 (Hunter)

**Purpose.** A 2024 half-caster: spellcasting **from level 1**, a background that gives ability scores and
an origin feat, weapon mastery. Its multiclass marker in the corpus is the same round-down one as the 2014
Ranger's.

**Options.** None. **Content: Player's Handbook (2024)** throughout (the class, the background, the species).

**Build.** Human (2024 species), any 2024 background, taking the ability increases and origin feat the
background offers. Standard array assigned DEX 15, WIS 14, CON 13, STR 12, INT 10, CHA 8 (the background
then adds +2/+1). Where a name below is not offered, take the closest and write it here.
- **Ranger 1–5.** Subclass Hunter at 3; Fighting Style Archery at 2; **weapon mastery** on Longbow and
  Shortsword; the Ranger's own choices as Aurora presents them; spells: fill every count Aurora shows,
  any legal ones, always-prepared ones left as set. **4.** Improvement: ability increase to DEX.
- **Gear:** Studded Leather, Longbow, Shortsword — equipped.

**Tests will assert.** A 2024 Ranger 5 imports and rebuilds; own slot row (4/2); DC and attack; the
background's ability increases land once; weapon mastery reads. Uses the 2024 corpus content, so the
first thing it shows is whether 2024 content resolves at all. **Not refereed:** hit points, armour class.

### 16 · `sample-16-2024-wizard-5` · **2024** Wizard 5 (Evoker)

**Purpose.** The 2024 spellbook (prepared list larger than 2014's, class features that changed) and
a spellcaster's 2024 slot table at 5 (4/3/2).

**Options.** None. **Content: Player's Handbook (2024).**

**Build.** High Elf (2024 Elf lineage), Sage (2024). Standard array INT 15, DEX 14, CON 13, WIS 12, CHA 10,
STR 8, then the background's increases and origin feat as it offers them.
- **Wizard 1–5.** Subclass Evoker at 3. **4.** Improvement: INT +2. Cantrips, spellbook and prepared
  spells: fill every count Aurora shows; mark **two fewer prepared than Aurora allows**, so the flags
  differ from the maximum.
- **Gear:** none.

**Tests will assert.** Slots 4/3/2, DC and attack; the spellbook count; rebuild equals import. **Not
refereed:** prepared, hit points.

### 17 · `sample-17-2024-paladin-3-sorcerer-3` · **2024** Paladin 3 / Sorcerer 3

**Purpose.** **02** again in 2024, because the 2024 rulebook rounds half-caster levels **up** (as I
understand it; Aurora's own recorded level is what the test would pin) and the corpus's 2024 Paladin still
carries the round-down `HALF` marker. If Aurora writes 5 here and Incudo reads 4, this sample is the only
place that would show it, and it would be a content question, not an engine one.

**Options.** Multiclassing. **Content: Player's Handbook (2024).**

**Build.** Human (2024), Soldier. Point buy `15,14,13,10,10,10` as in **02** (STR 15, CHA 14, CON 13), then
the background's increases. Paladin 1–3, subclass Oath of Devotion at 3; Sorcerer 1–3, subclass Draconic
at 3 (2024 Sorcerers choose at 3). Spells and cantrips: fill every count, any legal ones. Metamagic at 2
in 2024, Quickened Spell and Twinned Spell.
- **Gear:** none.

**Tests will assert.** Aurora's `<magic level>` compared with the published shared level; the two own
rows; the perturbation that rounds up is measured. **Whichever way it comes out, the figure goes in the
ADR that follows.** **Not refereed:** hit points, armour class.

---

## P3

### 18 · `sample-18-paladin-3-ranger-3` · Paladin 3 / Ranger 3

**Purpose.** Two half-casters. Rounded **per class** the shared level is 1 + 1 = **2**; if Aurora adds the
fractions first (1.5 + 1.5) and rounds the sum it is **3**. The rulebook is ambiguous and Aurora is the
referee. No other sample can say.

**Options.** Multiclassing. **Build.** Human (standard), Outlander. **Point buy** STR 13, CHA 13, DEX 14,
WIS 14, CON 10, INT 8 (26 points), then Human +1. Paladin 1–3 (Defense, Oath of Devotion), then Ranger
1–3 (one multiclass skill, Stealth; Hunter; Fighting Style Archery at Ranger 2; spells known Cure Wounds,
Ensnaring Strike). Paladin skills Insight, Persuasion (Outlander gives Athletics and Survival). Paladin
prepared (CHA modifier + 1): Bless, Cure Wounds, Command. **Gear:** none.

**Tests will assert.** `<magic level>` against the published level (2 or 3, whichever Aurora says), and
what the engine reads for each. **Not refereed:** hit points.

### 19 · `sample-19-barbarian-3-monk-3` · Barbarian 3 / Monk 3

**Purpose.** **Two Unarmoured Defences at once**: Barbarian (10 + Dex + Con) and Monk (10 + Dex + Wis).
Which one Aurora applies (the higher, or the first) is a fact only the on-screen armour class shows.

**Options.** Multiclassing. **Build.** Human (standard), Hermit. Standard array STR 15, DEX 14, WIS 13,
CON 12, CHA 10, INT 8 (Barbarian needs STR 13; Monk needs DEX 13 and WIS 13). Barbarian 1–3 (skills
Athletics, Intimidation; Path of the Berserker), then Monk 1–3 (no skills; Way of the Open Hand); no
armour, no shield. **Gear:** none. By hand, with Human's +1: Barbarian's row reads 10 + 2 + 1 = **13**,
Monk's 10 + 2 + 2 = **14**.

**Tests will assert.** Both alternative armour class rows present and the higher one wins (14), or whatever
Aurora's readout says. **Not refereed:** armour class and hit points by the file; **this sample needs the
readout to mean anything.**

### 20 · `sample-20-fighter-20-champion` · Fighter 20 (Champion), rolled hit points

**Purpose.** Level 20 for a non-caster: **seven** improvements (4, 6, 8, 12, 14, 16, 19) with the
repeatable +1 and a cap; nineteen rolled hit dice; Extra Attack ×3 and the Champion's second fighting
style. A sample that is all progression.

**Options.** Feats. **Build.** Human (standard), Soldier. **Rolled** hit points. Standard array STR 15, CON
14, DEX 13, WIS 12, INT 10, CHA 8. Fighter 1 Fighting Style Defense; Champion at 3; Champion's extra style at
10: Dueling. Improvements: 4 STR +2, 6 STR +2 (STR reaches 20), 8 CON +2, 12 Feat **Sentinel**, 14 Feat
**Tough**, 16 CON +2, 19 DEX +2. **Gear:** Chain Mail, Longsword, Shield — equipped.

**Tests will assert.** Seven improvements land as seven; STR is capped at 20; the hit points sum the 19
recorded rolls; rebuild equals import at the largest level count the corpus can hold. **Not refereed:**
hit points, armour class by Aurora's file.

### 21 · `sample-21-attunement-over-limit` · a fourth attuned item, **if Aurora allows it**

Take a copy of **13**, attune a **fourth** item (**Gauntlets of Ogre Power**, which needs attunement and
conflicts with nothing there), and see what Aurora does. **If it refuses, there is no sample: write
"refused" here and skip it.** If it lets you, save it as `sample-21-attunement-over-limit`. Either answer is
a fact about Aurora nobody has, and the second is the only real case of a character over the limit.

**Tests will assert.** Whatever the derivation reports for attunement over three (`attunement:current` 4
against `attunement:max` 3) is the same thing Aurora let through.

### 22–30 · the 2024 sweep

Nine short builds, **level 3 each**, only after everything above; skip any that turn out to be like the one
before. Each is **2024** content: Human (2024), a 2024 background of your choice, Standard array assigned to
the class's two highest priorities, the background's increases and origin feat as it offers them,
Multiclassing off, Feats off, no gear, spells and skills any legal ones with every count full.

| # | file | class, subclass at 3 |
|---|---|---|
| 22 | `sample-22-2024-barbarian-3` | Barbarian, Path of the Berserker |
| 23 | `sample-23-2024-bard-3` | Bard, College of Lore |
| 24 | `sample-24-2024-cleric-3` | Cleric, Life Domain |
| 25 | `sample-25-2024-druid-3` | Druid, Circle of the Land |
| 26 | `sample-26-2024-fighter-3` | Fighter, Champion |
| 27 | `sample-27-2024-monk-3` | Monk, Warrior of the Open Hand |
| 28 | `sample-28-2024-rogue-3` | Rogue, Thief |
| 29 | `sample-29-2024-sorcerer-3` | Sorcerer, Draconic Sorcery |
| 30 | `sample-30-2024-warlock-3` | Warlock, Fiend Patron |

**Tests will assert.** Import, 0 stat-mismatch, 0 spell-missing, rebuild equals import, and that each class
resolves at all in the 2024 content. Where a 2024 class differs structurally from the 2014 one (Weapon
Mastery, Divine Order, Primal Order, Expertise), the first one built shows the first differences.

---

## Hand-over

1. Put the finished files in **`tools/verify/fixtures/saves/`**, named as above.
2. Tell the assistant which ones are done. Partial batches are fine: P1 first, and the tests are written
   to work with however many arrive.
3. If you did the optional readout, put it beside them as `READOUT.md`.

**On receipt, before anything is committed, the assistant will check each file for:**

- **A generic name.** `<character>` says `Sample NN`, and no player name, notes, appearance text, backstory
  or quest appears anywhere in the file.
- **No portrait.** No inline image bytes, and no local file path of any kind (a drive letter, a home folder) anywhere.
- **A short exclusion list.** `<sources><restricted>` empty or nearly so (a long one is why saves reach
  megabytes).
- **The right build.** The class split and levels, the options and each named pick, read from the file
  itself and compared with the sample above; substitutions you wrote here are honoured.
- **No custom item names or notes.**

If a file fails, it is not committed and the assistant says which check and why. Nothing is committed until
they all pass, and the check is kept as a test so a later sample cannot bring a portrait in.

The saves are then read by every real-save test, found by **what they are** (class split, options), never by
name, position or count, and the figures the ADRs cite are re-derived from them.

## Received, 2026-09-23

All thirty arrived (the plan's 21 and the nine 2024 ones), and are committed with a `manifest.json`.

- **They were cleaned before committing.** As saved, every file carried the portrait as inline image data,
  a path to it with the account name in it, a player name, and a 3 to 5 MB list of disabled sources (about
  150 MB in all). The originals were kept outside the repository and the committed copies have those
  fields empty and the name set to `Sample NN`. Oracle differences, rows compared, derived output and
  imported inputs are identical before and after on all thirty. `sample-saves.test.ts` fails on each of
  those things, so the next sample is checked for them.
- **Differences from the plan, all harmless to what they test:** samples 01 to 06 have Feats, Multiclassing
  and Customized Proficiencies on where the plan said none or Multiclassing; sample 08 has Feats on; samples
  14 to 19 and 22 to 30 have the average-hit-points option on. The manifest records what each save actually
  has. Sample 21 shows Aurora allows a fourth attuned item; sample 17's prepared count reads 0 because
  Aurora shows nothing for the 2024 Paladin's fixed table.
- **Reused:** a save serves every test that can use it. Sample 06 is what `rogue-wizard-aurora.test.ts`
  compares a step-by-step builder run with (`rogue-wizard-interleaved-build.ts`), as well as being rebuilt
  from its own picks by `builder-rebuild.test.ts`, so no separate sample of that description is needed.
