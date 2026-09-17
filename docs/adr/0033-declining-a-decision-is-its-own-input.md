# 0033 — Declining a decision is its own input, not an empty answer

**Status:** Accepted · 2026-09-17 · amends [0017](./0017-open-decisions-not-steps.md) ·
touches the **`.incu` save format**

## Context

`OpenDecision.blocking === false` exists for exactly the case that needs it: a decision the
character may leave unanswered, same as the `optional` flag on a content `<select>` has always
meant. `BuilderPane.tsx` renders the tag — but nothing lets the user act on it. An optional
decision with no answer sits in "Open decisions" for as long as the character exists, next to
the ones that actually need attention.

The obvious fix does not work, and it is worth saying why rather than only that it doesn't.
`setChoice(character, ruleKey, [])` is how an answer is normally cleared:

```ts
export function setChoice(character, ruleKey, elementIds) {
  const rest = character.choices.filter((c) => c.ruleKey !== ruleKey);
  const choices = elementIds.length ? [...rest, { ruleKey, elementIds }] : rest;
  return { ...character, choices, updatedAt: new Date().toISOString() };
}
```

An empty array *removes the record*. That is indistinguishable from "never answered", so
`deriveCharacter`'s `pendingChoices` computation (`packages/core/src/engine.ts`) recomputes the
same pool as open on the very next read — the decision would reappear the moment anything else
changed. Recording `{ ruleKey, elementIds: [] }` instead does not help either: it is the same
shape a fresh choice starts in, so a reader cannot tell "the user looked at this and said no"
from "the user has not looked at this yet".

## Decision

**Declining is a fact the user asserted, in its own field, and it never touches `choices`.**

```ts
declinedDecisions?: string[];  // Character, packages/core/src/character.ts
```

Each entry is an `OpenDecision.id` — the same stable string `choose` already takes for that
decision (a select's `ruleKey`, a budget's stat name, `hitpoints:<stepId>`). Two functions:

```ts
export function isDeclined(character: Character, decisionId: string): boolean;
export function setDeclined(character: Character, decisionId: string, declined: boolean): Character;
```

`packages/ui/src/use-character-builder.ts` reads it in `compute()`: a decision that is both
`!blocking` and declined moves from `decisions` into a new `BuilderState.declined` list, the
same way a fully-answered one moves into `picks` — off the outstanding list, but not gone, and
a step whose only open items are declined ones now reads `complete`. `CharacterBuilder` gains
`decline(id)` and `reconsider(id)`; `decline` refuses a decision that is currently `blocking`,
matching the reading [ADR 0032](./0032-a-build-step-may-offer-a-set.md) already gave "you must
answer this optional thing" — not a sentence, so not a state the model will produce.

This is the same category ADR 0006 already carved out for `rolls`, `baseStats`, `advancement`
and `generation`: an input with no formula, stored because nothing derives it. "The user
declined this" is exactly that — no derivation could ever produce it, and forgetting it on
every re-derive is the bug this ADR exists to close.

### Why a separate list and not a sentinel inside `choices`

A `Choice` already means "this rule's answer is these elements". Extending it with a `declined:
true` flag would make `choices` carry two different kinds of fact behind one shape, and every
reader of `character.choices` — the importer, the engine, `chosenElementIds` — would need to
learn to skip declined entries or double-count nothing. A parallel list keyed by the same id
`choose` uses needs no reader to change: `collectPendingChoices` and everything in
`packages/core/src/engine.ts` is untouched, because declining is not something the engine has
an opinion about — it is presentation state the view-model filters on, same as `focusedId`
already is, except this one needs to survive a save.

### Why this is a format change and not only a `packages/ui` concern

`declinedDecisions` is written into `character.json` — a character that declined something and
is saved, closed and reopened must not have it silently reappear as open. That makes it a
question for `schemas/character.schema.json`, which is `additionalProperties: false`.

## Consequences

**Good**
- An optional decision stops being permanent clutter without inventing a fake answer.
- No engine change. `pendingChoices` and `answeredChoices` keep meaning exactly what they meant
  before; `declinedDecisions` is filtered entirely in the view-model, and the CLI — which has no
  "Skip" gesture and reads `pendingChoices` directly — is unaffected either way.
- `formatVersion` does not move. The field is optional and additive, in the company of
  `baseStats`, `advancement` and `generation`, none of which moved it either — only `inventory`
  did, and for the reason its own ADR gives: a reader blind to it doesn't just miss a field, it
  re-collects `content.json` short. A reader blind to `declinedDecisions` just shows the decision
  again, which is the pre-existing behaviour this ADR improves on, not a broken save.

**Bad / accepted**
- A declined id that content later makes irrelevant (the whole pool disappears — a level down,
  a source removed) is never pruned. It sits in `declinedDecisions` doing nothing, forever,
  which is a wart and not a correctness problem: `isDeclined` is only ever consulted against a
  decision that currently exists, so a stale id is simply never read. Cleaning it up would need
  the engine to tell the view-model which ids are still meaningful, which is more machinery than
  a few harmless bytes in a save justify.
- Only non-blocking decisions can be declined, by construction (`decline` refuses a blocking
  one). A step author cannot express "usually required, but this particular character may skip
  it" through this mechanism — that is a different feature, unrequested and not built here.

## Alternatives considered

**A sentinel inside `Choice`** (`{ ruleKey, elementIds: [], declined: true }`). Rejected above:
it teaches every reader of `choices` a second vocabulary for what an entry means, for no benefit
over a separate list keyed the same way.

**Clear the answer and rely on the UI to remember what was dismissed, per session.** This is
the bug report's own starting point and it is not a fix — it does not survive closing the save,
which is the entire complaint: the same content is offered again next time, silently.

**Put it in `overrides`.** `overrides` is documented as a repair tool for wrong or missing
content (ADR 0006's escape hatch), and reads as such everywhere it appears. Declining a normal,
correctly-modelled optional choice is not a repair, and stacking an unrelated meaning onto a
field the UI already presents as "something is wrong here" would be confusing for no reason.
