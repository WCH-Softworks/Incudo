# 0023 — Attunement gates an item's rules, and every gate explains itself

**Status:** Accepted · 2026-09-11 · builds on [0005](./0005-aurora-import.md), [0019](./0019-recorded-rolls-are-readable.md), [0022](./0022-kinds-contribute-systems-do-not-ship-content.md)

Decided ahead of the code it governs, which is step 3 of
[docs/INVENTORY-AND-AC-PLAN.md](../INVENTORY-AND-AC-PLAN.md) with the mechanism landing at
step 4. This is the plan's D2.

## Context

5e says an item requiring attunement confers its benefits only to a creature attuned to it.
Whether Incudo should enforce that is the question, and **the nine saves cannot answer it**:
all 12 attunement-requiring equipped items across them are attuned, so there is no
counter-example in either direction. Like hit points ([ADR 0019](./0019-recorded-rolls-are-readable.md))
and like armour class, this is settled by reading the published rule.

Unlike those two, the corpus turns out to have a great deal to say, and it changed the shape of
the answer.

### What content declares

**976 elements carry `<set name="attunement">`** — 968 `true`, 8 `false`. Of the 968:

- **578 carry no rules at all.** Gating is a no-op for three in five of them; they are
  descriptive entries whose whole content is prose and setters.
- **390 carry rules** — 460 `stat`, 292 `grant`, 36 `select`.
- **336 declare an attach constraint** (`armor` or `weapon`), which makes them adorners: a
  Flame Tongue that hangs off a greatsword rather than occupying a slot itself.

That last number matters more than it looks. Because Aurora separates the mundane host from the
magical adorner, **gating an adorner gates exactly the magical benefit and nothing else.** An
unattuned Flame Tongue greatsword is still a greatsword, doing greatsword damage, because the
greatsword is a different element. No special case is needed to get that right.

Setters are not rules, so a gated item still weighs what it weighs and costs what it costs.

### The attunement requirement itself is prose

```xml
<set name="attunement" addition="by a spellcaster">true</set>
```

31 `by a Spellcaster`, 28 `by a spellcaster`, 18 `by a wizard`, 15 `by a sorcerer`, 8
`by a cleric or paladin`, and a tail of others — including the same phrase in two cases. It is
display text, not a predicate: "by a spellcaster" is not a machine-readable condition, and the
casing split proves nobody was parsing it. Aurora does not enforce it and neither will Incudo.

### Nothing in the corpus gates on attunement, and that is the usual finding

None of the 117 `equals` checks mentions it, and there are no `flag` checks anywhere in the
corpus. Aurora decides this in application code, exactly as it does the ability score maximum,
the slot table, hit points, the save DC and armour class.

### But content *does* declare the limit

This was the surprise. `attunement:max` appears 11 times and `attunement:current` twice, in two
shapes that both fall out correctly from the bonus buckets the engine already has:

```xml
<stat name="attunement:max" value="4" bonus="base" />   <!-- Magic Item Adept; 2024 Thief -->
<stat name="attunement:max" value="5" bonus="base" />   <!-- Magic Item Savant -->
<stat name="attunement:max" value="6" bonus="base" />   <!-- Magic Item Master -->

<stat name="attunement:max" value="1" level="5"  />     <!-- UA 2017 artificer: additive -->
<stat name="attunement:max" value="1" level="15" />
<stat name="attunement:max" value="1" level="20" />
```

Against a base of **3** contributed in the `base` bucket, both readings come out right:
largest-wins gives the Artificer 4, then 5, then 6; the unbucketed `+1`s sum, giving the
playtest artificer 3+1+1+1 = 6 at level 20; and a character with neither reads 3. The base is
Aurora's and the deltas are content's — the sixth instance of that pattern, and the first one
where the mechanism needed to read it already existed in full.

A limit nothing can exceed would be decoration. Content bothering to declare one is the closest
thing to evidence the corpus offers that attunement is a real constraint rather than a label.

## Decision

### 1. An unattuned item contributes none of its rules

When an item instance's element requires attunement and the instance is not attuned, its rules
do not apply — not its stats, not its grants, not its selects. Its setters are untouched, so it
still appears in the bag with its weight and its cost.

### 2. Every gate explains itself

An equipped item that requires attunement and is not attuned produces a **warning naming the
item**. This is the part that makes the decision safe rather than merely correct.

The real risk of enforcing was never that the rulebook is unclear; it is a user who imports or
builds a character, does not tick a box, and loses a bonus with no explanation. The project's
standing answer to exactly that shape is [ADR 0005](./0005-aurora-import.md)'s "report it, do
not guess" and ADR 0012-era reasoning that content which explains itself beats content that
vanishes. A missing +1 with a line saying which cloak it came from is a different thing from a
missing +1.

### 3. The limit is derived, and exceeding it is reported

`attunement:max` gets its base of **3** from the 5e kind's `contributions`
([ADR 0022](./0022-kinds-contribute-systems-do-not-ship-content.md)), in the `base` bucket, with
no `requirements` — which is worth noting, because ADR 0022 was argued entirely from four
*conditional* rules and this is its first unconditional user. A `StatDef` `default` cannot do
this job: a default is a base that contributions add to, so `default: 3` plus the Artificer's
`4` would read 7.

`attunement:current` is the count of attuned instances. Exceeding the limit is a **problem the
derivation reports**, in the family of `over-selected` — not a refusal. A character who is over
is a character with something to fix, and the engine's job is to say so.

### 4. The system names the setter; core never says "attunement"

Core cannot know the word. The character kind's inventory declaration — the same place step 4
declares slots — names which setter marks an item as requiring attunement, and which stat holds
the limit. One string each, and a system with no such concept omits them and gets no gating.

### 5. The prose requirement is not enforced

`addition="by a wizard"` is shown and never evaluated. Deciding that a warlock/wizard
multiclass satisfies "by a wizard" means parsing English, and the corpus writes the same
condition four different ways.

## What this is and is not evidence of

Stated plainly, because the project has been caught once already by a check that looked like it
was proving something ([ADR 0020](./0020-stats-keyed-on-declared-blocks.md)).

- **The gate is unverified and unverifiable against Aurora.** All 12 attunement-requiring
  equipped items in the nine saves are attuned. `aurora verify` will gain no comparison, and a
  green run after this lands means only that nothing regressed.
- **The limit is partly verifiable.** `attunement:max` is a stat both sides can hold, but no
  save records a derived value for it, so it is in the same position: the arithmetic is
  checkable by inspection and not by diffing.
- **The bucket reading is supported but not proved.** That an Artificer reads 4 rather than 7
  follows from `bonus="base"` and from the engine's existing largest-wins, both of which are
  already exercised elsewhere. No sample save has an Artificer.

## Consequences

**Good**
- The sheet stops being quietly generous. An unattuned Cloak of Protection is a cloak.
- Because adorners are separate elements, the mundane half of a magic weapon keeps working with
  no special case.
- Attunement becomes a real, counted thing rather than a flag nothing reads, and the Artificer's
  progression works out of content that already exists.
- ADR 0022's `contributions` gets a second, unconditional user, which is a small check that it
  was the right general shape rather than an AC-specific one.

**Bad / accepted**
- A number on the sheet now depends on a checkbox, and a user who leaves it unticked sees a
  lower number. Mitigated by the warning, and only mitigated — a warning nobody reads is a
  silent difference.
- 578 of the 968 attunement items carry no rules, so for most of them this machinery does
  nothing visible. The cost is paid once and the benefit is concentrated in the 390 that matter.
- Two more strings in the system format's inventory declaration, on top of the slots.

## Alternatives considered

**Do not gate; let an equipped item contribute whatever it declares.** Simpler, needs no setter
name in the system format, and cannot produce the "why did my AC drop" question. Rejected
because it is wrong by the published rule in a way that compounds: attunement exists precisely
to limit how many magic items stack, so not enforcing it makes the one rule in 5e designed to
bound item stacking do nothing. It would also make `attunement:max` pointless to model, and
content went to the trouble of declaring it.

**Gate silently, with no warning.** Half the work and most of the risk. The failure mode is a
user comparing Incudo's sheet with their own arithmetic and finding no explanation anywhere;
that is the failure ADR 0005 exists to prevent, and it costs one `Problem` to avoid.

**Refuse to derive a character that is over the attunement limit.** Symmetrical with refusing
an invalid system (ADR 0011) and wrong here: a system definition is authored once and a
character is edited constantly, so a character mid-edit is routinely in a state the rules do not
permit. The engine reports and keeps deriving, as it does for `over-selected`.

**Enforce the prose requirement.** Covered above: it is English, written four ways.

**Wait for an oracle.** There is no tenth save that would settle it — Aurora records the
attunement flag and never a derived consequence of it, so no sample could. Waiting means
shipping the generous reading by default, which is a decision too.
