# 0017 — Building a character is a set of open decisions, not a sequence of steps

**Status:** Accepted · 2026-09-10 · amends [0009](./0009-character-kinds.md)

## Context

Every character builder the owner has used, Aurora included, presents building as a wizard: a
fixed list of screens, visited in order, with a Back button. The complaint against it is
specific and it is a product requirement, not a preference:

> The order of the steps. Rolling (or picking) the attributes should be the first thing you do
> — even the class chosen might be influenced by the available points. And when one of the
> steps makes it so that a previous step now has different options, like when a class gives you
> one more attribute point to distribute, the user shouldn't have to go back to the attribute
> distribution step to do it.

Two failures, and the second is the deeper one.

**The order is wrong.** `systems/dnd5e/system.json` declares
`race → class → background → abilities → levels → equipment → spells → details`. Abilities are
fourth. In 5e you might roll 4d6-drop-lowest before anything else, and what you rolled is a
real input into which class is worth playing. A builder that asks for a class first has quietly
decided that your scores do not affect that choice.

**Worse, it is an order at all.** A wizard has a Back button because a wizard needs one, and
needing one is the bug. Character creation is full of later choices that reopen earlier ones:

- a class or a feat that grants ability points to distribute;
- a subclass that adds a skill proficiency to pick;
- a level 4 Ability Score Improvement, which is the same decision as step one, arriving twenty
  minutes later;
- a race variant that swaps a fixed bonus for a choice.

In every case the user is told to navigate back to a screen they thought they had finished. The
screen is the wrong unit.

### What the code already has, and what it does not

The engine is already right and the layer above it is not.

`deriveCharacter` returns **`pendingChoices`**, recomputed from scratch on every derivation,
carrying every unanswered `select` with no notion of order or of which screen it belongs to. It
is already the complete, always-current answer to "what is still open". Nothing about it needs a
sequence.

`packages/ui/src/use-character-builder.ts` then throws that away. It holds a `currentStepId`
cursor, exposes `goToStep`, and computes each step's outstanding work as:

```ts
const pending = derived.pendingChoices.filter((choice) => step.types.includes(choice.type));
```

Two consequences fall straight out of that line. A decision is attributed to a step purely by
its *element type*, so a level 4 ASI belongs to whichever step lists that type rather than to
the moment it became available. And the 5e abilities step declares `"types": []` — so it can
never match a pending choice, is reported `complete: true` from the first render, and is
**inert**. The view-model has `choose`, `setProgress` and `recordRoll`, and no way to set an
ability score at all.

So the wizard is not merely the wrong shape; the one step this ADR is most about does not
currently work.

## Decision

### 1. The builder exposes open decisions, and there is no current step

`CharacterBuilder` publishes one flat, always-current list:

```ts
interface OpenDecision {
  id: string;                 // stable: the rule key, or the budget's stat
  kind: 'select' | 'budget';
  label: string;
  stepId: string;             // which grouping it belongs to, for presentation
  blocking: boolean;          // required, versus a choice the character may decline
  from?: ElementId;           // what opened it — "Rogue 4: Ability Score Improvement"
  openedAt?: number;          // the progression point it became available
}
```

Answering one re-derives and the list changes. There is no cursor in the model, so there is
nothing to navigate back *from*. A level 4 ASI appears in the list the moment the character
reaches level 4, wherever the user happens to be looking, and is answerable in place.

A shell may still *focus* one decision — that is presentation, and the two shells will differ
(a dense desktop pane, a mobile card stack). What neither shell may do is own the question of
what is outstanding.

### 2. Steps are groupings with dependencies; the order is derived

`buildStep` keeps `id`, `label` and `types` and gains:

```jsonc
{ "id": "spells", "label": "Spells", "types": ["Spell"], "requires": ["class"] }
```

`requires` states a genuine dependency — you cannot pick spells before something makes you a
spellcaster — and nothing else. The suggested order is a topological sort of those
dependencies, with the declared array order breaking ties among steps that are equally
available. A step whose dependencies are unmet is *not yet available* rather than skippable,
and the user is told which decision would open it.

Abilities-first then follows from the data rather than from a rule in the app: the abilities
step requires nothing, so it sorts first. That reordering is a one-line change to
`systems/dnd5e/system.json`. The machinery that matters is the part that lets a step become
available later.

### 3. Ability scores become a declared decision with a budget content can add to

This is what makes the class-grants-a-point case work, and it needs `baseStats` (ADR 0014) to
acquire something it has never had: a notion of whether it is *finished*.

A build step may declare a **budget**:

```jsonc
{ "id": "abilities", "label": "Ability Scores", "types": [],
  "budget": { "stat": "ability points", "targets": ["strength", "dexterity", "constitution",
                                                    "intelligence", "wisdom", "charisma"],
              "methods": ["point-buy", "standard-array", "roll", "manual"] } }
```

The engine already sums `ability points` like any other stat, so **content contributes to it
with the `stat` rule that already exists** — a level 4 ASI, a feat, a race variant. No new rule
kind. The step is open while what has been spent is less than what has been granted, and the
open decision reads "2 points to spend", raised by whatever granted them.

Generation methods are **declared data, not code**:

```jsonc
{ "id": "point-buy", "label": "Point buy", "budget": 27, "min": 8, "max": 15,
  "costs": { "8": 0, "9": 1, "10": 2, "11": 3, "12": 4, "13": 5, "14": 7, "15": 9 } }
{ "id": "standard-array", "label": "Standard array", "values": [15, 14, 13, 12, 10, 8] }
{ "id": "roll", "label": "Roll", "dice": "4d6dl1", "count": 6 }
```

They have to be data. `docs/CODE-REUSE-POLICY.md` rule 1 says a rule about the game may not
live in a component, and a point-buy cost table is exactly that. A shell that hardcoded 27
points would be a bug in the same category as a shell that computed AC.

Which method a character used is an input like any other and is recorded, so reopening the
abilities decision at level 4 knows whether it is adding to a point-buy spend or to a rolled
set.

### What this deliberately does not copy

Aurora models a build as a tree of levels with selects hanging off them, and its UI walks that
tree. That is a faithful rendering of its storage and it is the source of the complaint. Incudo
reads Aurora's files and keeps none of its shape: `advancement` records what each level bought
(ADR 0015), `pendingChoices` says what is open, and neither is a screen. The importer converts
into this model; Aurora's ordering is not an input to it.

## Consequences

**Good**
- The complaint is answered structurally rather than by adding a "you have unspent points"
  nag to a wizard, which is what every builder that has this problem already does.
- Ability scores stop being a placeholder that reports itself finished.
- The two shells can differ as much as they like — dense panes on desktop, a card stack on
  mobile — without either owning what is outstanding.
- Level-up stops being a special screen. A level is a change to `progress`; the decisions it
  opens arrive in the same list as every other, tagged with the level that raised them.
- A system author gets the same expressiveness: `requires` and `budget` are data, so a system
  with a wholly different flow needs no engine change (ADR 0011).

**Bad / accepted**
- `buildStep` gains two optional fields and `system.schema.json` is a public API (ADR 0011).
  Both are additive; every existing definition stays valid, and a step with neither behaves
  exactly as it does now.
- A flat list of open decisions can be long on a fresh level 1 character. That is a
  presentation problem and it is the shells' to solve — grouping by step is why `stepId` is on
  the decision.
- Dependency cycles in `requires` are possible and are the author's mistake. Validation
  reports them; it does not repair them, in line with ADR 0011's stance.
- Recording the generation method adds a field whose only purpose is to make a *later* edit
  behave sensibly. Worth it: without it, reopening abilities at level 4 cannot tell a rolled
  15 from a bought one, and would have to offer both readings.

## Alternatives considered

**Keep the wizard, reorder the steps, add nags.** Abilities move to first and an unspent-points
badge appears on the abilities step. It is a morning's work and it leaves the Back button doing
the same job, which is the actual complaint. It also cannot express "this decision opened
because of that one".

**Make ability scores a `select` over synthetic elements**, so they flow through
`pendingChoices` with no new concept. ADR 0014 already rejected this shape for storage — 126
synthetic elements per system to carry a number — and it is no better as a decision: point-buy
costs are not expressible as a filter over elements.

**Let the shell own the order and give it the whole model.** Simplest possible engine, and it
puts the flow in two places that will drift, guarantees the desktop and mobile builds disagree
about what is outstanding, and violates the reuse policy's test — "the app offered the wrong
choice" must be fixable in a package.

**Order steps by a declared `order` number instead of dependencies.** Easier to implement and
it cannot express availability, which is the whole point: a number says where a step goes, not
whether it can be attempted yet.
