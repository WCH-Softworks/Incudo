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
import type { ElementId, ElementIndex } from '@incudo/core';

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
                />
              </li>
            ))}
          </ul>
        </section>
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
}: {
  decision: OpenDecision;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
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
        <p className="hint">
          Ability scores are an input with no formula (ADR 0014). The point-buy and standard-array
          editor is still to be built — this shell shows that the decision is open and does not
          pretend to answer it.
        </p>
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
      ) : (
        <p className="hint">No candidate in the loaded content matches this choice.</p>
      )}
    </>
  );
}
