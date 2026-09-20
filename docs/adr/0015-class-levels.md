# 0015 — A character records which track each point of progression was spent on

**Status:** Accepted · 2026-09-10 · amends [0006](./0006-derived-character-state.md), [0009](./0009-character-kinds.md) ·
amended by [0040](./0040-a-chosen-element-follows-the-track-of-the-element-that-offered-it.md)
(a track is inherited through a chosen element as well as a granted one)

## Context

ROADMAP Phase 2's exit criterion is a level 8 multiclassed Rogue/Wizard. Nothing in the
character model can express one.

`Character.progress` is a single number (ADR 0009), and a rule's level gate is compared against
it directly:

```ts
if (gated && rule.level !== undefined && character.progress < rule.level) return false;
```

For every character built or imported so far that has been right, because every one of them is
single-classed — all eight original sample saves have exactly one `type="Class" registered=`
node, and none passes level 12. The moment a character has two classes it is wrong in three ways
at once:

- **Level gates fire on the wrong number.** A Rogue 5 / Wizard 3 receives every rogue feature up
  to level 8, because `progress` is 8 and the rogue's rules are gated on 5, 6, 7 …
- **`level:<class>` is always zero.** Content reads it 150-odd times — `level:warlock` 44 times,
  `level:monk` 20, `level:wizard` 8 — and **nothing in the corpus sets it.** All 740 files were
  searched: there is not one `name="level:…"`. Aurora computes it in application code, so a
  reader of files alone sees a stat that is referenced and never written.
- **There is nowhere to put the answer.** `Choice` is `{ ruleKey, elementIds }`. Aurora's save
  records a `requiredLevel` on every decision and the importer reads it only to *sort*, then
  drops it.

### What the ninth save proved

The eight original samples could not show any of this. A ninth was built in Aurora specifically
to serve as the oracle: a **level 20 Paladin 2 / Warlock 18**. It settles the format question,
because Aurora records exactly what is needed and the importer walks past it:

```xml
<element type="Level" name="2" id="ID_LEVEL_2" />
<element type="Level" name="3" id="ID_LEVEL_3" multiclass="true" starting="true"
         class="ID_WOTC_PHB_MULTICLASS_WARLOCK">
<element type="Level" name="4" id="ID_LEVEL_4" multiclass="true"
         class="ID_WOTC_PHB_MULTICLASS_WARLOCK" />
```

A `<element type="Level">` node carries `class=` — **which class that level was taken in** —
plus `multiclass="true"` and `starting="true"`. A level with no `class=` belongs to the class
chosen at level 1. `parse-save.ts` reads `name` and `rndhp` from that node and ignores the rest,
which is a fourth silently-dropped Aurora construct alongside the three ADR 0008 found
(`<supports>`, element-level `<requirements>`, `<append>`).

This is a defect, not a missing feature, so fixing it stays inside `packages/aurora-import`'s
bugfix-only freeze: the importer currently reads a multiclass save and produces a *different
character*. Verifying that save against Aurora's own `<sum>` reports **9 `element-missing`** —
the first non-zero `element-missing` in the project — and every one of them is the warlock half
of the character: Pact Magic, Eldritch Invocations, Mystic Arcanum, Pact Boon, Otherworldly
Patron, the warlock ASI.

One more detail from that node: `class=` names the **multiclass** element
(`ID_WOTC_PHB_MULTICLASS_WARLOCK`), not the class (`ID_WOTC_PHB_CLASS_WARLOCK`). The two are
different elements and both matter — the multiclass element carries the reduced proficiencies a
second class grants; the class element is the one that owns the levels.

## Decision

### A fifth input on `Character`

```ts
/**
 * Which track each point of progression was spent on, in order.
 * `at` is a progression number; `elementId` is what was advanced at it.
 */
advancement?: Array<{ at: number; elementId: ElementId }>;
```

For the Hexadin: `{at:1, …PALADIN}`, `{at:2, …PALADIN}`, `{at:3, …WARLOCK}` … `{at:20, …WARLOCK}`.

It is an input in the same sense as `rolls` and `baseStats` (ADR 0014): nothing derives which
class you took at level 7. The field is optional, and a character without it behaves exactly as
today — which is what keeps every existing single-class save and fixture correct.

`Character` now has five inputs, and the one-line test still holds for each:

| field | what it holds | why it cannot be derived |
|---|---|---|
| `choices` | element ids the user picked | the user picked them |
| `rolls` | recorded random results | a die roll has no formula |
| `baseStats` | starting values the user set | point buy has no formula |
| `advancement` | what each point of progression bought | the user chose it, level by level |
| `freeform` | text the rules never read | it is prose |

### Tracks, and how a level gate finds its number

An element named in `advancement` **starts a track**. Everything that element grants,
transitively, **inherits** that track — the engine already passes the granting element to
`addElement`, so the parent link exists and only needs following.

A rule's `level` gate then compares against **the size of its element's track**, falling back to
`character.progress` when the element has no track. The Warlock class element's track has 18
entries, so its `level="11"` grants fire; the Paladin's has 2, so its `level="5"` grants do not.
A race's `level="5"` grant is in no track and still gates on total level, which is right.

Core learns no new noun. It says: *an element in `advancement` starts a track, grants inherit
their granter's track, and a level gate reads its own track's size.* Nothing there is a class.

### The track's level as a stat

The kind's progression gains one pattern, beside the `elementIdPattern` it already has:

```json
"progression": {
  "kind": "level", "min": 1, "max": 20, "stat": "level",
  "elementIdPattern": "ID_LEVEL_{n}",
  "trackStatPattern": "level:{name}"
}
```

`{name}` is the track element's name, lowercased. `level:warlock` and `level:paladin` then exist
and hold 18 and 2, and the 150 content references that read them start working. This is a
`schemas/system.schema.json` change and therefore a public API change (ADR 0011); it is additive
and optional, and a system that omits it publishes no track stats.

### The importer resolves the multiclass element to its class

`class="ID_WOTC_PHB_MULTICLASS_WARLOCK"` becomes an advancement entry naming
`ID_WOTC_PHB_CLASS_WARLOCK`. No new field is needed to do it: a Class element already carries
its `multiclass` block with that block's id, so the index answers "which class declares this
multiclass" directly. The multiclass element stays a separate choice, because it is one.

`formatVersion` stays at **1**. The field is additive and optional, and no `.incu` exists outside
this repository yet. That is the same argument ADR 0014 made, with the same caveat and more
force: a reader that ignored `advancement` would compute a *wrong* multiclass sheet rather than a
degraded one. This is the last comfortable moment for that argument to hold.

## Consequences

**Good**
- The Phase 2 exit criterion becomes expressible. It was not, before.
- Three Phase 2 numbers stop being blocked on a guess: hit points need the hit die of the class
  taken at each level, the multiclass spell slot table needs each class's level, and level
  gating needs both.
- A real oracle now covers multiclassing. The Hexadin's `<magic>` block records Paladin slots
  `2/0/0/…` and Warlock slots `0/0/0/0/4/0/…`, which between them pin down the two rules that are
  easiest to get wrong: a half-caster rounds its contribution down, and pact magic is not part of
  the multiclass table at all.
- `advancement` also answers "what did I get at level 7?", which a level-up UI needs anyway.

**Bad / accepted**
- A fifth input field. Accepted for the reason ADR 0014 gave: every alternative encodes the same
  fact somewhere it does not belong, and produces numbers that are quietly wrong rather than
  obviously missing.
- Tracks are inherited through the grant graph, so an element granted by *two* tracks is
  ambiguous. The engine takes the first track that reaches it and records a problem; content that
  does this is rare and worth reporting rather than silently resolving.
- `trackStatPattern` derives a stat key from an element's *name*, so renaming a class upstream
  renames its stat. To be clear about where that lives: the *mechanism* is Incudo's and the
  engine is not bound to any naming — what matches Aurora is the configured value, one line in
  `systems/dnd5e/system.json`, chosen because this project's 5e content *is* Aurora content and
  150 references in it read `level:warlock`. A system that names tracks differently sets a
  different pattern and the engine neither knows nor cares.
- Nothing validates that `advancement` covers every point from 1 to `progress`, or that its
  entries are elements a character could legally take. A gap is reported, not corrected — the
  same stance ADR 0011 takes on system definitions.

## Alternatives considered

**Put the level on `Choice`.** `Choice` gains `level?: number` and class levels are counted from
the choices that name a class. It reuses a field rather than adding one, and it breaks two
things: choice identity is currently the `ruleKey` alone (`setChoice` replaces by it), so
repeated keys across levels would need that reworked; and it conflates "the level this select was
offered at" with "the level this bought", which are the same only for classes.

**A per-level ruleKey convention** — `build/level:3` in `choices`, no schema change at all. It
keeps `character.json` untouched, and it puts a load-bearing convention into a string, where
nothing can validate it and the meaning is invisible. The system definition would have to declare
the key pattern anyway, so the public-API change happens either way; this version just hides it.

**Let content declare `<stat name="level:rogue" value="1"/>` on each class.** The corpus does
not, cannot be edited (ADR 0005), and this would need the engine to count a class element once
per level — which is the very thing being modelled. It also mistakes where the fact lives: the
class does not know how many levels you gave it.

**Derive tracks from element type instead of from `advancement`.** "Elements of type Class start a
track" is simpler and puts a game noun in the system definition rather than in core, which is
allowed. It still cannot say *how many* levels went to each class, which is the actual missing
information. It solves the naming and not the counting.
