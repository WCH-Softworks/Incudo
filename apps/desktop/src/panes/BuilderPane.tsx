/**
 * Every outstanding decision, in one list.
 *
 * ADR 0017 is the whole shape of this pane: there is no current step, so there is nothing to
 * navigate back from. Steps are a *grouping* with `available` / `blockedBy`, not a sequence —
 * and a decision that opens at level 4 arrives in the same list as the one that opened at level
 * 1, tagged with where it came from. The shell may focus a decision; it may not decide what is
 * outstanding.
 */

import type { CharacterBuilder, BuilderState, OpenDecision } from '@incudo/ui';
import type { ElementId, ElementIndex, ResolvedCharacterKind } from '@incudo/core';

import { BudgetEditor } from './BudgetEditor.tsx';

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
  const { kind, derived, decisions, steps } = state;
  const progression = kind.progression;
  const nameOf = (id: ElementId): string => elements.get(id)?.name ?? id;

  /** Budgeted steps with nothing outstanding — still editable, see below. */
  const settled = steps.filter(
    (step) =>
      step.budget &&
      !decisions.some((decision) => decision.kind === 'budget' && decision.stepId === step.id),
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

      <div className="columns">
        <section>
          <h2>Steps</h2>
          <ul className="steps">
            {steps.map((step) => (
              <li key={step.id} className={step.available ? '' : 'blocked'}>
                <span className="label">{step.label}</span>
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
                  kind={kind}
                  budget={steps.find((step) => step.id === decision.stepId)?.budget}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/*
        A budget that is finished leaves `decisions`, which is correct — it is not outstanding —
        and would take the editor off the screen with it, leaving no way to change a score you
        had already set. So a settled budget renders here instead. The two conditions are
        mutually exclusive, so the editor appears exactly once either way.

        The same hole exists for an answered `pick`: once you have chosen a race, this pane
        offers no way to choose a different one. That is the next thing to fix and it is bigger
        than this pane — see CLAUDE.md, "Known from running it".
      */}
      {settled.length > 0 && (
        <section>
          <h2>Values already set</h2>
          {settled.map((step) => (
            <div key={step.id} className="settled">
              <div className="decision-head">
                <span className="label">{step.label}</span>
                <span className="tag done">complete</span>
              </div>
              <BudgetEditor stepId={step.id} budget={step.budget!} builder={builder} kind={kind} />
            </div>
          ))}
        </section>
      )}

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
  kind,
  budget,
}: {
  decision: OpenDecision;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
  kind: ResolvedCharacterKind;
  budget: BuilderState['steps'][number]['budget'];
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
      ) : decision.candidates.length > 0 ? (
        <select
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) builder.choose(decision.id, [event.target.value]);
          }}
        >
          <option value="" disabled>
            Choose one of {decision.candidates.length}…
          </option>
          {decision.candidates
            .map((id) => ({ id, name: nameOf(id) }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
        </select>
      ) : decision.unresolved.length > 0 ? (
        // Not the same sentence as the one below, and the difference matters: adding a content
        // source will not help here, so saying "no content matches" would send the user to do
        // something useless. See OpenDecision.unresolved.
        <p className="hint">
          This choice filters on <code>{decision.unresolved.map((k) => `$(${k})`).join(', ')}</code>
          , which Incudo does not resolve yet — so it can offer nothing rather than the wrong
          thing. Not a missing content source.
        </p>
      ) : (
        <p className="hint">No candidate in the loaded content matches this choice.</p>
      )}
    </>
  );
}
