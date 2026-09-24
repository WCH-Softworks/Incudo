# 0048 — A leading `!` on a filter operand negates it, and is read when the filter is evaluated

**Status:** Accepted · 2026-09-23 · completes [0030](./0030-a-declared-block-answers-a-filter.md)'s list of
unread operands (`!`) · builds on [0005](./0005-aurora-import.md), [0012](./0012-self-contained-saves.md),
[0047](./0047-a-filter-operand-may-name-a-true-setter-and-the-system-says-which.md) ·
**format:** none (`formatVersion` of the system format and of `.incu` stay as they are)

## Context

ADR 0030 named three operands of the `supports` filter language it left unread and called `!` "the obvious
next thing": `parseAtom` read `!TCOE Base` as one literal tag, nothing carries that tag, so every select using
one offered an empty list. ADR 0047 closed `Ritual`; this closes `!`.

### What the corpus contains (AuroraLegacy/elements at `c28ce6c`)

| | |
|---|---|
| `supports=` attributes containing a `!` | **18**, in 8 distinct strings |
| select rules that carry one once parsed | **14** |
| shapes | `Artificer Infusion, !TCOE Base` (5) and `!ERLW Version` (5) and the Specialist pair (2), on the Artificer in Eberron and in Tasha's; `Ability Score Increase,Dragonmark,!<ability>` (4), the Dragonmarks; `(ID_…SIMPLE_MELEE\|\|ID_…MARTIAL_MELEE),!ID_…TWOHANDED` (2), Bladesinging's weapon training |
| operands negated | a tag (`TCOE Base`, `ERLW Version`), a setter value or tag naming an ability (`Wisdom`), an element id (`ID_INTERNAL_WEAPON_PROPERTY_TWOHANDED`) |
| a `!` before a `(` or a `$(`, or inside a word | **0** |

So what is negated is always **one operand**, which is what the parser already produces for `!TCOE Base`; the
only thing missing is the meaning. What is negated is an operand in the same sense a positive one is: a tag,
an element's own id, or the value of one of its setters.

### Witnesses

Two committed samples (the Artificers, 01 and 03) pick through negated selects: a specialist and four
infusions each, ten picks, all recorded by Aurora, so each must pass the filter. That is a real second reading of
the operator, not the author's: it fails if `!` meant anything but "does not carry".

## Decision

### 1. `!X` is true when the candidate does not answer to `X`

A tag operand whose text starts with `!` and has something after it is negated: it holds when the candidate
carries no tag, is not the id, and has no setter value equal to the rest (whitespace after the `!` ignored,
case ignored as for a positive operand). The kind's `setterTags` of ADR 0047 count as tags, so `!Ritual` reads
the setter too. A lone `!` is still a literal tag. A negation composes with `,`, `||` and a group exactly as a
positive operand does: `(A||B),!C` is "A or B, and not C".

### 2. It is read where the filter is evaluated, and the parser is untouched

A `.incu` embeds **parsed** elements (ADR 0012). If the parser produced a `not` node, every character saved
before this change would still hold the literal tag `!TCOE Base` in its embedded rules, and would keep offering
nothing. Reading the leading `!` in `matchesSupports` fixes those saves too, with no re-save. This is the same
argument ADR 0046 made for reading `:half` where a reference is evaluated. The cost: the parsed form still says
"a tag called `!X`", and a `!` before a group or an interpolation is not a negation. The corpus has none, and if it
grows one, that is the case for a `not` node and a `formatVersion` on embedded rules.

### 3. What it does not change

Nothing in `aurora verify` moves and none can: it compares the elements a character chose, and an imported
character already holds them. `INCUDO_ORACLE_SNAPSHOT` on the commit before and `INCUDO_ORACLE_BASELINE` on this
one: every table for all thirty samples is identical (a baseline altered by one difference fails, so the check was
live).

## What was measured after it was built, and what cannot be

- **What each select offers**, for a fresh character seeded with the rule's owner: Bladesinging's weapon training
  offers 21, the two Artificer Specialist selects 5 each, and each Dragonmark's ability increase 5. **The ten
  Artificer Infusion selects are level-gated and were not open for that character**, so the offered list is
  unmeasured there; the sample test below is what covers them.
- **`negation-filter.test.ts`** reads each negated select's expected list from the elements with a small evaluator
  that shares nothing with `matchesSupports`, and compares it with what the engine offers and admits. It does not
  pin how many such selects there are. Every recorded pick in the samples passes its filter (10 picks). Without the
  change the first and the third tests fail, and they pass with it.
- `supports.test.ts` covers a negated tag, id and setter value, a negation inside a group and beside `||`, a lone
  `!`, and `!` inside a word.
- **Not verified.** No Aurora number vouches for a candidate list. **Driven in the Tauri window on Windows
  (2026-09-24):** a Tasha's Artificer at level 2 was offered 11 infusions for "Artificer Infusion (Level 2)", nine
  of Tasha's own and two Unearthed Arcana ones (Armor of Tools, and a second Mind Sharpener), and none of the 22
  Eberron ones, which carry `ERLW Version`; at level 3 the Artificer Specialist offered five (Alchemist, Armorer,
  Artillerist and Battle Smith from Tasha's, and the UA Armorer), and none of the Eberron three. A human Mark of
  Making offered five Dragonmark ability increases and not Intelligence, which the mark fixes at +2; the
  Charisma pick came out as +1, and all three saved characters reopened with their picks after a restart with no
  source enabled. macOS and Linux were not driven.

## Consequences

**Good**
- Every Artificer infusion and specialist, every Dragonmark ability increase and Bladesinging's weapon training
  are offered by the builder. None of ADR 0030's three unread operands remains: `Class` was never one,
  `Ritual` is read (ADR 0047), and this was the last.
- Characters saved before this change benefit without being re-saved.

**Bad / accepted**
- A filter cannot negate a group or an interpolation. Nothing in the corpus does, and the failure is an empty list
  with no diagnostic.
- The parsed form of an element still holds the literal `!TCOE Base`; anything that walks parsed filters without
  going through `matchesSupports` sees a tag called that.

## Alternatives considered

**A `not` node in the parser.** Cleaner, expresses `!(A||B)`, and would need `.incu` content to be re-embedded to
reach saves already written (decision 2). Held in reserve for the day the corpus needs a negated group.

**Only negate tags, not ids or setter values.** The corpus negates an id and an ability name, and a positive
operand already means all three, so the two would disagree for no reason.
