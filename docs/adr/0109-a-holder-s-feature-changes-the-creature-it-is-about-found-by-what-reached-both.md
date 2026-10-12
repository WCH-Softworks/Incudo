# 0109 — A holder's feature changes the creature it is about, found by what reached both

**Status:** Accepted · 2026-10-12 · answers ROADMAP Phase 4's "A holder's feature changes the creature it is about, not
every creature held" · amends [0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md)
("Not done": "Say which creature a holder's feature is for") · builds on
[0040](./0040-a-chosen-element-follows-the-track-of-the-element-that-offered-it.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md) ·
**format:** none; no system or character format change

## Context

ADR 0073 derives each creature a character holds in a scope of its own: the character again, with every other held
creature left out. What only another creature gives is then not reached, and that is enough for what a creature grants
itself (Primal Bond, Soul Bond). It is not enough for what the **holder** has. Content writes a holder's feature that
improves "your companion" as a rule on the holder's own element, in the one namespace every scope reads, so it reaches
every scope. A Battle Smith 15 who also holds a Homunculus Servant (an infusion) shows Improved Defender's +2 armour class
on both stat blocks, where the book says "Your steel defender gains a +2 bonus to Armor Class". ADR 0073 left it, calling
the link between a feature and its creature a guess about prose. The maintainer's call (2026-10-12): the book names the
creature, so the link is the rules', and it is pre-1.0.

Measured first (AuroraLegacy/elements at `c28ce6c`, every element that is not a creature and writes a stat in the scope's
namespace):

- **10 elements.** 7 are Companion Traits a creature grants itself (three Tasha's and three 2024 Primal Bonds, a UA
  Soul Bond): already right, since another creature's scope never reaches them.
- **3 are a holder's features**: the 2014 Ranger's Companion (armour class, attack, damage, hit points) and the Eberron and
  Tasha's Improved Defender (armour class).
- **Each is tied to its creature by what reached both.** The Ranger's Companion is itself the element whose select holds
  the beast. Improved Defender is granted by the Battle Smith subclass, which grants the Steel Defender feature whose
  select holds the Steel Defender. The Homunculus Servant is held through an infusion, which the Battle Smith subclass does
  not lead to.

## Decision

### 1. A feature is about a creature when it, or what gave it, is among what reached the creature

For a held creature, **what reached it** is the creature itself and every held element on a path that gives it: an
element whose recorded choice holds it, or whose `<grant>` names it, and whatever gave those in turn, back to the start.
**What gave a feature** is the same one step back: the elements whose choice holds it or whose grant names it.

A held element is **about** a creature when the element itself, or something that gave it, is among what reached the
creature. Improved Defender (given by Battle Smith) is about the Steel Defender (reached through Battle Smith) and not
about the Homunculus Servant. The Ranger's Companion is about its beast (it reached it).

### 2. In a creature's scope, a feature about another creature adds nothing to the creature's stats

When at least one held creature is one a feature is about, that feature's stat rules on **the scope's stats** are not
applied in the scope of any held creature it is not about. Its other rules (a holder stat Improved Defender also adds to,
`arcane jolt:dice:amount`) apply in every scope, as before. **The holder's own derivation is unchanged**: it still sums,
as Aurora's does, and nothing on the holder's sheet reads the namespace (ADR 0073).

**The scope's stats** are read off the declaration, never a prefix: every stat the kind's `companions` declaration names
(its `stats`, its sheet's rows and their templates, its `contributions` and `setterStats`), and what their formulas read
in turn (`statReferences`), less what the holder's kind itself declares. So
`companion:dexterity:save:misc` is the scope's (the declared save reads it) and the holder's `proficiency`, which a
scope's formula also reads, is not. Core names no namespace.

### 3. A feature about no held creature applies to every one

A feature tied to none of the creatures held (homebrew whose creature comes from somewhere content does not link, or
whose creature is not held yet) applies in every scope, as before this. Dropping it everywhere would be a guess in the
other direction, and it is what a single creature held today already reads.

## Evidence

- **Core, with no game** (`packages/core/src/companion-features.test.ts`): a keeper whose path grants a feature that
  offers one beast and a feature guarding it, and a charm offering another. The guard reaches only the first beast's
  scope; the holder still sums; the feature's rule on a holder stat applies in every scope; a feature that chose its
  beast is about it; a feature tied to no beast applies to both; one beast held changes nothing; the scope's stats follow
  a formula's reads and leave out the holder's own. With the scopes told nothing, three of them fail.
- **The real corpus** (`tools/verify/src/companions.test.ts`): a Tasha's Battle Smith 15 built through the builder,
  taking the Homunculus Servant infusion: the steel defender reads armour class 17 (its 15 and Improved Defender's 2), the
  homunculus 13, its print. Before this, 15. No sample holds two creatures, so no oracle row can move.

## What this does not do

- **Read prose.** "Your steel defender" is not parsed; the link is the grants and choices content already records.
- **Change the holder.** Its summed `companion:` stats stay what Aurora's app shows.
- **Reach a feature granted by the creature to another.** A creature's own grants are already its scope's only.
