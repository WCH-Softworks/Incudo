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

import type {
  CharacterBuilder,
  BuilderState,
  OpenDecision,
  SettledPick,
  DeclinedDecision,
} from '@incudo/ui';
import { candidateLabel as describeCandidate } from '@incudo/ui';
import type { ElementId, ElementIndex, ResolvedCharacterKind } from '@incudo/core';

import { BudgetEditor, CompactBudget } from './BudgetEditor.tsx';
import { HitPointEditor, CompactHitPoints } from './HitPointEditor.tsx';
import { ClassLevels } from './ClassLevels.tsx';
import { CandidatePicker, ChosenCandidate } from './CandidatePicker.tsx';
import { PreviewDock, PreviewDockProvider } from './PreviewDock.tsx';

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
  const { kind, derived, decisions, steps, picks, declined } = state;
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
    // What a system asks a picker to say beside a candidate — a spell's level — is data on the
    // kind, and the formatting is `candidateLabel` in `packages/ui`, which the search matches too.
    return describeCandidate(element, kind.candidateNotes);
  };

  const classLevelsStep = steps.find((step) => step.classLevels);

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
          Name
          <input
            type="text"
            value={state.character.name}
            onChange={(event) => builder.setName(event.target.value)}
          />
        </label>
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
      <PreviewDockProvider>
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
                  elements={elements}
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
            Where the option being pointed at is read, above everything else in this column so it
            is in the same place whichever list the pointer is over. It keeps its content when the
            pointer leaves, which is what lets a long description be scrolled. It renders nothing
            when the columns are stacked or the device cannot hover; see `PreviewDock`.
          */}
          <PreviewDock elements={elements} candidateLabel={candidateLabel} />

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
                  <SettledPickEditor
                    pick={pick}
                    builder={builder}
                    elements={elements}
                    candidateLabel={candidateLabel}
                  />
                </div>
              ))}
            </section>
          )}

          {/*
            Which class each level went to. Not a decision and never outstanding, so it does not
            live in Open decisions: a character with one class has nothing to answer here, and the
            control is for taking a level in another one — or for correcting what an earlier level
            went to. What a level in a new class opens still arrives in the list beside it.
          */}
          {classLevelsStep?.classLevels && (
            <section>
              <h2>Classes</h2>
              <ClassLevels
                stepId={classLevelsStep.id}
                state={classLevelsStep.classLevels}
                builder={builder}
                nameOf={nameOf}
                candidateLabel={candidateLabel}
                stats={kind.stats}
              />
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
                    <CompactBudget stepId={step.id} budget={step.budget} builder={builder} kind={kind} />
                  )}
                  {step.hitPoints && (
                    <CompactHitPoints stepId={step.id} state={step.hitPoints} builder={builder} />
                  )}
                </div>
              ))}
            </section>
          )}

          {declined.length > 0 && (
            <section>
              <h2>Skipped</h2>
              <p className="hint">
                These are optional and answering them is not required. Reconsider brings one back
                to Open decisions.
              </p>
              {declined.map((decision: DeclinedDecision) => (
                <div key={decision.id} className="settled">
                  <div className="decision-head">
                    <span className="label">{decision.label}</span>
                    {decision.from && <span className="from">from {nameOf(decision.from)}</span>}
                    <button
                      type="button"
                      className="link"
                      onClick={() => builder.reconsider(decision.id)}
                    >
                      Reconsider
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {picks.length === 0 && settled.length === 0 && declined.length === 0 && (
            <p className="lede">Nothing settled yet. Answers appear here once you make them.</p>
          )}
        </aside>
      </div>
      </PreviewDockProvider>

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
  elements,
  nameOf,
  candidateLabel,
  kind,
  budget,
  hitPoints,
}: {
  decision: OpenDecision;
  builder: CharacterBuilder;
  elements: ElementIndex;
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
        {/* A set has no count to run down — "3 left" of optional rules would say the opposite. */}
        {!decision.multiple && (
          <span className="tag open">
            {decision.remaining > 0 ? `${decision.remaining} left` : 'all recorded'}
          </span>
        )}
        {decision.openedAt !== undefined && (
          // The level in the *granting element's own track*, not the character's total — on a
          // Rogue 5 / Wizard 3 a wizard rule's level 3 means wizard 3 (ADR 0015).
          <span className="tag">opened at {decision.openedAt}</span>
        )}
        {decision.from && <span className="from">from {nameOf(decision.from)}</span>}
        {/*
          Only where declining means anything (ADR 0033) — a blocking decision has no Skip
          button at all rather than a disabled one, since "you must answer this, but here is
          a button that refuses to" is not a clearer sentence than no button.
        */}
        {!decision.blocking && (
          <button type="button" className="link" onClick={() => builder.decline(decision.id)}>
            Skip
          </button>
        )}
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
          <>
            <HitPointEditor stepId={decision.stepId} state={hitPoints} builder={builder} />
            {/*
              Only once nothing is left to record. The decision has stayed open for this on
              purpose — a roll is not an acceptance — and this is what closes it. Until then
              the rows above are the way forward, so a Done here would be a way to skip them.
            */}
            {hitPoints.reviewing && hitPoints.pending.length === 0 && (
              <button type="button" onClick={() => builder.confirmHitPoints(decision.stepId)}>
                Done
              </button>
            )}
          </>
        ) : (
          <p className="hint">This step declares per-level rolls the builder did not publish.</p>
        )
      ) : (
        <>
          {/*
            No rendering of `decision.chosen` here on purpose. A slot a select already filled
            settles into `picks` the moment it is recorded (ADR 0032) — a wizard's first
            cantrip moves to "Choices already made" while its second and third are still open —
            so this column only ever shows what a `pick` or a `select` still owes. `chosen` is
            still on the decision because the write below needs it (a select fills one slot at
            a time, so it has to send the ones already recorded plus the new one); it is not
            shown twice.
          */}
          {decision.multiple && (
            <p className="hint">
              Rules your table uses beyond the basic ones. Add any that apply, or skip this if it
              uses none. What you add can be taken back later.
            </p>
          )}
          {decision.candidates.length > 0 ? (
            <CandidatePicker
              // Keyed on how many slots are already filled, not just `decision.id`: answering
              // one slot of a pool shrinks `candidates` without changing `decision.id` at all,
              // so without this a wizard's remaining cantrips would reopen on the same search
              // text and expanded row the previous slot was left on. Same remount trick the
              // `<select>` this replaced used, and for the same reason.
              key={`${decision.id}:${decision.chosen.length}`}
              candidates={decision.candidates}
              elements={elements}
              candidateLabel={candidateLabel}
              onSelect={(id) => {
                // `choose` replaces the whole recorded list, so a slot that fills one at a
                // time has to send it what is already there plus the new one — never just
                // the new one, which is the bug this reopens every time the picker is used
                // again (ADR 0032). `decision.chosen` is `[]` for a `pick`, so this is exactly
                // "replace" there and "add to" here without a separate branch for either.
                builder.choose(decision.id, [...decision.chosen, id]);
              }}
            />
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

/**
 * A settled pick or a fully-answered multi-select, as one `ChosenCandidate` card per slot.
 *
 * `pick.chosen` has one entry for a top-level pick and one per filled slot for a content
 * `select` pool (ADR 0032) — a wizard's two Skill Proficiencies, say — and this renders the
 * same control either way rather than branching on how many there are. `pick.candidates`
 * already includes every one of `chosen`, which is what lets a slot offer its own current
 * answer; what it does not do on its own is stop two slots from agreeing on one answer, so
 * each slot's own option list drops every *other* slot's current value before it renders —
 * except for a `repeatable` one, which is offered to every slot because taking it twice is the
 * point: "increase one score by 2" is the same score chosen in both slots (ADR 0035).
 */
function SettledPickEditor({
  pick,
  builder,
  elements,
  candidateLabel,
}: {
  pick: SettledPick;
  builder: CharacterBuilder;
  elements: ElementIndex;
  /** A candidate's name plus the book it came from — see `candidateLabel` in the pane. */
  candidateLabel: (id: ElementId) => string;
}): React.JSX.Element {
  return (
    <div className="settled-slots">
      {pick.chosen.map((id, index) => {
        const options = pick.candidates.filter(
          (candidate) =>
            candidate === id ||
            !pick.chosen.includes(candidate) ||
            pick.repeatable.includes(candidate),
        );
        return (
          <ChosenCandidate
            key={index}
            id={id}
            elements={elements}
            candidateLabel={candidateLabel}
            options={options}
            onChange={(next) => {
              const chosen = [...pick.chosen];
              chosen[index] = next;
              builder.choose(pick.ruleKey, chosen);
            }}
            // Only for a set, which the view-model says: taking back one member of it writes the
            // rest, and the last one leaves the decision open again.
            onRemove={
              pick.multiple
                ? () =>
                    builder.choose(
                      pick.ruleKey,
                      pick.chosen.filter((_, at) => at !== index),
                    )
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
