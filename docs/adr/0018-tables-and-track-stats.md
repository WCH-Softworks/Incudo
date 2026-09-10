# 0018 — A stat may be read from a table, and a track may contribute one

**Status:** Accepted · 2026-09-10 · builds on [0015](./0015-class-levels.md), [0016](./0016-stat-bounds-are-expressions.md)

## Context

The multiclass spell slot table is the last of ROADMAP Phase 2's three "remaining numbers", and
the only one whose oracle arrived with the ninth save. `aurora verify` reports it on seven of
the nine saves as:

```
note  spellcasting "Wizard": Aurora recorded spell slots 4/3/3/2/0/0/0/0/0.
      No loaded system declares a slot table, so this is not compared.
```

Eight such rows across the corpus of saves, every one of them a number Aurora computed and
Incudo declines to.

### What the corpus already does, and what it does not

Reading the 740 files first changed the shape of this considerably. Content is *not* silent
about spell slots. Every spellcasting class declares its own table, as ordinary level-gated
stat contributions:

```xml
<stat name="paladin:spellcasting:slots:1" value="2" level="2" />
<stat name="paladin:spellcasting:slots:1" value="1" level="3" />
<stat name="paladin:spellcasting:slots:1" value="1" level="5" />
```

Cumulative, so paladin 2 is 2, paladin 3 is 3, paladin 5 is 4. Those rules sit on the class's
Spellcasting feature, which [ADR 0015](./0015-class-levels.md) puts in that class's track — so
they already produce the right number today, for every single-classed character, with no code
at all. Checked against the Hexadin: `paladin:spellcasting:slots:1` is **2**, which is exactly
what Aurora's `<magic>` block records.

What content does *not* declare is the part Aurora computes in its app:

- **the multiclass caster level**, the weighted sum across classes;
- **the multiclass slot table** it indexes;
- **any aggregate at all.** There is no `spellcasting:slots:1` in the corpus, only
  `paladin:…`, `wizard:…`, `eldritch knight:…`, one prefix per casting class.

But it does declare *which weighting each class uses*, and this is the useful discovery. Every
casting class grants a marker element saying which:

| marker | grants in the corpus | means |
|---|---|---|
| `…SPELLCASTING_SLOTS_FULL` | 11 | add the whole class level |
| `…SPELLCASTING_SLOTS_HALF` | 5 | add half, rounded down |
| `…SPELLCASTING_SLOTS_THIRD` | 4 | add a third, rounded down |
| `…SPELLCASTING_SLOTS_HALF_UP` | 3 | add half, rounded up (the artificer) |
| `…SPELLCASTING_SLOTS_SOLO` | 2 | keep your own slots; stay out of the table |

All five are granted with `requirements="ID_INTERNAL_GRANT_MULTICLASS"`, which the `<multiclass>`
block of every class grants — so **the corpus itself says when the multiclass table applies**,
and Incudo does not have to decide it. Four of the five markers are ids no content file
declares, supplied by `packages/aurora-import`'s overlay; `HALF_UP` is real and lives in
`core/internal.xml`, where it is written as ten level-gated `+1`s to a stat named
`multiclass:spellcasting:level`.

That last file is a worked example of the answer and of what not to copy. It names the stat,
and it computes "half, rounded up" by writing `+1` ten times. Incudo can say `ceil(level / 2)`.

### Two things missing from the engine, and neither is a slot

Expressed as neutrally as they deserve, the gaps are:

1. **A stat cannot be read out of a table.** The 5e multiclass table is twenty rows of nine
   numbers, and the expression language ([ADR 0016](./0016-stat-bounds-are-expressions.md)) has
   arithmetic and a fixed function set. There is no closed form for that table and there should
   not need to be one — it is data.
2. **Nothing can contribute a number *per track*.** ADR 0015 gave every track a published count
   (`level:warlock`), which content reads by name. It gave nothing that iterates: "for each
   track, add half its count". A system definition cannot enumerate the classes — third-party
   content ships its own, and there are 25 casting classes in this corpus alone.

## Decision

### 1. `table` is an expression kind

```jsonc
{ "kind": "table",
  "index":  { "kind": "ref", "stat": "multiclass:spellcasting:level" },
  "values": [0, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] }
```

The index is floored and clamped to the array, so a value below the table reads its first entry
and one above it reads its last. An empty `values` is 0. It is a `StatExpr` like any other, so
it works in a `derive`, in a bound, and nested inside arithmetic — nothing new had to be
invented for it to compose.

Naming the mechanism accurately matters here: this is *"a stat read out of a declared row of
numbers, indexed by another stat"*. Slot tables are one use. Attack matrices, proficiency by
challenge rating, psi points, a sanity track and every other lookup a system might publish are
the same shape.

### 2. A character kind may declare `trackStats`

```jsonc
"trackStats": [
  { "stat": "multiclass:spellcasting:level",
    "when": "ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_HALF",
    "value": { "kind": "call", "fn": "floor",
               "args": [{ "kind": "binary", "op": "/",
                          "left":  { "kind": "ref", "stat": "track:progress" },
                          "right": { "kind": "number", "value": 2 } }] } }
]
```

Read as: **for every track the character has, if `when`'s element is in that track, contribute
`value` to `stat`.** Inside `value`, the reserved reference `track:progress` is that track's own
count. Omitting `when` contributes for every track.

Two further details, both of which the 5e case needs:

- **`{name}` in `stat` makes it a per-track stat rather than an aggregate.**
  `"stat": "{name}:spellcasting:solo"` publishes `warlock:spellcasting:solo`, substituting the
  track element's lowercased name — the same substitution `trackStatPattern` already performs.
  Without `{name}` the entries sum into one stat, which is what a caster level is.
- **A class with no entry contributes nothing.** Pact magic staying out of the multiclass table
  needs no rule; it needs the absence of one. `SOLO` gets a `{name}` flag and no caster level,
  which is the whole of "pact magic is a separate track" said once.

This is where the published rule lives, in one line per weighting:

```jsonc
FULL  → track:progress
HALF  → floor(track:progress / 2)
THIRD → floor(track:progress / 3)
SOLO  → (no caster level; { "stat": "{name}:spellcasting:solo", "value": 1 })
```

`HALF_UP` needs no entry at all: the artificer's is real content and already contributes to
`multiclass:spellcasting:level` on its own.

### 3. An element belongs to every track that reaches it

ADR 0015 recorded one track per element and took the first when two reached it, warning only
when the element had level-gated rules. That is right for gating and wrong for counting, and
the markers are the case that shows it: a Bard 5 / Wizard 5 has *one*
`…SPELLCASTING_SLOTS_FULL` element granted from two tracks, and a caster level of 5 instead of
10 is not a warning, it is a wrong sheet.

So the engine now records the full set of roots that reach each element, and `trackStats` reads
that set. Level gating keeps ADR 0015's first-wins behaviour and its warning, untouched: the two
questions are genuinely different, and answering "which level gates this rule" with a set has no
sensible answer while answering "which tracks contain this" with one has no correct answer.

### 4. `formatVersion` stays at 1

Both additions are optional and additive. Every existing system definition stays valid, an
`expr` that is not a `table` means what it meant, and a kind with no `trackStats` behaves
exactly as before. `schemas/system.schema.json` is a public API ([ADR 0011](./0011-user-systems.md))
and this is the third additive change to it in a row; the next breaking one costs a version.

## What the oracle actually proves, and what it does not

This has to be said precisely, because it is easy to overclaim and the whole point of the
differential check is that it does not.

The Hexadin's two `<magic>` rows are Paladin `2/0/0/0/0/0/0/0/0` and Warlock
`0/0/0/0/4/0/0/0/0`. Against the model above:

- **Pact magic is outside the table: proved.** If the warlock's 18 levels joined the caster
  level it would be 19, and row 19 is `4/3/3/3/3/2/1/1/1` — nothing like either recorded row.
  Warlock 18 producing four 5th-level slots *and* the paladin producing two 1st-level slots is
  only consistent with two separate tracks.
- **A half-caster's contribution is halved: proved.** Paladin 2 unhalved would be caster level
  2, row 2, three 1st-level slots. Aurora records two.
- **Rounding down rather than up: not proved.** `floor(2 / 2)` and `ceil(2 / 2)` are both 1.
  The save cannot tell them apart, and no other save has a second casting class.
- **The multiclass table rather than the paladin's own: not proved.** Multiclass row 1 is two
  1st-level slots; the paladin's own table at level 2 is also two. This particular character is
  a coincidence, and it is worth writing down before someone later reads the passing check as
  more than it is.

`floor` and the multiclass table are what the published rule says, so that is what the system
definition declares. The two unproved halves are unproved, not unsupported — and a tenth save
would settle both: any two classes with the Spellcasting feature and an odd half-caster level,
a Paladin 5 / Wizard 5 for instance, disagrees under every wrong reading.

The rest of the corpus of saves is not idle, though. All eight recorded slot rows become
compared numbers, and the first thing they caught was a real defect: `parseStatValue` read
`value="-warlock:spellcasting:slots:count"` as a reference to a stat named with a leading
minus, which resolves to zero. The warlock's own table subtracts the previous level's slots
that way, so pact magic came out as `4/4/4/4/4` instead of `0/0/0/0/4` — a bug that had been
invisible for as long as the slots were not compared, and that eight of the corpus's stat
values depend on.

## Consequences

**Good**
- Spell slots become declared stats, which is what a sheet needs and what the roadmap asked for.
- The rule is in `systems/dnd5e/system.json`, in the form the Player's Handbook states it, and
  a system that weights its casters differently changes data rather than code.
- Track-relative contributions are the piece ADR 0015 was one step short of. Hit points want the
  same shape — a hit die per level of the class that level was taken in — and now have somewhere
  to live.
- `table` retires a category of "the system needs a closed form for something that is a table".
- The two-tracks-one-element fix is a correctness fix that had no symptom yet and would have had
  an ugly one.

**Bad / accepted**
- `spellcasting:slots:1…9` is zero for a single-classed character, because the markers that feed
  it are gated by content on being multiclassed. The character's real slots are in the class's
  own `paladin:spellcasting:slots:1`, and nothing yet merges the two into one number a sheet can
  show. Aggregating them is not a one-liner: the stat prefix is the *casting feature's* name,
  not the track's — an Eldritch Knight's slots are under `eldritch knight:`, on the `fighter`
  track — so `{name}` cannot reach them. Named here rather than guessed at.
- `trackStats` is a fourth thing on a kind that produces stats, after `stats`, content
  contributions and the progression's own publications. The ordering is stated in code and in
  the schema: track contributions land with the other contributions, before derivations.
- A `table` is unbounded data in a public format, so a system can ship a very long one. The same
  is true of `stats`, and the evaluator does one array read.
- `{name}` substitution inherits ADR 0015's caveat exactly: it derives a stat key from an
  element's name, so an upstream rename renames the stat. One configured string, changed in one
  place.

## Alternatives considered

**Give the marker elements the rules, in `packages/aurora-import`'s overlay.** The smallest
change by far: four elements gain a stat rule each and no format changes at all. Rejected on
the overlay's own stated doctrine — marker elements carry identity and no rules, and "the
mechanic arrives when a system declares a stat for it", because a second copy of the arithmetic
beside the system definition's is the one that goes stale. It would also put 5e's caster-level
rule in the package that is frozen to bugfixes, below the layer where game rules belong.

**Write the weighting as level-gated contributions, the way `HALF_UP` does.** Ten `+1`s for a
half caster, twenty for a full one, six for a third caster, on elements Incudo authors. It needs
no new mechanism whatsoever, which is its whole appeal, and it is a transcription of Aurora's
shape rather than a statement of the rule: `floor(level / 2)` written as a staircase, wrong by
one for a whole level if an entry is mistyped, and unreadable as the sentence it came from.

**Enumerate the casting classes in the system definition** — a list of `{ class, weight }`
pairs, no track machinery at all. It cannot work: third-party content in this corpus ships its
own casting classes, and a system definition that has to name them all is wrong the day a source
is enabled.

**A `casterLevel`-shaped field on the progression**, purpose-built for this. Smaller and
narrower than `trackStats`, and it puts a spellcasting noun into the system format's vocabulary
where `track` and `stat` are the only ones that belong. It also solves exactly one problem;
hit points would need the next such field.

**Compute the table in code behind a system flag.** Rejected on ADR 0003 without argument: the
moment `@incudo/core` knows what a spell slot is, the second system is a rewrite.
