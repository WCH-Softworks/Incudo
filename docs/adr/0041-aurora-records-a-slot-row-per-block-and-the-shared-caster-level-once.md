# 0041 — Aurora records a slot row per block and the shared caster level once

**Status:** Accepted · 2026-09-20 · corrects [0018](./0018-tables-and-track-stats.md) (what a `<magic>`
slot row means) and touches [0008](./0008-aurora-compatibility-frozen.md) (a bugfix in the frozen
package's *comparison*, not in what it imports) · **no system-format change**

## Context

[ADR 0018](./0018-tables-and-track-stats.md) taught the differential check to compare the spell slots
Aurora records in `<magic>`. Each `<spellcasting>` block carries a nine-number row, and the ADR read it
one way: for any source that was not pact magic, the row is the **shared multiclass pool**, "because that
is what having a caster level *means*". All eight rows across the nine sample saves agreed with that
reading, and the ADR said what they did and did not prove: pact magic outside the table, and a
half-caster's halving, were pinned by the one multiclass save; rounding down rather than up was not, and
"no sample save has two classes with the Spellcasting feature".

The tenth save is the first that does. It is a Wizard 4 / Rogue 4 with an Arcane Trickster, built by the
maintainer in Aurora from a written description (ROADMAP Phase 2), and the comparison reported two
`stat-mismatch` differences on it:

| block | Aurora recorded | Incudo derived, "from the multiclass table" |
|---|---|---|
| Wizard | 4/3/0/0/0/0/0/0/0 | 4/3/2/0/0/0/0/0/0 |
| Arcane Trickster | 3/0/0/0/0/0/0/0/0 | 4/3/2/0/0/0/0/0/0 |

The 4/3/2 is right: it is the Player's Handbook's table for a caster level of 5, which is what the engine
derives after [ADR 0040](./0040-a-chosen-element-follows-the-track-of-the-element-that-offered-it.md) and
what the description was worked out to give. It was the *comparison* that was wrong, and the raw file
says why.

### What the save actually records

```xml
<magic multiclass="true" level="5">
  <spellcasting ... source="…WIZARD_SPELLCASTING_WIZARD">  <slots s1="4" s2="3" s3="0" … />
  <spellcasting ... source="…ARCANE_TRICKSTER_SPELLCASTING"> <slots s1="3" s2="0" s3="0" … />
```

- **Each block's `<slots>` is that source's own table.** A Wizard 4's is 4/3 and an Arcane Trickster
  4's is 3, exactly, and neither is the pool. The Paladin 2 / Warlock 18 agreed with the old reading only
  because a Paladin 2's own table (2) and the pool at caster level 1 (2) are the same row, and pact magic
  has always been its own row.
- **The shared pool is recorded as one number, on the container:** `<magic multiclass="true" level="N">`.
  The pool's slot counts are written nowhere; they follow from the level and the multiclass table.
- The attribute is on both multiclass saves, and only on those: `level="1"` for the Paladin 2 (a
  half-caster's two levels, rounded down) and `level="5"` for the Wizard 4 / Trickster 4 (four Wizard
  levels and one third of four Rogue levels, rounded down).

## Decision

**A block's row is compared with that source's own table, and the shared caster level is compared as its
own row.**

1. `compareSlots` reads the source's own table whenever the system declares one, and falls back to the
   shared table only for a system that declares nothing else. Pact magic needs no special case: it was
   always an own row.
2. The parser keeps `<magic level>`, on a save that says `multiclass="true"`, as
   `AuroraSave.magicLevel`, and `compareCasterLevel` compares it with the stat the system publishes
   (`multiclass:spellcasting:level` in 5e, configurable like every other name here). With no such stat it
   is a `not-modelled` note, as an undeclared slot table is.
3. The oracle's "rows compared" measurement gains a fourth family, `casterLevel`, and is measured the same
   way the other three are: shift the published stat and count what notices.

The shared *pool* is therefore checked indirectly, through the level that indexes it, and that is all
Aurora gives us. A wrong multiclass table with a right level would pass. ADR 0018's table is content,
declared in `systems/dnd5e/system.json`, and is held by the hand-worked rows in
`tools/verify/src/rogue-wizard.test.ts` and not by Aurora.

## Consequences

- **The tenth save compares clean** on every number `<magic>` records: two slot rows, two save DCs, two
  attack bonuses and the caster level, all agreeing, and every spell Aurora lists is derived.
- **What is newly pinned.** Rounding a third-caster down is: rounding four Rogue levels up reads a caster
  level of 6, and Aurora wrote 5. Rounding a *half*-caster down is still not, for the reason ADR 0018
  gave: two levels read 1 either way.
- **Still not covered:** three or more ordinary casting blocks, and an ordinary block beside pact magic
  together with a third-caster. No save has either.
- **One earlier test asserted the wrong belief** ("a caster level moves the comparison to the shared
  pool") and now asserts the corrected one, with its reason. The other eight saves' figures did not move:
  their rows are the same whichever table is read.
- **Bugfix, not new import support.** Nothing about what `packages/aurora-import` reads into a character
  changed. The frozen package gained one optional field on a parsed save and corrected how a recorded
  number is judged, which is what a check that reported a false `stat-mismatch` on real data needed.
