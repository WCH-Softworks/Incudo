# 0043 — Speed is the race's base plus what content adds to it

**Status:** Accepted · 2026-09-23 · touches [0022](./0022-kinds-contribute-systems-do-not-ship-content.md)
(a kind's own stats) · **no format change, no engine change, no importer change**

## Context

The 5e definition declared `speed` with a default of 30 and nothing fed it, so every character read 30.
The maintainer read speed off Aurora's screen for the 30 sample saves (`tools/verify/fixtures/saves/`,
`readout.speed` in the manifest) and it differed from Incudo on seven of them: a Wood Elf 35, a Halfling
and a Dwarf 25, and a Barbarian, a Barbarian / Monk and a 2024 Monk 40.

Counting the stat names content writes (the corpus at `c28ce6c`, `<stat name="…speed…">`): a race writes
its walking speed as `innate speed` in the `base` bucket (Dwarf, Gnome, Halfling 25, Centaur 40, most
others 30); a class or feat adds to `innate speed:misc` (Barbarian's Fast Movement, the Monk's Unarmoured
Movement, Mobile, the Scout); a few things add to `speed` and `speed:misc` directly, and armour subtracts
from `speed` in the `armor` bucket (2024 armour writes `innate speed` instead). Swimming, climbing, flying
and burrowing are separate stats (`innate speed:swim`, …) and companions use `companion:speed…`.

## Decision

The player character kind declares `speed` as a derivation:
`innate speed + innate speed:misc + speed:misc`. Whatever content contributes to `speed` itself (the armour
penalty, the handful of `speed` items and feats) lands on top of that, as it does for every derived stat.
Nothing else was needed: bucket rules already make a race's `base` win over its subrace's, and armour's
`armor` bucket already makes Armorer's `0` cancel the strength penalty.

`speed` has **no default** on the kind, for the reason `ac` has none (a default would be added to the
derivation). A character with no race therefore reads 0 until it has one; the old 30 was a placeholder.
NPC and legendary kinds keep the system-level default 30 and are untouched.

## Consequences

- **Evidence.** All 30 samples agree with the readout (7 disagreed). Perturbation: removing the
  `innate speed:misc` term leaves the Barbarian, the Barbarian / Monk and the Monk wrong;
  putting the derivation back to the old default puts all seven back. `aurora-oracle.test.ts` therefore
  holds speed to the readout, as it holds armour class.
- **Not verified.** No sample wears armour that costs speed (a Strength shortfall), so the armour penalty,
  the Armorer's cancellation and the 2024 armour rule are read from content and untested against Aurora.
  Not modelled: the other movement modes, which a sheet does not show, and conditions on
  `speed:misc` items that read the final speed (`[speed:1]`) resolve through the derivation's fixed point.
- **A raceless character reads 0.** Deliberate, and visible in the sheet until a race is chosen.
