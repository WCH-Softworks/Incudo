# 0110 — A kind declares attacks no item gives, an off-hand row, and a melee weapon's reach

**Status:** Accepted · 2026-10-12 · answers three parts of ROADMAP Phase 4's "Attacks a character makes beyond a weapon's
single row" (an unarmed strike and Martial Arts, two-weapon fighting, reach) · amends
[0093](./0093-an-attack-is-a-weapon-in-the-bag-and-the-kind-declares-what-it-adds-up.md) · builds on
[0005](./0005-aurora-import.md), [0025](./0025-slots-publish-tags.md) ·
**format:** the system format's `attacks` gains optional `innate`, `variants` and `reach`, and `inventory` an optional
`tagSupports` (`formatVersion` stays 1); no character format change

## Context

ADR 0093 made an attack a weapon in the bag: one row each, its bonus and damage added up by the kind's contributions. The
maintainer named three things a character makes an attack with that this leaves out, as essential before 1.0
(2026-10-12). Measured first (AuroraLegacy/elements at `c28ce6c`):

- **An unarmed strike is no item.** Nothing in the corpus is an Unarmed Strike element. Content states what changes it as
  stats: the Monk's Martial Arts die by level (`martial arts:dice`, 2014 d4 to d10, 2024 d6 to d12), the better of
  Strength and Dexterity (2014 `martial arts:attack` and `:damage` in one bucket, 2024 `martial arts:ability modifier`),
  the Unarmed Fighting style's die (`unarmed fighting:size`, d6, d8 with no weapon in hand), and an item or two adding to
  `unarmed strike:attack` and `:damage`. The book's rule is the rest: Strength plus proficiency to hit, 1 plus Strength
  bludgeoning, and with a die from a feature the die instead of the 1. Aurora's saves record no unarmed row, even for the
  two Monk samples, so this has no referee but the book.
- **Two-weapon fighting is a rule no content states.** Neither Two-Weapon Fighting (the 2014 style, the 2024 feat) writes
  a stat. The book: when both hands hold a Light melee weapon, the other one's attack adds no positive ability modifier
  to damage, unless the character has the style. Weapons say Light by a support tag, and a slot publishes its item's
  name, armour type and versatile flag but not its support tags; content asks a slot for one nowhere (every `[primary:…]`,
  `[secondary:…]`, `[armor:…]` and `[shield:…]` in the corpus reads a name, an armour type, `any` or `none`).
- **Most melee weapons write no range.** Ranged and thrown weapons write theirs ("150/600"). Of the other 45 melee weapons,
  the five 2014 Reach weapons write "10 ft" and the rest, the five 2024 Reach weapons among them, write nothing. The book:
  5 feet, 10 with the Reach property (a support tag).

## Decision

### 1. `attacks.innate`: rows the kind always has

Each entry has a `name`, its own `stats` (contributions as the bag's, `{name}` filled with the row's name, no setter to
read), a `sides` expression (the die's sides), a `flat` text written as the die when `sides` gives none (as content
writes a blowgun's "1"), and optional `damageType`, `range` and `properties` as text. Its bonus and damage are the kind's `bonus` and `damage` stats summed from its own contributions.
5e's player character has one, the Unarmed Strike:

- to hit: Strength, or the better of Strength and Dexterity when the character holds a Martial Arts die
  (`[martial arts:dice:1]`), plus proficiency, plus `unarmed strike:attack`;
- damage: the same ability plus `unarmed strike:damage`, on the larger of the Martial Arts die and the Unarmed Fighting
  die, or on a flat 1 with neither ("1+3 bludgeoning", the book's "1 + your Strength modifier"); bludgeoning, 5 ft.

No content's own stat is read for the ability: a 2014 and a 2024 Monk say it differently, and the book's sentence covers
both.

### 2. `attacks.variants`: another row of the same weapon, with damage of its own

Each has a `label`, a `requirements` condition read in the attack's scope, and a `damage` attack stat. When the condition
holds, the attack gains an alternative with that label, its own die, and that stat added to it. 5e: "off-hand", when the
weapon is Light and not ranged and both hands hold a Light weapon; `attack:off-hand damage` is the ability modifier when it
is negative, the full modifier when the character holds either Two-Weapon Fighting, and the weapon's enhancement and
named bonuses as its main row.

### 3. `inventory.tagSupports`: a slot publishes its item's support tags too

So `[primary:id_internal_weapon_property_light]` can be asked. Opt-in, for any kind; 5e's player character turns it on.
Measured: nothing in the corpus asks a slot for a support tag, so no derivation moves (the oracle is identical).

### 4. `attacks.reach`: a range for an attack whose element writes none

An ordered list of `{ text, requirements }`; the first whose condition holds names the range of an attack whose element
writes none. 5e: "10 ft" with the Reach property, else "5 ft" for a weapon that is not ranged, spelled as the 2014 weapons
spell theirs.

### 5. A variant is a way to swing what is held

Only an equipped attack shows a variant: a carried shortsword is not in a hand.

## Evidence

- **Core, no game** (`packages/core/src/attacks.test.ts`, `equipment.test.ts`): an innate row adds up its own stats, its
  die from a stat or its flat text; a variant shows only on a held attack whose condition holds, with its own damage; a
  reach fills only a range the element does not write; a slot publishes support tags only when declared.
- **The real corpus** (`tools/verify/src/attacks.test.ts`, built through the builder): a 2014 Fighter 1 with Strength 16,
  Unarmed Strike +5, "1+3 bludgeoning"; a 2014 Monk 5 with Dexterity 16, +6, "1d6+3"; a 2024 Monk 1, +5, "1d6+3"; a
  Rogue with one shortsword, no off-hand row, and with two, "off-hand: 1d6 piercing" on each; a Fighter with the 2014 style,
  a shortsword and a scimitar, "off-hand: 1d6+3 slashing"; the 2014 Glaive's own "10 ft", the 2024 Pike's "10 ft" from the
  rule, a longsword's "5 ft", a longbow's "150/600". Each fails with its declaration taken out. The samples' attack rows
  still all agree with Aurora's, and the Unarmed Strike follows them; Aurora records no unarmed row.
- **Driven in the browser build** (2026-10-13): a new 2014 Human Monk 1 reads "Unarmed Strike: +2, 1d4 bludgeoning (range
  5 ft)"; with Strength 13 and Dexterity 16, two Shortswords equipped and a 2024 Pike carried, each Shortsword reads "+5,
  1d6+3 piercing (off-hand 1d6 piercing; range 5 ft; Finesse, Light)", the Pike "+1, 1d10+1 piercing (range 10 ft; …)"
  (Strength, no proficiency) and the Unarmed Strike "+5, 1d4+3", the same after a reload. The Attacks section's
  description now names the unarmed strike and the off-hand rule. Not the Tauri window or the phone.

## What this does not do

- **Read prose.** The Martial Arts die and ability, the Unarmed Fighting die and the bonuses are content's stats; the
  rest is the book's rule, declared by the system.
- **Grapple and shove**, the 2024 Unarmed Strike's other two options, which are not attack rolls.
- **Decide which weapon is the off-hand one.** Every Light melee weapon held while both hands hold one shows the off-hand
  row; which is swung second is the player's.
- **Spell attacks** (the next part of the item, cantrips only by the maintainer's call) and a held creature's actions.
