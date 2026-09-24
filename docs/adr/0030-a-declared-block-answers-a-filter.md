# 0030 — A declared block answers a select's filter, and three things about that filter were wrong

**Status:** Accepted · 2026-09-13 · builds on [0020](./0020-stats-keyed-on-declared-blocks.md),
[0018](./0018-tables-and-track-stats.md) · fixes bugs under [0008](./0008-aurora-compatibility-frozen.md)'s freeze

## Context

`<select supports="$(spellcasting:list), $(spellcasting:slots)">` is how every casting class in
the Aurora corpus says which spells a character may choose. `candidatesFor` in
`packages/core/src/engine.ts` carried a comment saying the build context needed to resolve
`$(…)` was "supplied in the UI layer". No caller supplied it. No caller could have: the context
is which block the rule belongs to and what the derivation published for that block, and a
screen knows neither. So every spell select in the game offered an empty list, and this was the
last engine-side blocker on ROADMAP Phase 2's exit criterion.

The interpolation is bounded, not open-ended. Counted in the 740-file AuroraLegacy corpus:

| | |
|---|---|
| `$(…)` keys in the entire corpus | **2** — `spellcasting:list`, `spellcasting:slots` |
| attributes any `$(…)` appears in | **1** — `supports` |
| tags any `$(…)` appears on | **1** — `<select>` |
| `<select>` rules carrying one | **328** written, **323** parsed (the difference is below) |
| of those, naming their block with `spellcasting="…"` | **323 — all of them** |
| distinct block names they name | 11 |

### The work turned out to be four things, and only one of them is this ADR's design

Making the interpolation resolve is necessary and was nowhere near sufficient. Resolving
`$(spellcasting:list)` for a Bard to the tag `Bard` and `$(spellcasting:slots)` to `1` still
offers **nothing**, because three separate things about the filter language were wrong. Each was
found the way ADR 0008's four dropped constructs were: by counting what the corpus contains.

**1. `||` is the looser operator, and `parseSupports` had it backwards.** It split on `,` first
and on `|` within, making `||` bind tighter. The corpus refutes that, and does it with a piece
of content written specifically to be OR-ed in. Tasha's Aberrant Mind writes

```xml
<select type="Spell" supports="1,(Divination||Enchantment),(Sorcerer||Warlock||Wizard)||Arms of Hadar" />
```

and then, in the same file, appends a bespoke tag to that one spell so the trailing operand has
something to find:

```xml
<append id="ID_PHB_SPELL_ARMS_OF_HADAR"><supports>Arms of Hadar</supports></append>
```

Arms of Hadar is a 1st-level **Conjuration**. Under the old precedence the school clause ANDs
across the whole filter and excludes the very spell the `||` exists to add, and that appended
tag is dead content. Under the corrected one it reads as written: "a 1st-level div/ench
sorcerer/warlock/wizard spell, *or* Arms of Hadar". Same precedence as `requirements`, where
`parseRequirements` has always had `!` > `,` > `||` and docs/AURORA-FORMAT.md has always said so.
The two languages were simply never compared.

Find Familiar is the second witness, from a different book: `supports="Familiar||Variant
Familiar||Beast,0"` means "any familiar, or a CR 0 beast". Under the old reading the Imp — CR 1,
and tagged `Familiar, Variant Familiar` precisely so this filter finds it — was excluded.

**2. Parentheses group, and nothing parsed them.** 131 of the corpus's 2,466 `supports=`
attributes contain a bare `(`; not one was handled. `Skill,(Intelligence||Wisdom||Charisma)`
parsed into the operands `(Intelligence`, `Wisdom`, `Charisma)` and offered only the Wisdom
skills. Thirteen of the 131 also carry a `$(…)`, which is why six of the corpus's interpolations
came out of the parser with the key `spellcasting:list)` — a trailing paren swallowed into the
key by `(Wizard||$(spellcasting:list))`.

Note the asymmetry this creates, and that it is safe. Element-level `<supports>` is a
comma-separated list of **literal** tags where a paren is just a character: 16 elements carry
one like `Fighter (Eldritch Knight)`. A *filter* naming such a tag could not be written in this
language any more — but the corpus contains no attempt to write one. Measured: zero `supports=`
operands have a `(` following a word character.

**3. An operand may name a setter's value, and only tags were being read.** A spell's level and
school are `<set name="level">0</set>` and `<set name="school">Evocation</set>`, not tags. So
`"$(spellcasting:list), 0"` cannot match a cantrip however well the interpolation resolves, and
`"2,(Illusion||Transmutation)"` cannot match anything at all. Same for a companion's `size` and
`challenge`: `"Beast,(Tiny||Small||Medium),(1/4||1/8||0)"` reads three setters and one tag.

Counted: of the 930 distinct literal operands in the corpus's select filters, **74 match no tag
and no element id**, and once the paren mis-parses are removed the remainder is dominated by
spell levels and schools. Fixing this changes 210 filters and empties none.

### A fifth silently dropped Aurora construct

`parseSpellcasting` read every attribute of `<spellcasting>` and dropped its one child element.
There are **17 `<list>` blocks** in the corpus across 10 distinct values, and the tag
`$(spellcasting:list)` needs has therefore never reached the engine at all. That is the same
family as the four docs/AURORA-FORMAT.md already names, and it is a **bugfix**, so ADR 0008's
freeze permits it.

Two measurements shaped the design rather than confirming it:

- **A `<list>` is usually absent.** 17 of the 91 named blocks declare one; the other 74 do not,
  including Cleric and Druid, whose spells are tagged with the block's own name. So the common
  case has to fall back to the name, and the fallback is the path almost every caster takes.
- **A `<list>` is not always the block's name, and not always one tag.** Five of the 17 differ
  from their block's name, and two of those are sub-expressions:
  `Wizard,(Abjuration||Evocation)` for the 2014 Eldritch Knight and
  `Wizard,(Enchantment||Illusion)` for the 2014 Arcane Trickster. An Eldritch Knight's block is
  named `Eldritch Knight`, nothing in the corpus is tagged that, and a `{name}`-only fallback
  would offer it zero spells forever.

## Decision

### 1. The filter language is corrected: precedence, grouping, setter operands

`packages/core/src/supports.ts` becomes a recursive-descent parser — `or := and ("|" "|"? and)*`,
`and := atom ("," atom)*`, `atom := "$(" key ")" | "(" or ")" | tag` — and `SupportsContext`
gains `setterValues`, a lowercased set of the candidate's setter values that an operand may name
alongside its tags and its id.

Setter matching is **unconditional across every setter** rather than narrowed to a list of names,
and the corpus is why: narrowing would be a guess, and it buys nothing. Over the operands `0`
through `9`, matching any setter and matching only `level` select **exactly the same spells** —
0 extra in every case. The 28 filters that already matched something and grew are all the
`||<named spell>` family and the two familiar ones, and in each the growth is the AND clause
finally working.

Across the 2,138 interpolation-free select filters in the corpus, the three corrections together
take the number that match nothing from **343 to 124**. The 124 that remain are mostly filters
naming options no loaded book provides, which is a legitimate answer, plus three constructs left
unfixed and named below.

### 2. `$(key)` expands to a sub-expression, and the *system* says how

`SupportsContext.resolve` widens from `string | undefined` to `SupportsExpr | undefined`, because
neither of the corpus's two keys is one tag: one is `Wizard,(Abjuration||Evocation)` and the
other is a set whose width changes as the character levels.

Core cannot own the keys — both spell a word `packages/core` is not allowed to know — so a
character kind declares them, in the vocabulary ADR 0020 already built:

```jsonc
"blockFilters": [
  { "key": "spellcasting:list",  "tags": ["{list}", "{name}"] },
  { "key": "spellcasting:slots", "tagsFromStats": ["{name}:spellcasting:slots:*",
                                                   "spellcasting:slots:*"], "fillFrom": 1 }
]
```

This is the **fourth** thing a declared block does, after ADR 0020's three keyings of a stat, and
it needs no new concept: a rule may be attached to a named block, and the filter it carries is
written in terms of what that block and the derivation publish. Two forms:

- **`tags`** — a fallback chain over the block's name and attributes, using the same `{name}` and
  `{attribute}` placeholders `blockStats` uses. The **first entry whose placeholders all resolve
  wins**, and whatever it expands to is parsed as a `supports` sub-expression. A chain and not an
  OR: the two alternatives disagree on purpose, and OR-ing `Eldritch Knight`'s list with its name
  would offer the whole wizard catalogue.
- **`tagsFromStats`** — stat-name patterns carrying one `*`, which matches a single `:`-delimited
  segment. Every stat the derivation settled that matches and holds a **positive** value
  contributes its captured segment as a tag, and the whole is an OR. This is how "any level you
  have slots for" is written without core learning what a slot is, and it widens on its own as
  the character levels, because ADR 0018 already made those stats derive correctly. Nothing here
  recomputes a slot table; it reads the one content and the system already publish.

**`fillFrom` exists because a warlock forced it, and the saves are the evidence.** A bard's slot
table is cumulative, so its captures are already `1,2,3` and a range changes nothing. Aurora
writes pact magic as `+count` at one level and `-count` at the next, so a warlock publishes
exactly **one** positive slot stat. The two real warlock saves confirm what that means:

```
Paladin 2 / Warlock 18 save  block "Warlock"  slots=[0,0,0,0,4,0,0,0,0]  spells: L1:3 L2:2 L3:3 L4:2 L5:4 L6:1 L7:1 L8:1 L9:1
Warlock 12 save  block "Warlock"  slots=[0,0,0,0,3,0,0,0,0]  spells: L1:3 L2:2 L3:2 L4:2 L5:2 L6:1
```

Levels 6 through 9 come from Mystic Arcanum, whose selects hardcode their level
(`supports="Warlock,6"`). Levels 1 through 5 are the `$(spellcasting:slots)` select. Taking the
captures literally would offer a level 18 warlock 5th-level spells **and nothing else**.
`fillFrom` says "a resource published at one level covers everything at or below it", which is a
statement about the game and therefore lives in `system.json`.

### 3. Unresolved is reported; resolved-and-empty is not

`PendingChoice.unresolvedSupports` (commit e59bb70) used to list every interpolation in a pool,
which was the same list, because nothing resolved. It now lists only the terms that really did
not resolve, and `expandBlockFilter` returns a distinguishable `NEVER_MATCHES` for an expansion
that legitimately found nothing. A level 1 paladin has no spell slots; that is an answer, not a
gap, and "you have no slots yet" must not render as "Incudo cannot read this filter". Keeping
those two sentences apart is the entire reason `unresolvedSupports` was added, and it has already
cost one wrong diagnosis.

An interpolation that resolves to nothing still matches nothing — **short rather than
over-inclusive**, and deliberately. A filter Incudo cannot evaluate that silently offered the
whole spell catalogue would look like a working feature.

### 4. `checkSystemReferences` gains three checks, and `formatVersion` stays at 1

`blockFilters` is optional and additive, so every existing system definition stays valid and a
kind declaring none behaves exactly as before. This is the fifth additive change to
`schemas/system.schema.json` in a row ([ADR 0011](./0011-user-systems.md)); the next breaking one
costs a version.

The checks exist because this mechanism fails *silently*: a `blockFilters` entry that can never
expand leaves the select offering an empty list, which is indistinguishable from a content source
the user has not enabled. Refused at load: an entry with neither `tags` nor `tagsFromStats`, a
pattern without exactly one `*`, and a duplicate key.

## What the oracle proves, and what it cannot

**0 `spell-missing` holds across all nine saves, and every other count is byte-identical** —
1 `element-missing`, 0 `stat-mismatch`, 55 `element-extra`, 3 `not-modelled`, 13
`content-missing`. Diffed as text against the pre-work tree rather than compared as counts.
That is real: it says the precedence change, the grouping and the setter operands did not break
a single one of the 951 compared element ids.

> **Note, 2026-09-23 — re-derived from the thirty sample saves**, as a before/after over the three commits
> that changed the `supports` language and resolved `$(…)` (`f1eef6f^` against `0487b9e`, one script at both,
> corpus at `c28ce6c`). **All 30 are identical**: every derived element and its order, every stat, the pending
> choices, the problems and every difference against Aurora, so the "byte-identical" claim reproduces, on
> 3,433 compared element ids in place of 951. `spell-missing` is **0** across the 30, and the samples' 29
> casting blocks list spells that all derive, so "a set of real saves *are* an oracle for which spells a
> character ends up with, and they agree" holds. The candidate counts in the bullets below (161, 205, 171,
> 23, the Eldritch Knight's 6 and 20) are measured on hypothetical characters against the corpus and are
> not save figures; they were not re-run here and the corpus has moved since. The 13 `!` uses, 17 `Ritual`
> uses and nine empty selects are corpus counts and are likewise not re-derived.

**It says nothing about whether the candidate lists are right.** `aurora verify` compares the
elements a character *chose*; a filter that resolved to everything would move no count anywhere.
The evidence for the filtering is measurement and perturbation:

- A level 5 Bard is offered 161 spells across levels 1–3 and no others, matching the slot table.
  A level 3 Wizard: 205 across levels 1–2. A level 9 Warlock: 171 across levels 1–5 — the
  `fillFrom` case, which without it offers 23, all 5th level.
- **The Eldritch Knight and Arcane Trickster are the case that fails loudly under the wrong
  reading**, the way the Eldritch Knight's stat namespace was for ADR 0020. At level 7 the EK's
  2nd-level candidates are 6 abjuration and 20 evocation and nothing else; the Arcane Trickster's
  are 11 enchantment and 15 illusion. Both blocks are named after the archetype, nothing in the
  corpus is tagged with either name, and both would offer zero without the `<list>` this change
  reads. Their 1st-level candidates are all schools, correctly: content's level-3 rule ORs the
  plain `Wizard` list back in for one free pick.
- `packages/core/src/engine.test.ts` removes each half of the resolution in turn and asserts the
  list gets *wider*, on a fixture with no game in it.

`ac` and `hp` are still checked by nobody ([ADR 0026](./0026-armour-class-is-derived-and-checked-by-nobody.md),
[ADR 0019](./0019-recorded-rolls-are-readable.md)). Candidate lists now join them, with one
difference worth stating: a set of real saves *are* an oracle for which spells a character ends up
with, and they agree.

## Consequences

**Good**
- A caster can choose spells. That is Phase 2's exit criterion unblocked, and the first time the
  filter language has actually worked for anything with a level or a school in it.
- Three corrections to `supports` reach every select in the game, not only spell ones. A Battle
  Master's manoeuvres, a Kensei's weapons, a Find Familiar, and every skill filter with a
  parenthesised group behind it all start offering candidates.
- Nothing new was invented to hold the resolution: `blockFilters` reuses ADR 0020's block, its
  placeholder syntax and its merge-by-name, and reads stats ADR 0018 already derives.
- `unresolvedSupports` becomes true rather than vacuous.

**Bad / accepted**
- A filter can no longer name a tag containing a parenthesis. Zero of the corpus's 2,466 filters
  try to, and 16 elements carry such a tag, so the risk is a future filter, not an existing one.
  Whoever hits it will get an empty list with no diagnostic.
- Setter matching is by value with no way to say *which* setter. `"0"` means "some setter of this
  element holds 0", not "its level is 0". That is all the filter language can express — Aurora's
  own operands carry no setter name — and the corpus says the distinction never bites. It could,
  in content nobody has written yet.
- **Three constructs are still unread, and are reported here rather than guessed at**
  ([ADR 0005](./0005-aurora-import.md)):
  - **`!` negation in a filter** *(note, 2026-09-23: read since [ADR 0048](./0048-a-leading-bang-on-a-filter-operand-negates-it-and-is-read-when-the-filter-is-evaluated.md))* — 13 uses (`Artificer Infusion, !TCOE Base`, `Ability Score
    Increase,Dragonmark,!Wisdom`). `parseAtom` reads `!X` as a literal tag, which matches
    nothing, so those nine selects offer an empty list. Unambiguous and cheap, and left out only
    because no spell select uses one; it is the obvious next thing.
  - **`Ritual`** — 17 uses. A spell carries `<set name="isRitual">true</set>`, so Aurora maps a
    true boolean setter to a tag named after it. Deriving the tag name from the setter name
    (strip `is`, strip `has`?) is a guess with no second witness in the corpus.
  - **`Ritual`** *(note, 2026-09-23: read since [ADR 0047](./0047-a-filter-operand-may-name-a-true-setter-and-the-system-says-which.md),
    as a named `setterTags` pair and not a naming rule)*.
  - **`Class`** — 15 uses, on the level 4/8/12/16/19 ability score improvement. Not a tag on any
    of the 12,058 elements, not any setter's value, and nothing in the corpus explains it.
- A kind now has four things a declared block feeds: `blockStats`, a `perBlock` sheet section,
  and now `blockFilters` — plus `declaredBlocks` itself. The vocabulary is stable, but the block
  is doing a lot of work for a concept whose only instance in the wild spells "spellcasting".
- ADR 0020 and two code comments said "91 of the corpus's 118 blocks are nameless". That is the
  **named** count; 27 are nameless and 93 carry `extend="true"`. The behaviour was always right
  and only the number was upside down. Corrected in the comments; recorded here rather than
  edited into an accepted ADR.

## Alternatives considered

**Resolve `$(…)` in the UI layer, as the old comment said.** The comment was not a plan, it was
a placeholder that outlived two wrong diagnoses. Neither half of the context is presentational:
which block a rule belongs to is on the rule, and the slot levels are stats the derivation
settled. A view-model doing this would have to re-derive to answer it, and the CLI and the mobile
shell would each need their own copy. Deleted rather than corrected.

**Let core know the two keys.** Fifteen lines and the end of ADR 0003. `spellcasting:list` is a
game-specific noun, and a hardcoded key is one no user-authored system could ever add to.

**Make `resolve` return a tag, and expand a multi-tag list into several interpolations.** Keeps
the existing signature. It cannot express `Wizard,(Abjuration||Evocation)` at all — a single tag
has no room for an AND over a nested OR — and it cannot express a slot set whose size depends on
the character. Both of the corpus's two keys need the wider return.

**Compute the slot levels in the resolver instead of reading stats.** Straightforward, and it
would put a second copy of 5e's multiclass slot table beside the one ADR 0018 already made
derive correctly. Same argument ADR 0018 and ADR 0020 both made against the overlay: the second
copy is the one that goes stale.

**Have `tagsFromStats` mean "1 through the largest capture" always, with no `fillFrom`.** One
fewer field, and it makes the range a property of the mechanism rather than of the game. Wrong
for any system whose published set is genuinely sparse — a filter over which damage types you
have resistance to should not fill in the gaps — and the default has to be the literal captures
because that is the only one core can justify.

**Narrow setter matching to setter names the system nominates.** Safer-looking, and the corpus
says it is unnecessary (0 difference over levels 0–9) and unwritable: the filter language names
no setter, so the system would be guessing which one each operand meant.

**Fix the precedence and the parentheses but not the setters, and ship `$(…)` alone.** The
scope the task asked for, and it would have delivered a feature that still offers zero
candidates: without setter operands, `"$(spellcasting:list), 0"` matches no cantrip however
perfectly the interpolation resolves. All three corrections are load-bearing for the deliverable,
so all three are in, and each is a separate commit with its own measurement.
