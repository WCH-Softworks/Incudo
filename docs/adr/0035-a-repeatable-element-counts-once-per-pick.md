# 0035 — A repeatable element counts once per pick, and the improvement Aurora's app generates is derived from content

**Status:** Accepted · 2026-09-18 · builds on [0030](./0030-a-declared-block-answers-a-filter.md),
[0022](./0022-kinds-contribute-systems-do-not-ship-content.md) · a fix under
[0008](./0008-aurora-compatibility-frozen.md)'s freeze · touches the **system definition format**
(additive; `formatVersion` stays 1)

## Context

A level 4 Fighter, built in the running app against the full AuroraLegacy corpus, opens with a
blocking decision it cannot close:

```
Improvement Option (Fighter 4)   opened at 4   remaining 1   blocking
candidates: []    unresolved: []
```

Every class's `Ability Score Improvement` feature declares one `<select>` per level that grants
one — `supports="Improvement Option,Fighter,4" level="4"`, repeated for 6/8/12/14/16/19 — and
nothing offers itself to it. `unresolved` is empty too, so the UI could not even say why: the
filter is well-formed, it simply matches nothing. `CLAUDE.md` had this filed under "three
`supports` operands are still unread", and named the `Class` operand as the culprit.

### What the measurement found, and it was not the operand

**The candidates are not in the corpus.** A grep for `<supports>` naming `Improvement Option`
finds only the Artificers: `Improvement Option, Eberron Artificer, 4` and its siblings, twenty
elements across two files, and ten more for the UA Artificer. Thirteen other classes write the
select and no file declares an option for it. Counted across the corpus, **88 of the 123 select filters that match nothing at all
are this one protocol**: 73 `Improvement Option,<class>,<level>` and 15
`Ability Score Improvement,Class`. The other 35 are `!` negation (16), `Ritual` (17) and two
proficiency lists — the three unread operands `CLAUDE.md` names, minus `Class`, which was never an
operand problem.

**Aurora's app generates them.** A set of real saves record, per level, a registered element
whose id no file declares, together with the names and types of the selects under it:

```
Improvement Option (Fighter 4)        ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER
  Feat (FIGHTER 4)                    ID_PHB_FEAT_TOUGH
Improvement Option (Fighter 12)       ID_INTERNAL_CLASS_FEATURE_ASI_12_FIGHTER
  Ability Score Increase (FIGHTER 12) ×2   ID_INTERNAL_ASI_CONSTITUTION
```

That fixes the id (`ID_INTERNAL_CLASS_FEATURE_{ASI|FEAT}_{level}_{CLASS}`), both select names and
what each offers. It held on every save that has one — seven classes across nine characters. The
importer already rebuilt these as rule-less stand-ins so a save keeps its shape; nothing had ever
generated them for a character that did not exist yet. The two Artificers' hand-written copies
(under a comment reading "v1.19.3XX workaround") are the one place the *shape* is written down:
an `Ability Score Improvement` element with a `number="2"` select on `Ability Score
Improvement,Class`, and a `Feat` element gated on `ID_INTERNAL_OPTION_ALLOW_FEATS`.

**`Class` is a tag, and six elements carry it.** All 15 uses of the operand sit inside an
improvement option's select, on the filter `Ability Score Improvement,Class`, and no element in the
14,316 carries either tag. The six `ID_INTERNAL_ASI_*` elements — the overlay's own, whose ids the
saves record being chosen for exactly this select — are what it selects. This is inferred, not
read: it has two witnesses (the saves, and the corpus's own convention that a repeatable element
carries a tag naming its select, as `ID_PHB_FEAT_ASI_*` carries `Feat, Athlete`), and no third.

### A second finding, and it was data loss

Offering the six abilities is not enough, because **the most common improvement is +2 to one
score, and that is the same element chosen twice.** A real level 12 Fighter save records
`ID_INTERNAL_ASI_CONSTITUTION` under both `number="1"` and `number="2"` of one select, and Aurora's
own `<sum>` lists it twice. Incudo could express neither half:

- a select excluded everything it already held, so the second slot could never offer Constitution;
- the derivation seeds from a `Set` and an element is applied once, so two picks were one +1;
- and the importer **deliberately dropped the second pick** ("recorded twice; keeping one"), so
  that Fighter imported with a Constitution of 19 where Aurora computes 20. `aurora verify` cannot see it
  — it compares chosen elements, and never an ability score.

Content already says which elements may be picked again. 48 `<set name="allow duplicate">true</set>`
setters exist in the corpus, among them the six `Ability Score Increase` elements the Player's
Handbook feats grant and the internal ability score decreases.

## Decision

### 1. The improvement options are derived from what is loaded

`improvementOptionElements` (`packages/aurora-import`) reads every `Improvement Option,<class>,<level>`
select in the loaded content and generates two elements for each (class, level) that no element
already declares: an `Ability Score Improvement` option carrying a `number="2"` select on
`Ability Score Improvement,Class`, named `Ability Score Increase (FIGHTER 4)`; and a `Feat` option
carrying a `Feat (FIGHTER 4)` select, gated on `ID_INTERNAL_OPTION_ALLOW_FEATS`. `ContentLibrary`
runs it after every file and append of an Aurora source, so it is derived from content and not from
a list: a third-party class writes the same select and gets the same treatment, and a source that
ever declares one of the ids wins the way it wins against `auroraGeneratedElements`.

Against AuroraLegacy that is **73 pairs and 146 elements**; the Artificers are skipped because their
own file declares them. The generated count goes from **83 to 229**. Nothing else in the baselines
moves: `--expect-elements` counts elements that come from files.

### 2. The six ability elements carry the tags and the setter the filter names

`Ability Score Improvement` and `Class`, plus `allow duplicate`. This is the one piece of
mechanic-shaped inference in the change, and it is recorded where it lives (the header of
`improvement-options.ts`) with what it rests on.

### 3. A character kind declares `repeatableSetter`, and an element carrying it counts once per pick

`characterKinds[].repeatableSetter` names a setter (5e: `"allow duplicate"`). The name is the
system's, never core's — Aurora spells it that way and another format would not — so ADR 0003 holds.
For an element carrying it (any value but `false`):

- a select that already holds it **offers it again**, and `answeredChoices` still reports what a
  slot could hold instead;
- its stat rules apply **once for every time the character chose it**, counted across every recorded
  choice — Constitution at level 4 and again at level 8 is two picks in two pools and is +2.

Every other element behaves exactly as before: a second Athletics is no more Athletics. A kind that
names no setter changes nothing at all, which the tests prove by removing it. The multiplicity is
applied to *stat* rules only; a grant from a repeatable element still fires once, because
"granted twice" has no meaning that a `Set` does not already capture.

### 4. The importer keeps the second pick when the element allows it

`import-character.ts` keeps a repeated id if the loaded element carries the same setter. With no
content loaded it cannot know, and keeps dropping-with-a-warning as before.

### 5. The view-model says which answers may repeat

`PendingChoice`, `AnsweredChoice` and `SettledPick` publish `repeatable`, the subset a slot's own
option list must keep offering even while another slot holds it. The pane dropped every other slot's
answer so two slots could never agree — right for a language, wrong for the thing this exists for —
and it reads the list rather than guessing.

## What this proves, and what it cannot

- **Filters matching nothing: 123 → 35** of 2,479 interpolation-free select rules with a filter in
  the corpus; distinct (type, filter) pairs 90 → 16 of 1,158. All 88 protocol filters now match and
  none remain empty. The 35 left are exactly `!` negation, `Ritual` and two proficiency lists — the
  improvement filters needed neither of the first two, which is why neither was done here.
  (ADR 0030's 343 → 124 counted on a different basis and the numbers do not chain.)
- **In the running app**, a level 4 Fighter is offered `Ability Score Improvement — Internal`;
  taking it opens `Ability Score Increase (FIGHTER 4)`, *2 left*, with all six abilities;
  choosing Strength twice reads Strength +2, total 12, and both picks settle into "Choices already
  made" as two independently changeable slots that each still offer Strength. Raising the level to 8
  opens the level 6 and level 8 improvements beside it.
- **`node --test`**, each written to fail if its half is removed: the engine's multiplicity, its
  candidate rule, the kind's setter, the generator, the tags and setter on the six elements, the
  importer's duplicate rule and the view-model's `repeatable` were each perturbed and each failed a
  named test.
- **`aurora verify` is byte-identical on all nine saves**, diffed as text — which proves nothing
  broke and nothing else. It compares chosen elements, and a filter that offered everything would
  move no count anywhere (ADR 0030 says the same). That Fighter's Constitution moving 19 → 20 is the
  importer fix, and the only oracle for it is that Aurora's `<sum>` lists the id twice.
- Corpus baselines unchanged: **740 files, 14,316 elements, 0 errors, 1 unresolved, 23 unmeetable
  requirements, 57 warnings.**

## Consequences

**Good**
- A character can be levelled past 3. The blocking decision has candidates, a +2 lands as +2, and
  an imported character's Constitution is what Aurora computed.
- The two Artificers and 73 generated pairs now share one shape, so a fix to it is one fix.
- Nothing in `core` learned a game noun: it learned that a system can name a setter.

**Bad / accepted**
- The `Class` tag on the six elements is inferred from two witnesses. If a third-party class writes
  an improvement select with a different filter, it gets an empty list, exactly as before.
- The **feat option is generated but unreachable** in a character built in Incudo: switching
  `ID_INTERNAL_OPTION_ALLOW_FEATS` on is ADR 0032's unbuilt `multiple: true`. It is generated
  anyway because **eight of the nine samples took a feat at level 4** — a real player's first
  improvement is usually a feat, so ADR 0032 is what they will meet next — and their imports are
  more faithful with it, and because it changes nothing until that option is held.

> **Note, 2026-09-23 — re-derived from the thirty sample saves; two figures differ and the reasoning built on
> one of them is weakened.** *The id family:* **12** samples record generated `ID_INTERNAL_CLASS_FEATURE_{ASI|FEAT}_{level}_{CLASS}`
> options (24 `Improvement Option (Class N)` elements, every one matching the pattern), across the **same seven classes** the ADR
> names (Barbarian, Cleric, Druid, Fighter, Ranger, Rogue, Wizard) — the claim "seven classes" reproduces. No
> class name contains a space, so that gap is still open. *The +2 shape:* in **9 samples** an option lists
> the same `ID_INTERNAL_ASI_*` id twice (18 such options), so a +2 as the same +1 picked twice is
> everywhere the samples have an ASI. *The feat figure:* of the 12 samples with a level-4 improvement, **3**
> took the feat (the interleaved Rogue / Wizard, a Fighter, a Ranger) and 10 of the 13 level-4 options were ability
> score increases, so the samples do **not** say "eight of the nine took a feat at level 4". The choice to generate the
> feat half anyway still stands on its other reasons (fidelity, and it changes nothing until options are on),
> but not on "a real player's first improvement is usually a feat". *Not re-derivable:* the level-12 Fighter
> whose Constitution moved 19 to 20 (no sample is a level-12 Fighter; the Fighter 20's derived scores have no
> referee, since the oracle compares chosen elements and not scores). *New:* the 2024 samples record a
> different family for their background improvement,
> `ID_INTERNAL_ABILITY_SCORE_IMPROVEMENT_COMBINATION_*`, which this ADR does not describe.
>
> **Addendum, same day: "byte-identical on all nine saves" was re-run as a before/after and does not
> reproduce on the samples.** Over the ADR's commits (`56bdba2^` against `3e667f4`, one script at both, corpus
> at `c28ce6c`), **12 of 30 samples change** and 18 are identical. What changes is ability scores, where the
> second pick of a repeated ASI now counts: a Fighter's Strength 17 becomes 20, a level 20 Fighter's
> Strength 17 to 20 and Constitution 16 to 19, a level 20 Cleric's Wisdom 17 to 20, and the derived numbers
> that follow (modifiers, hit points 203 to 223 and 163 to 183, spell save DCs and attack bonuses, initiative
> and armour class). Against Aurora, `stat-mismatch` falls from **25 to 11** over the 30: **14** save DC and
> attack bonus mismatches, on five samples, were the dropped second pick, and Aurora's own numbers had been
> saying so. So the ADR's "`aurora verify` cannot see it" is true of the original nine and false of the
> samples, where the spellcasting rows were the referee; the 11 that remain are the per-block table
> mismatches ADR 0041 later removed. The ADR's own words, that the byte-identical run "proves nothing broke and
> nothing else", still stand for what it says about that run. Elements, their order and the problems do not
> move on any sample; two 2024 samples lose a pending "Ability Score Improvement Feat" choice.
- Class names with a space have never been exercised: no class in AuroraLegacy has one, so the
  id substitution (non-alphanumerics become `_`) is untested against a save.
- ADR 0022 says a rule on a generated element is frozen into every save that embeds it. The 146
  options carry a `select` each, on the same ground as the six `+1` elements: the select is what a
  save records them as, and no number lives on them. The six also gain two tags and a setter, and a
  save written before this embeds them without the setter. None can hold a repeated pick — the
  importer dropped the second and the app could not offer it — so nothing in an existing save
  changes; importing it again picks the fix up.
- No ability score is checked by anything. `aurora verify` compares elements, and no `<sum>` records
  a total, so "+2 lands as +2" rests on the engine tests and on Aurora listing the id twice.
- The 83-element overlay is now 229, and three documents quoted 83.

## Alternatives considered

**Ship only the ASI half and leave feats to ADR 0032.** Smaller, and it is what the request asked
for. But the generator is one mechanism, the feat element is what half the sample characters took,
and leaving it out makes the import less faithful for no saving; its gate means it is invisible
until the option can be held.

**A fixed list of the 14 classes.** The set of classes is content: a list is wrong for the first
homebrew class, and it would say `Fighter` in code that has no business knowing one.

**Count multiplicity for every element.** Simpler, and wrong: a proficiency granted through a race
and a class would double, and the Paladin 2 / Warlock 18 save's `<sum>` alone lists some sixty of them twice. The setter is
content's own statement of which elements repeat.

**Hard-code `allow duplicate` in core.** Ten lines, and the end of ADR 0003 for a string one format
happens to use.
