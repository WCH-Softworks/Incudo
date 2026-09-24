# 0047 — A filter operand may name a setter that is true, and the system says which

**Status:** Proposed · 2026-09-23 · completes [0030](./0030-a-declared-block-answers-a-filter.md)'s
list of unread operands (`Ritual`) · applies [0005](./0005-aurora-import.md)'s rule about guessing ·
**format:** an optional `setterTags` on a character kind in the system format (`formatVersion` stays 1)

## Context

ADR 0030 corrected three things about the `supports` filter language and named three it left unread.
`Ritual` was the second: 17 uses, all on selects that offer spells. A spell carries
`<set name="isRitual">true</set>`, so Aurora evidently maps a true boolean setter to a tag named after
it, and ADR 0030 declined to derive that name from the setter name because it had one witness. The
consequence is concrete. The Ritual Caster feat, a Warlock's Pact of the Tome and Book of Ancient
Secrets, and Quicksmithing all choose spells through `Ritual`, so the builder offers each an empty list
and says "No candidate in the loaded content matches this choice". `rogue-wizard-aurora.test.ts` names
the two spells one sample's feat records (Comprehend Languages and Alarm) as the single expected missing
pair, written to fail the day this is fixed.

This ADR is the measurement ADR 0030 asked for, and a decision about what it does and does not license.
Measured on AuroraLegacy/elements at `c28ce6c`, and on the committed sample saves.

### What the corpus contains

| | |
|---|---|
| `supports=` attributes with a `Ritual` operand | **17**, in five files (2014 and 2024 Player's Handbook, the 2014 and 2024 invocations and feats, one Unearthed Arcana) |
| their shape | `Ritual,1` (9), `1,Ritual` (2), `Ritual,1,<class>` (6, the six class-specific Ritual Caster feats) |
| selects that carry it | 17 (`Ritual Caster` 2014 ×6 and 2024 ×8 slots, Book of Ancient Secrets, Pact of the Tome, Quicksmithing) |
| spells | 1,079 |
| spells with `<set name="isRitual">true</set>` | **69**, and 613 more say `false` |
| element-level `<supports>Ritual</supports>` on any element | **0**: `Ritual Caster` appears (a different, literal tag on the feat), `Ritual` never |

So the tag is not written anywhere. The only place a spell says it is a ritual is the setter, which is
what makes the operand unreadable today: ADR 0030's setter matching reads setter *values*, and a filter
naming `Ritual` matches no value on any spell.

### Second witness: the samples

Two committed samples pick spells through a `Ritual` filter: sample 06 (Rogue / Wizard, the Ritual
Caster feat: Comprehend Languages, Alarm) and sample 30 (a 2024 Warlock, Pact of the Tome: Identify,
Detect Magic). **All four are `isRitual` true**, and none picked through a `Ritual` filter is false. That
is a witness that Aurora's rule reads the setter, from two editions and two different selects.

### Does any other boolean setter act as a tag? The general rule is not supported

There are 26 setter names in the corpus whose values are `true` or `false`. Checked against every filter operand and every
element-level tag:

- `exotic` and `standard` are the two other setters whose names are also filter operands (158 and 168
  uses of `Standard||Exotic`). They are **also written out as a tag**: `<supports>Exotic</supports>` on
  the language. So they are not a witness: the content states both, and the two would agree.
- `attunement` appears in one filter, as part of the literal tag `Totemic Attunement`.
- `concentration`, `stackable`, `valuable`, `cursed`, `official`, `playtest`, `supplement`, the three
  `has…Component` names and the rest are in **0** filters.

One setter needs the rule and one witness pair says it holds. "Any true boolean setter is a tag named
after it, minus an `is`/`has`" would also be consistent with every measurement, but it is a general claim
resting on the same one setter, it adds an unmeasured tag for every other one of them, for no
operand that uses it, and the two languages' explicit tags are some evidence that content writes a tag
where it wants one. A tag Incudo invents where content never asked for one is the over-inclusion ADR 0030
chose not to risk.

## Decision

### 1. A kind declares which true setters are tags

```jsonc
"setterTags": [
  { "setter": "isRitual", "tag": "Ritual" }
]
```

An element whose setter of that name holds the value `true` (compared without regard to case or
surrounding space, the way every other setter value is read) carries the tag as far as a **select's
filter** is concerned. `false`, an empty value and an absent setter do not. The tag is read by the
filter and nowhere else: it is not added to the element's own `supports`, so it is not written into an
embedded save, does not appear in a content browser's tag list, and changes no derivation. It is
replaced rather than merged along an `extends` chain, like `blockFilters`.

It is a **named exception**, not a rule: core says nothing about rituals, and a system (or a user's
system, ADR 0011) that has another setter Aurora-style content filters on lists it here. If a second
`setterTags` entry is ever needed, that is the evidence for the general rule, and the ADR that adds it
can replace the list with a rule.

### 2. It lives beside `blockFilters` and reaches every path that evaluates a filter

Candidate lists, pending choices, and the preparation pool all go through `candidateAccepted`, so the
change is in one function. The resolver that already carries a kind's `blockFilters` (and is absent
when a kind declares none) carries the tags too, and is built when either is declared. `checkSystemReferences`
refuses an entry with an empty setter or tag, and a duplicate setter, for the reason ADR 0030's checks
exist: this fails silently as an empty picker.

### 3. What it does not change

`aurora verify` cannot see this and this ADR does not claim it can. It compares the elements a character
chose, and a character imported from a save already holds them. The evidence is what the builder *offers*:
`rogue-wizard-aurora.test.ts` builds the Rogue 4 / Wizard 4 one level at a time, and its named exception
(Comprehend Languages and Alarm not offered) goes, replaced by the two being offered and accepted.

## Consequences

**Good**
- The Ritual Caster feat, Pact of the Tome, Book of Ancient Secrets and Quicksmithing offer their
  candidates. Phase 2's builder no longer has a known feature that offers nothing for a spell.
- One more of ADR 0030's three unread operands closes, with the reasoning for not generalising recorded
  rather than left as a guess in a comment.

**Bad / accepted**
- A system that spells the setter differently declares it. Content that filters on a true setter by name
  and is not listed still offers nothing, and there is no diagnostic; ADR 0030's `unresolvedSupports` is
  about `$(…)` and does not cover a tag that never matches.
- The 613 spells that say `isRitual` false are read as "not a ritual", which is what the word says. A
  spell with no `isRitual` setter at all (homebrew) is not a ritual to this filter either.

## Alternatives considered

**Any true boolean setter is a tag, in core.** Argued against above: one witnessing setter, a claim about
Aurora's behaviour nobody has seen, and it puts a naming convention (`is…`) into core for a game's data.

**Add `Ritual` to each spell's `supports` at import.** Rewrites 69 elements' identity and would be written
into every embedded save (ADR 0012), fixing the tag into files. The mapping is a reading of a filter, so it
belongs where the filter is read.

**Hard-code `isRitual` in core.** A game-specific noun in `packages/core` (ADR 0003).
