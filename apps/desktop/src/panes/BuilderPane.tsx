/**
 * Every outstanding decision, in one list.
 *
 * ADR 0017 is the whole shape of this pane: there is no current step, so there is nothing to
 * navigate back from. Steps are a *grouping* with `available` / `blockedBy`, not a sequence —
 * and a decision that opens at level 4 arrives in the same list as the one that opened at level
 * 1, tagged with where it came from. The shell may focus a decision; it may not decide what is
 * outstanding.
 *
 * Which is right, and for a while it was also being used to excuse a real hole. "No Back button"
 * is a statement about *navigation*; it was letting an answered pick take its own control off
 * the screen, so the race was a one-way door and the Steps list said "complete" without ever
 * saying complete what. `BuilderState.picks` is the fix, and it is not a Back button: a settled
 * pick is not somewhere you go, it is something on screen that still has a control.
 */

import type { CharacterBuilder, BuilderState, OpenDecision } from '@incudo/ui';
import type { ElementId, ElementIndex, ResolvedCharacterKind } from '@incudo/core';

import { BudgetEditor } from './BudgetEditor.tsx';
import { HitPointEditor } from './HitPointEditor.tsx';

export function BuilderPane({
  builder,
  state,
  elements,
  hasContent,
}: {
  builder: CharacterBuilder;
  state: BuilderState;
  elements: ElementIndex;
  hasContent: boolean;
}): React.JSX.Element {
  const { kind, derived, decisions, steps, picks } = state;
  const progression = kind.progression;
  const nameOf = (id: ElementId): string => elements.get(id)?.name ?? id;

  /**
   * A candidate's name plus the book it came from, where a book is recorded.
   *
   * Names alone are not distinguishing, and the corpus is where you find that out rather than
   * where you would guess it: the Class list offers *every* class twice, once from the
   * Player's Handbook and once from its 2024 revision, and Aasimar four times — DMG, VGtM,
   * MotM and PHB 2024, which are four different sets of rules. `nameOf` stays as it is for
   * `decision.from` ("from Aasimar"), where the source would be noise.
   */
  const candidateLabel = (id: ElementId): string => {
    const element = elements.get(id);
    if (!element) return id;
    return element.source ? `${element.name} — ${element.source}` : element.name;
  };

  /** Budgeted or per-level-roll steps with nothing outstanding — still editable, see below. */
  const settled = steps.filter(
    (step) =>
      (step.budget &&
        !decisions.some((decision) => decision.kind === 'budget' && decision.stepId === step.id)) ||
      (step.hitPoints &&
        step.hitPoints.levels.length > 0 &&
        !decisions.some((decision) => decision.kind === 'hitpoints' && decision.stepId === step.id)),
  );

  return (
    <main className="pane builder">
      <section className="progress-bar">
        <label>
          {progression.kind === 'none' ? 'Progress' : progression.stat ?? progression.kind}
          <input
            type="number"
            value={state.character.progress}
            min={progression.kind === 'none' ? 0 : (progression.min ?? 0)}
            max={progression.kind === 'none' ? 0 : (progression.max ?? 20)}
            disabled={progression.kind === 'none'}
            onChange={(event) => builder.setProgress(Number(event.target.value))}
          />
        </label>
        <span className="hint">
          Levelling is not a separate screen — whatever this opens arrives in the list below,
          tagged with the level that raised it.
        </span>
      </section>

      {!hasContent && (
        <div className="problem warning">
          <strong>No content loaded.</strong>
          <p>
            The system definition is loaded, so the kind's own baseline applies, but nothing can be
            chosen until a source is added. Load one on the Sources pane.
          </p>
        </div>
      )}

      {/*
        Three columns, not two. Outstanding work (what to decide) and settled work (what you
        already decided) used to be the same vertical stack — "Open decisions" first, however
        long, then "Choices already made" and "Values already set" beneath it — so answering an
        early decision meant scrolling past everything else to see what you had already settled.
        They are different questions and now sit side by side: the middle column changes as you
        answer, the right column only grows. On a narrow viewport (a phone, or this window
        resized) `columns` collapses to one, in the same top-to-bottom order a mobile shell would
        want for tabs — outstanding, then settled.
      */}
      <div className="columns">
        <section>
          {/*
            Not "Steps". ADR 0017 is explicit that this is a grouping and not a sequence —
            there is no cursor, no order to walk and nothing to go back to — and calling it
            Steps told the user the opposite, which is why "I chose a race and was moved to
            the next step" was a reasonable thing to believe. It is a list of the parts of a
            character and what each still needs.

            `buildSteps` keeps its name in the system format: that is a public API with a
            `formatVersion` (ADR 0011), and a rename there costs every author a migration to
            fix a word only this heading ever showed.
          */}
          <h2>Your character</h2>
          <ul className="steps">
            {steps.map((step) => (
              <li key={step.id} className={step.available ? '' : 'blocked'}>
                <span className="label">{step.label}</span>
                {/*
                  What a completed step actually settled on. "Race — complete" never said
                  complete *what*, which mattered most where it was least visible: before
                  candidates carried their book, the Race list offered four identical Aasimars
                  and nothing afterwards told you which one you had.
                */}
                {picks
                  .filter((pick) => pick.stepId === step.id)
                  .map((pick) => (
                    <span key={pick.ruleKey} className="chosen">
                      {/*
                        The book, not just the name. "Race — Aasimar" is no answer at all when
                        four of them are on offer, which is the case this line exists for.
                      */}
                      {pick.chosen.map(candidateLabel).join(', ')}
                    </span>
                  ))}
                {step.available ? (
                  <span className={step.complete ? 'tag done' : 'tag open'}>
                    {step.complete ? 'complete' : `${step.openCount} open`}
                  </span>
                ) : (
                  <span className="tag blocked">needs {step.blockedBy.join(', ')}</span>
                )}
                {step.budget && (
                  <span className="tag">
                    {step.budget.pooled
                      ? `${step.budget.remaining} / ${step.budget.available} points`
                      : `${step.budget.unassigned.length} unassigned`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>
            Open decisions <span className="count">{decisions.length}</span>
          </h2>
          {decisions.length === 0 && (
            <p className="lede">Nothing outstanding. Every blocking decision has an answer.</p>
          )}
          <ul className="decisions">
            {decisions.map((decision) => (
              <li key={`${decision.kind}:${decision.id}`}>
                <Decision
                  decision={decision}
                  builder={builder}
                  nameOf={nameOf}
                  candidateLabel={candidateLabel}
                  kind={kind}
                  budget={steps.find((step) => step.id === decision.stepId)?.budget}
                  hitPoints={steps.find((step) => step.id === decision.stepId)?.hitPoints}
                />
              </li>
            ))}
          </ul>
        </section>

        <aside className="settled-column">
          {/*
            A budget that is finished leaves `decisions`, which is correct — it is not
            outstanding — and would take the editor off the screen with it, leaving no way to
            change a score you had already set. So a settled budget renders here instead. The two
            conditions are mutually exclusive, so the editor appears exactly once either way.

            An answered `pick` had the same hole, and now has the same answer beside it.
          */}
          {picks.length > 0 && (
            <section>
              <h2>Choices already made</h2>
              <p className="hint">
                Changing one of these rebuilds everything that followed from it. Anything it
                opened that you had answered is kept only where the new choice offers it too.
              </p>
              {picks.map((pick) => (
                <div key={pick.ruleKey} className="settled">
                  <div className="decision-head">
                    <span className="label">{pick.label}</span>
                  </div>
                  <select
                    value={pick.chosen[0] ?? ''}
                    onChange={(event) => {
                      if (event.target.value) builder.choose(pick.ruleKey, [event.target.value]);
                    }}
                  >
                    {pick.candidates
                      .map((id) => ({ id, name: candidateLabel(id) }))
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </select>
                </div>
              ))}
            </section>
          )}

          {settled.length > 0 && (
            <section>
              <h2>Values already set</h2>
              {settled.map((step) => (
                <div key={step.id} className="settled">
                  <div className="decision-head">
                    <span className="label">{step.label}</span>
                    <span className="tag done">complete</span>
                  </div>
                  {step.budget && (
                    <BudgetEditor stepId={step.id} budget={step.budget} builder={builder} kind={kind} />
                  )}
                  {step.hitPoints && (
                    <HitPointEditor stepId={step.id} state={step.hitPoints} builder={builder} />
                  )}
                </div>
              ))}
            </section>
          )}

          {picks.length === 0 && settled.length === 0 && (
            <p className="lede">Nothing settled yet. Answers appear here once you make them.</p>
          )}
        </aside>
      </div>

      {derived.problems.length > 0 && (
        <section>
          <h2>Problems</h2>
          <ul className="problems">
            {derived.problems.map((problem, i) => (
              <li key={i} className={problem.level}>
                <code>{problem.code}</code> {problem.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Decision({
  decision,
  builder,
  nameOf,
  candidateLabel,
  kind,
  budget,
  hitPoints,
}: {
  decision: OpenDecision;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
  /** A candidate's name plus the book it came from — see `candidateLabel` in the pane. */
  candidateLabel: (id: ElementId) => string;
  kind: ResolvedCharacterKind;
  budget: BuilderState['steps'][number]['budget'];
  hitPoints: BuilderState['steps'][number]['hitPoints'];
}): React.JSX.Element {
  return (
    <>
      <div className="decision-head">
        <span className="label">{decision.label}</span>
        {!decision.blocking && <span className="tag">optional</span>}
        <span className="tag open">{decision.remaining} left</span>
        {decision.openedAt !== undefined && (
          // The level in the *granting element's own track*, not the character's total — on a
          // Rogue 5 / Wizard 3 a wizard rule's level 3 means wizard 3 (ADR 0015).
          <span className="tag">opened at {decision.openedAt}</span>
        )}
        {decision.from && <span className="from">from {nameOf(decision.from)}</span>}
      </div>

      {decision.kind === 'budget' ? (
        budget ? (
          <BudgetEditor stepId={decision.stepId} budget={budget} builder={builder} kind={kind} />
        ) : (
          // A budget decision whose step has no budget is a contradiction the view-model cannot
          // produce; it is here so a future one says so rather than rendering nothing.
          <p className="hint">This step declares a budget the builder did not publish.</p>
        )
      ) : decision.kind === 'hitpoints' ? (
        hitPoints ? (
          <HitPointEditor stepId={decision.stepId} state={hitPoints} builder={builder} />
        ) : (
          <p className="hint">This step declares per-level rolls the builder did not publish.</p>
        )
      ) : (
        <>
          {/*
            What this decision already holds, for a slot filled while others are still open —
            a wizard's first cantrip, say, with a second and third still to pick. Always empty
            for a `pick`, which is answered once and moves to "Choices already made" instead;
            visible here only for a `select` asking for more than one (ADR 0032). Each answer
            can be taken back on its own, which `choose` already supports — the write is just
            the remaining set with one id removed.
          */}
          {decision.chosen.length > 0 && (
            <ul className="chosen-values">
              {decision.chosen.map((id) => (
                <li key={id}>
                  {candidateLabel(id)}
                  <button
                    type="button"
                    onClick={() =>
                      builder.choose(
                        decision.id,
                        decision.chosen.filter((chosenId) => chosenId !== id),
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {decision.candidates.length > 0 ? (
            <select
              defaultValue=""
              onChange={(event) => {
                // `choose` replaces the whole recorded list, so a slot that fills one at a
                // time has to send it what is already there plus the new one — never just
                // the new one, which is the bug this reopens every time the select is used
                // again (ADR 0032). `decision.chosen` is `[]` for a `pick`, so this is exactly
                // "replace" there and "add to" here without a separate branch for either.
                if (event.target.value) {
                  builder.choose(decision.id, [...decision.chosen, event.target.value]);
                }
              }}
            >
              <option value="" disabled>
                Choose one of {decision.candidates.length}…
              </option>
              {decision.candidates
                .map((id) => ({ id, name: candidateLabel(id) }))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
            </select>
          ) : decision.unresolved.length > 0 ? (
            // Not the same sentence as the one below, and the difference matters: adding a
            // content source will not help here, so saying "no content matches" would send the
            // user to do something useless. See OpenDecision.unresolved.
            <p className="hint">
              This choice filters on{' '}
              <code>{decision.unresolved.map((k) => `$(${k})`).join(', ')}</code>, which Incudo
              does not resolve yet — so it can offer nothing rather than the wrong thing. Not a
              missing content source.
            </p>
          ) : (
            <p className="hint">No candidate in the loaded content matches this choice.</p>
          )}
        </>
      )}
    </>
  );
}
