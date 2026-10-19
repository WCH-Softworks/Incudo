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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CharacterBuilder,
  BuilderState,
  OpenDecision,
  SettledPick,
  DeclinedDecision,
  StartingSource,
  FeatureLibrary,
} from '@incudo/ui';
import {
  progressPrintedHint,
  progressResetLabel,
  candidateLabel as describeCandidate,
  decisionTags,
  formatProgress,
  progressLabel,
  settledSteps,
  slotOptions,
  stepStatus,
  stepTone,
  unplacedNote,
  UNCOUNTED_HEADING,
  UNCOUNTED_HINT,
  ADDITIONS_HEADING,
  CUSTOM_FEATURES_HEADING,
  holderGrantSections,
  holderGrantsHeading,
  holderGrantsHint,
  holderGrantStatus,
  holderGrantsUnseenNote,
  withSlot,
  withoutSlot,
  STARTING_EQUIPMENT_HEADING,
  INVENTORY_HEADING,
  ADVANCED_OPTIONS_LABEL,
  additionsOnTab,
  buildTabContent,
  buildTabs,
  settledEditView,
  shownTab,
  spellsWaitingNote,
  SETTLED_EDIT_BACK,
  SETTLED_EDIT_HINT,
  SETTLED_VALUES_HINT,
  SPELL_DECISIONS_HEADING,
  SPELLS_CHOSEN_HEADING,
  type SettledEdit,
  type SettledEditView,
  advancedOptionsHint,
  arrivedDecision,
  decisionGroups,
  decisionKey,
  optionalDecisionsLabel,
  startOptionsSummary,
  ARRIVAL_GUARD_MS,
  NOTHING_REQUIRED,
  OPTIONAL_DECISIONS_HINT,
  START_OPTIONS_CHANGE,
  type BuildPreferences,
} from '@incudo/ui';
import type { ElementId, ElementIndex, ResolvedCharacterKind } from '@incudo/core';

import { BudgetEditor, CompactBudget } from './BudgetEditor.tsx';
import { HitPointEditor, CompactHitPoints } from './HitPointEditor.tsx';
import { ClassLevels } from './ClassLevels.tsx';
import { PreparedSpells } from './PreparedSpells.tsx';
import { PublicationsEditor } from './PublicationsEditor.tsx';
import { CandidatePicker, ChosenCandidate } from './CandidatePicker.tsx';
import { PreviewDock, PreviewDockProvider } from './PreviewDock.tsx';
import { CustomFeatures } from './CustomFeatures.tsx';
import { Additions } from './Additions.tsx';
import { References } from './References.tsx';
import { FreeformEditor } from './Freeform.tsx';
import { StartingEquipmentSettled, StartingOptions } from './StartingEquipment.tsx';
import { InventoryEditor } from './InventoryEditor.tsx';
import { SpellAttacksEditor } from './SpellAttacks.tsx';
import { StartOptionsDialog } from './StartOptions.tsx';

/** Why the campaign options' dialog is open (ADR 0123): New character asked, or Change… on Build. */
export type StartOptionsAsk = 'new' | 'change';

export function BuilderPane({
  builder,
  state,
  featureLibrary,
  elements,
  hasContent,
  preferences,
  onPreferences,
  startOptions,
  onStartOptions,
}: {
  builder: CharacterBuilder;
  state: BuilderState;
  featureLibrary: FeatureLibrary;
  elements: ElementIndex;
  hasContent: boolean;
  /** How this user likes the pane (ADR 0115), and how to change it. */
  preferences: BuildPreferences;
  onPreferences: (change: Partial<BuildPreferences>) => void;
  /** The campaign options' dialog, open or not, and how to open or close it; the shell holds it so shortcuts wait. */
  startOptions: StartOptionsAsk | null;
  onStartOptions: (ask: StartOptionsAsk | null) => void;
}): React.JSX.Element {
  const { kind, derived, decisions, steps, picks, declined, preparation, publications, progress, holderGrants } = state;
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
  const settled = settledSteps(state);

  // Which tabs this character has, and what each lists (ADR 0124): spells on their own tab when there are any.
  const tabs = buildTabs(state);
  const tab = shownTab(preferences.tab, tabs);
  const spellsShown = tabs.some((t) => t.id === 'spells');
  const content = buildTabContent(state);
  const buildPicks = content.build.picks;

  // What must be answered, then what may be, folded (ADR 0123). The builder sorted them; this only splits them.
  const groups = decisionGroups(content.build.decisions);
  const spellGroups = decisionGroups(content.spells.decisions);

  // A settled answer or set of values being changed, in the middle column where open decisions are (ADR 0124). Gone
  // once what it edits is gone; Escape, Back and switching tab close it.
  const [edit, setEdit] = useState<SettledEdit | undefined>(undefined);
  const editView = settledEditView(state, edit);
  const editing = editView !== undefined;
  useEffect(() => {
    if (edit && !editing) setEdit(undefined);
  }, [edit, editing]);
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setEdit(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);
  // The editor is brought into view, whichever decision the user had scrolled to: in its column when the columns
  // scroll, on the page when the page does (a short window), since Change may be pressed far down the column beside.
  const middle = useRef<HTMLElement>(null);
  useEffect(() => {
    if (edit) middle.current?.querySelector('.settled-edit')?.scrollIntoView({ block: 'nearest' });
  }, [edit]);
  const switchTab = (id: typeof tab): void => {
    setEdit(undefined);
    onPreferences({ tab: id });
  };
  const editor = editView && (
    <SettledEditor view={editView} state={state} builder={builder} elements={elements} candidateLabel={candidateLabel} onClose={() => setEdit(undefined)} />
  );
  const optionalFold = (list: OpenDecision[]): React.JSX.Element | null =>
    list.length > 0 ? (
      <details
        className="optional-decisions"
        open={preferences.optionalOpen}
        onToggle={(event) => {
          const open = (event.currentTarget as HTMLDetailsElement).open;
          if (open !== preferences.optionalOpen) onPreferences({ optionalOpen: open });
        }}
      >
        <summary>{optionalDecisionsLabel(list.length)}</summary>
        <p className="hint">{OPTIONAL_DECISIONS_HINT}</p>
        <ul className="decisions">{list.map(decisionItem)}</ul>
      </details>
    ) : null;
  const dock = (
    <PreviewDock
      elements={elements}
      candidateLabel={candidateLabel}
      collapsed={preferences.previewCollapsed}
      onCollapsed={(collapsed) => onPreferences({ previewCollapsed: collapsed })}
    />
  );
  const settledPick = (pick: SettledPick): React.JSX.Element => (
    <div key={pick.ruleKey} className="settled">
      <div className="decision-head">
        <span className="label">{pick.label}</span>
      </div>
      <SettledPickEditor
        pick={pick}
        builder={builder}
        elements={elements}
        candidateLabel={candidateLabel}
        onEdit={(slot) => setEdit({ kind: 'pick', ruleKey: pick.ruleKey, slot })}
        editing={edit?.kind === 'pick' && edit.ruleKey === pick.ruleKey ? edit.slot : undefined}
      />
    </div>
  );

  // The card that has just taken the top, marked for a moment so a quick second click is not spent on it (ADR 0123).
  const topKey = decisions[0] ? decisionKey(decisions[0]) : undefined;
  const previousTop = useRef<string | undefined>(undefined);
  const [arrived, setArrived] = useState<string | undefined>(undefined);
  useEffect(() => {
    const key = arrivedDecision(previousTop.current, decisions);
    previousTop.current = topKey;
    if (key === undefined) return;
    setArrived(key);
    const timer = setTimeout(() => setArrived(undefined), ARRIVAL_GUARD_MS);
    return () => clearTimeout(timer);
    // Only a change of the top matters; the list itself changes on every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topKey]);

  const decisionItem = (decision: OpenDecision): React.JSX.Element => (
    <li key={decisionKey(decision)} className={arrived === decisionKey(decision) ? 'arrived' : undefined}>
      <Decision
        decision={decision}
        builder={builder}
        elements={elements}
        nameOf={nameOf}
        candidateLabel={candidateLabel}
        kind={kind}
        budget={steps.find((step) => step.id === decision.stepId)?.budget}
        hitPoints={steps.find((step) => step.id === decision.stepId)?.hitPoints}
        startingSource={state.startingEquipment?.sources.find((source) => source.key === decision.id)}
      />
    </li>
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
        {/*
          A level is not typed here: it moves one at a time, with the buttons at the head of the middle column,
          where the class it goes to is chosen too. A challenge rating or an xp total is a number to type.
        */}
        {progression.kind !== 'level' && (
          <label>
            {progressLabel(kind) ?? 'Progress'}
            <input
              type="number"
              // A kind a creature prints for shows the creature's number faded until one is typed, as the
              // ability scores do; clearing the field goes back to it. Every other kind always has a value.
              value={progress.printable && !progress.recorded ? '' : progress.value}
              placeholder={progress.printable && !progress.recorded ? String(progress.value) : undefined}
              min={progression.kind === 'none' ? 0 : (progression.min ?? 0)}
              max={progression.kind === 'none' ? 0 : (progression.max ?? 20)}
              // A challenge rating can be 1/8, 1/4 or 1/2, typed as 0.125, 0.25 or 0.5. A level cannot.
              step={progression.kind === 'rating' ? 'any' : 1}
              disabled={progression.kind === 'none'}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === '') {
                  if (progress.printable) builder.setProgress(undefined);
                  return;
                }
                builder.setProgress(Number(raw));
              }}
            />
          </label>
        )}
        {progressResetLabel(progress, nameOf) !== undefined && (
          <button type="button" className="link" onClick={() => builder.setProgress(undefined)}>
            {progressResetLabel(progress, nameOf)}
          </button>
        )}
        {progression.kind === 'rating' && (
          <span className="hint">
            {progressPrintedHint(progress, nameOf) ?? 'The number you set here is the one the sheet uses.'} Type 0.125, 0.25 or 0.5 for 1/8, 1/4 or 1/2.
          </span>
        )}
      </section>

      {/*
        The tabs (ADR 0115, ADR 0124): what the character is built from, which is finished one day, its spells when it has
        any, and what stays open for as long as it is played. The user's last choice is remembered; Switch Build tab in the
        View menu moves between them. A tab with required decisions waiting says how many.
      */}
      <nav className="build-tabs" role="tablist" aria-label="Build">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'build-tab active' : 'build-tab'}
            onClick={() => switchTab(t.id)}
          >
            {t.label}
            {t.required !== undefined && t.required > 0 && <span className="count"> {t.required}</span>}
          </button>
        ))}
      </nav>

      {!hasContent && (
        <div className="problem warning">
          <strong>No content loaded.</strong>
          {/*
            The system definition is loaded, so the kind's baseline grants still apply; only
            choices need content.
          */}
          <p>
            Nothing can be chosen until a content source is added. Add one on the Sources pane.
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
      {tab === 'build' && (
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
                {state.startOptions
                  .filter((question) => question.stepId === step.id)
                  .map((question) => (
                    <span key={question.stepId} className="chosen">
                      {startOptionsSummary(question.chosen, nameOf)}
                    </span>
                  ))}
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
                {/* "quiet" is a plain tag: optional, skipped or nothing to choose, none of them done or owed. */}
                <span className={`tag ${stepTone(step)}`}>{stepStatus(step)}</span>
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

          {/*
            Steps a system marks advanced (ADR 0115) are left out of Open decisions until this is on: a preference of
            the user's, never the character's. Anything already taken through one is still listed above and settled.
          */}
          {state.advanced.steps.length > 0 && (
            <div className="advanced-switch">
              <label>
                <input
                  type="checkbox"
                  checked={preferences.showAdvanced}
                  onChange={(event) => onPreferences({ showAdvanced: event.target.checked })}
                />
                {ADVANCED_OPTIONS_LABEL}
              </label>
              <p className="hint">{advancedOptionsHint(state.advanced.steps)}</p>
            </div>
          )}

        </section>

        <section ref={tab === 'build' ? middle : undefined} className={editing ? 'editing' : undefined}>
          {editor ?? (
          <>
          {/*
            The level, and the class each level goes to (ADR 0036). Not a decision and never outstanding,
            but it is how the character grows, so it heads the column where what a new level opens arrives.
            It sat in the settled column once, below everything already chosen, and taking a second class
            there was hard enough to find that it read as not built.
          */}
          {progression.kind === 'level' && (
            <section className="level-panel">
              <h2>{progressLabel(kind) ?? 'Level'}{classLevelsStep?.classLevels ? ' and classes' : ''}</h2>
              <ClassLevels
                {...(classLevelsStep?.classLevels
                  ? { stepId: classLevelsStep.id, state: classLevelsStep.classLevels }
                  : {})}
                level={progress.value}
                bounds={{ min: progression.min, max: progression.max }}
                builder={builder}
                nameOf={nameOf}
                candidateLabel={candidateLabel}
                stats={kind.stats}
              />
            </section>
          )}

          <h2>
            Open decisions <span className="count">{groups.required.length}</span>
          </h2>
          {content.build.decisions.length === 0 && (
            <p className="lede">Nothing outstanding. Every blocking decision has an answer.</p>
          )}
          {content.build.decisions.length > 0 && groups.required.length === 0 && <p className="lede">{NOTHING_REQUIRED}</p>}
          <ul className="decisions">{groups.required.map(decisionItem)}</ul>
          {/* Required spell choices wait on their own tab (ADR 0124); said here so the build does not read as done. */}
          {spellsWaitingNote(spellGroups.required.length) && (
            <p className="hint">
              {spellsWaitingNote(spellGroups.required.length)}{' '}
              <button type="button" className="link" onClick={() => switchTab('spells')}>
                Go to Spells
              </button>
            </p>
          )}
          {/*
            Folded until opened, and remembered (ADR 0123): the user scrolled past an alignment, a deity and a variant
            for the whole build to find the one thing owed. Open, it is the same cards in the same order.
          */}
          {optionalFold(groups.optional)}
          </>
          )}
        </section>

        <aside className="settled-column">
          {/*
            Where the option being pointed at is read, above everything else in this column so it
            is in the same place whichever list the pointer is over. It keeps its content when the
            pointer leaves, which is what lets a long description be scrolled. It renders nothing
            when the columns are stacked or the device cannot hover; see `PreviewDock`.
          */}
          {dock}

          {/*
            A budget that is finished leaves `decisions`, which is correct — it is not
            outstanding — and would take the editor off the screen with it, leaving no way to
            change a score you had already set. So a settled budget renders here instead. The two
            conditions are mutually exclusive, so the editor appears exactly once either way.

            An answered `pick` had the same hole, and now has the same answer beside it.
          */}
          {(buildPicks.length > 0 || state.startOptions.length > 0) && (
            <section>
              <h2>Choices already made</h2>
              <p className="hint">
                Changing one of these rebuilds everything that followed from it. Anything it
                opened that you had answered is kept only where the new choice offers it too.
              </p>
              {/* Asked when the character was started (ADR 0123), and changed in the same dialog. */}
              {state.startOptions.map((question) => (
                <div key={question.stepId} className="settled">
                  <div className="decision-head">
                    <span className="label">{question.label}</span>
                    <button type="button" className="link" onClick={() => onStartOptions('change')}>
                      {START_OPTIONS_CHANGE}
                    </button>
                  </div>
                  <p>{startOptionsSummary(question.chosen, candidateLabel)}</p>
                </div>
              ))}
              {buildPicks.map(settledPick)}
            </section>
          )}

          {/*
            What the character is given and does not hold, because the element's own prerequisites rule it out (ADR
            0071): a feature an optional one replaces, or a proficiency that needs a campaign option. Listed so taking a
            replacing feature says what it replaced rather than making it disappear (ADR 0072). Nothing to change here:
            it comes back when what rules it out is gone.
          */}
          {state.withdrawn.length > 0 && (
            <section className="withdrawn">
              <h2>Not held</h2>
              <p className="hint">
                Given to this character and ruled out by their own prerequisites: something the character has replaces
                them, or they need a rule this character does not use. They come back when that changes, with any
                choices already made for them.
              </p>
              <ul className="withdrawn-list">
                {state.withdrawn.map((row) => (
                  <li key={row.elementId}>
                    <span className="name">{row.name}</span>
                    <span className="hint"> from {row.grantedBy.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/*
            What the character chose earlier and no longer counts (ADR 0096): a class whose levels went to another, a
            level lowered below the one that opened a choice, or more picks than a choice has room for now. Kept in the
            record and counted again when the slot is back; Forget is the only thing that removes one.
          */}
          {state.uncounted.length > 0 && (
            <section className="withdrawn">
              <h2>{UNCOUNTED_HEADING}</h2>
              <p className="hint">{UNCOUNTED_HINT}</p>
              {state.uncounted.map((row) => (
                <div key={row.ruleKey} className="settled">
                  <h3>{row.label}</h3>
                  <p className="hint">{row.note}</p>
                  <ul className="withdrawn-list">
                    {row.items.map((item) => (
                      <li key={item.position}>
                        <span className="name">{item.name}</span>{' '}
                        <button type="button" className="link" onClick={() => builder.forgetUncounted(row.ruleKey, item.position)}>
                          Forget
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {/*
            What a held element gives, by its setters or its own grants: a creature's traits, actions
            and reactions, and a homebrew creature's legendary actions. Not decisions, since nothing is
            owed, and not picks, since nobody chose them; each can be taken away and given back (ADR
            0061, ADR 0067). Grouped by the element that gives them, and within that by the heading the
            builder names, in the order it lists them.
          */}
          {holderGrantSections(holderGrants, (id) => elements.get(id) !== undefined).map(({ from, groups }) => (
            <section key={from} className="holder-grants">
              <h2>{holderGrantsHeading(nameOf(from))}</h2>
              <p className="hint">{holderGrantsHint(nameOf(from))}</p>
              {groups.map((group) => (
                <div key={group.label} className="settled">
                  <div className="decision-head">
                    <span className="label">{group.label}</span>
                  </div>
                  <ul className="holder-grant-list">
                    {group.rows.map((grant) => (
                      <li key={grant.elementId} className={grant.removed ? 'removed' : ''}>
                        <span className="name">{candidateLabel(grant.elementId)}</span>
                        {grant.removed ? (
                          <>
                            <span className="hint"> {holderGrantStatus(grant)}</span>
                            <button type="button" className="link" onClick={() => builder.restoreGranted(grant.elementId)}>
                              Give back
                            </button>
                          </>
                        ) : (
                          <button type="button" className="link" onClick={() => builder.removeGranted(grant.elementId)}>
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                    {group.unseen > 0 && (
                      <li className="removed">
                        <span className="hint">{holderGrantsUnseenNote(group.unseen)}</span>
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </section>
          ))}

          {/*
            Features the user wrote for this character (ADR 0063). Not a decision: nothing is owed. Beside
            what the creature gives, since a feature is listed on the sheet with the creature's traits, actions
            or, on a legendary creature, its legendary actions (ADR 0065).
          */}
          {state.customFeatures.available && (
            <section className="custom-features">
              <h2>{CUSTOM_FEATURES_HEADING}</h2>
              <CustomFeatures state={state} builder={builder} library={featureLibrary} />
            </section>
          )}

          {/*
            What the user added from loaded content (ADR 0064): conditions, feats, languages and the like, whatever
            their prerequisites. Not a decision either: nothing is owed, and the list it offers is everything loaded.
          */}
          {state.additions.available && (
            <section className="additions-section">
              <h2>{ADDITIONS_HEADING}</h2>
              <Additions
                state={state}
                builder={builder}
                elements={elements}
                candidateLabel={candidateLabel}
                // Spells are added on their own tab when it is shown; with no tab, here, or a first one could not be.
                additions={spellsShown ? additionsOnTab(state.additions, kind, 'build') : state.additions}
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
                    {step.complete && <span className="tag done">complete</span>}
                  </div>
                  {step.budget && (
                    <CompactBudget
                      stepId={step.id}
                      budget={step.budget}
                      builder={builder}
                      kind={kind}
                      onEdit={() => setEdit({ kind: 'values', stepId: step.id })}
                    />
                  )}
                  {step.hitPoints && (
                    <CompactHitPoints
                      stepId={step.id}
                      state={step.hitPoints}
                      builder={builder}
                      onEdit={() => setEdit({ kind: 'values', stepId: step.id })}
                    />
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

          {buildPicks.length === 0 && settled.length === 0 && declined.length === 0 && (
            <p className="lede">Nothing settled yet. Answers appear here once you make them.</p>
          )}
        </aside>
      </div>
      )}

      {/*
        The character's spells (ADR 0124), as Aurora's builder keeps them apart: the spell choices content opens, how its
        cantrips attack, what each casting class prepares today, and spells added by hand. The middle column holds what is
        still to choose and what changes often; the column beside it what is already chosen. A spell an invocation needs is
        not a filter here: the invocation is offered on Build with a warning.
      */}
      {tab === 'spells' && (
        <div className="columns details">
          <section ref={middle} className={editing ? 'editing' : undefined}>
            {editor ?? (
              <>
                <h2>
                  {SPELL_DECISIONS_HEADING} <span className="count">{spellGroups.required.length}</span>
                </h2>
                {content.spells.decisions.length === 0 && <p className="lede">Every spell choice has an answer.</p>}
                {content.spells.decisions.length > 0 && spellGroups.required.length === 0 && (
                  <p className="lede">{NOTHING_REQUIRED}</p>
                )}
                <ul className="decisions">{spellGroups.required.map(decisionItem)}</ul>
                {optionalFold(spellGroups.optional)}

                {/* A spell's attack row and what content does not say about it (ADR 0111): shown only once one is held. */}
                {state.spellAttacks.rows.length > 0 && (
                  <section className="spell-attacks-section">
                    <h2>{state.spellAttacks.label}</h2>
                    <SpellAttacksEditor state={state.spellAttacks} builder={builder} />
                  </section>
                )}

                {/*
                  The list each casting block prepares. Not a decision: nothing is owed, and a character may prepare none.
                  It can be reached on a save opened with no content source, where what is already on the list still reads
                  and only offering more needs content.
                */}
                {preparation.length > 0 && kind.preparation && (
                  <section>
                    <h2>Prepared {kind.preparation.elementType.toLowerCase()}s</h2>
                    <PreparedSpells
                      rows={preparation}
                      builder={builder}
                      elements={elements}
                      candidateLabel={candidateLabel}
                      noun={kind.preparation.elementType.toLowerCase()}
                    />
                  </section>
                )}
              </>
            )}
          </section>

          <aside className="settled-column">
            {dock}
            {content.spells.picks.length > 0 && (
              <section>
                <h2>{SPELLS_CHOSEN_HEADING}</h2>
                {content.spells.picks.map(settledPick)}
              </section>
            )}
            {state.additions.available && additionsOnTab(state.additions, kind, 'spells').types.length > 0 && (
              <section className="additions-section">
                <h2>{ADDITIONS_HEADING}</h2>
                <Additions
                  state={state}
                  builder={builder}
                  elements={elements}
                  candidateLabel={candidateLabel}
                  additions={additionsOnTab(state.additions, kind, 'spells')}
                />
              </section>
            )}
          </aside>
        </div>
      )}

      {/*
        What stays open for as long as the character is played (ADR 0115): what it carries and its money (what it has
        prepared today is on Spells since ADR 0124), which books it is offered, what is written about it and what it keeps for reference. None of it is
        ever finished, so none of it sits among the choices the build asks for. A starting package still to take is an
        open decision on Build; once taken it is listed here with the bag it went into.
      */}
      {tab === 'details' && (
        <div className="columns details">
          <section>
            {state.startingEquipment && state.startingEquipment.sources.some((source) => source.status !== 'open') && (
              <section className="starting-equipment">
                <h2>{STARTING_EQUIPMENT_HEADING}</h2>
                <StartingEquipmentSettled state={state.startingEquipment} builder={builder} nameOf={nameOf} />
              </section>
            )}

            {/*
              The bag and the purse, edited at any point (ADR 0098): add or buy, equip, attune, attach, open, name, and the
              coins. Not a decision: nothing is owed, and what each item gives is said beside it.
            */}
            {state.inventory && (
              <section className="inventory-section">
                <h2>{INVENTORY_HEADING}</h2>
                <InventoryEditor state={state.inventory} builder={builder} elements={elements} candidateLabel={candidateLabel} />
              </section>
            )}

          </section>

          <aside className="settled-column">
            {dock}

            {/* What the user writes about the character (ADR 0092): no rule reads it, and the sheet shows it. */}
            {state.freeform.available && (
              <section className="freeform-section">
                <h2>{state.freeform.label}</h2>
                <FreeformEditor state={state.freeform} builder={builder} />
              </section>
            )}

            {/*
              What the character keeps beside it for reference (ADR 0068): a stat block printed only as prose. Nothing is
              worked out from it.
            */}
            {state.references.available && (
              <section className="references-section">
                <h2>{state.references.label}</h2>
                <References state={state} builder={builder} elements={elements} candidateLabel={candidateLabel} />
              </section>
            )}

            {/*
              Which books this character is offered. Not a decision: nothing is owed, and a character that never opens it
              is offered every book. Shown whenever there is a list to show, which with no content loaded is only the
              names the character recorded.
            */}
            {publications.rows.length > 0 && (
              <section>
                <h2>Books</h2>
                <PublicationsEditor list={publications} builder={builder} />
              </section>
            )}
          </aside>
        </div>
      )}
      </PreviewDockProvider>

      <StartOptionsDialog
        open={startOptions !== null && state.startOptions.length > 0}
        beginning={startOptions === 'new'}
        questions={state.startOptions}
        builder={builder}
        candidateLabel={candidateLabel}
        onClose={() => onStartOptions(null)}
      />

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
  startingSource,
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
  /** The starting equipment an `equipment` decision offers (ADR 0087). */
  startingSource: StartingSource | undefined;
}): React.JSX.Element {
  // What each candidate would give that the character already has, worked out once per state of the decision.
  const notes = useMemo(
    () => (decision.candidates.length ? builder.overlapNotesFor(decision.id) : undefined),
    [builder, decision],
  );
  // What a candidate offered all the same lacks of a prerequisite the kind makes soft (ADR 0124): an invocation's cantrip.
  const warnings = useMemo(
    () => (decision.candidates.length ? builder.softNotesFor(decision.id) : undefined),
    [builder, decision],
  );
  return (
    <>
      <div className="decision-head">
        <span className="label">{decision.label}</span>
        {/* "optional", "2 left" (never for a set), "opened at 4" in the granting element's own track (ADR 0015). */}
        {decisionTags(decision).map((tag) => (
          <span key={tag} className={/ left$|^all recorded$/.test(tag) ? 'tag open' : 'tag'}>
            {tag}
          </span>
        ))}
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

      {decision.kind === 'equipment' ? (
        startingSource ? (
          <StartingOptions source={startingSource} builder={builder} candidateLabel={candidateLabel} />
        ) : (
          <p className="hint">Incudo could not show this step. This is a bug in Incudo.</p>
        )
      ) : decision.kind === 'budget' ? (
        budget ? (
          <>
            <BudgetEditor stepId={decision.stepId} budget={budget} builder={builder} kind={kind} />
            {/*
              Every score set: the card waits for this rather than vanishing under the pointer with the last one (ADR
              0123), as a hit point roll's does. Until then the editor above is the way forward.
            */}
            {decision.remaining === 0 && (
              <button type="button" onClick={() => builder.confirmBudget(decision.stepId)}>
                Done
              </button>
            )}
          </>
        ) : (
          // A budget decision whose step has no budget is a contradiction the view-model cannot
          // produce; it is here so a future one says so rather than rendering nothing.
          <p className="hint">Incudo could not show this step. This is a bug in Incudo.</p>
        )
      ) : decision.kind === 'hitpoints' ? (
        hitPoints ? (
          <>
            <HitPointEditor stepId={decision.stepId} state={hitPoints} builder={builder} only={decision.hitPointLevel} />
            {/*
              Only once this level is recorded. The card has stayed open for this on purpose — a roll is not an
              acceptance — and this is what closes it. Until then the buttons above are the way forward.
            */}
            {decision.remaining === 0 && decision.hitPointLevel !== undefined && (
              <button type="button" onClick={() => builder.confirmHitPoints(decision.stepId, decision.hitPointLevel)}>
                Done
              </button>
            )}
          </>
        ) : (
          // The same contradiction for per-level rolls: a hitpoints decision with no state.
          <p className="hint">Incudo could not show this step. This is a bug in Incudo.</p>
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
              {/*
                Every set step, not only campaign options: an NPC's traits and actions are sets too.
                The step's own sentence where the system wrote one, then what is true of any set.
              */}
              {kind.buildSteps.find((step) => step.id === decision.stepId)?.description ??
                'Add as many as apply, or skip this if none do.'}{' '}
              What you add can be taken back later.
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
              notes={notes}
              warnings={warnings}
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
            // The filter's unresolved `$(key)`s stay on screen in code, for a bug report.
            <p className="hint">
              Incudo cannot yet work out which options this choice allows, so it offers none
              rather than the wrong ones. Adding a content source will not change this. (It
              depends on{' '}
              <code>{decision.unresolved.map((k) => `$(${k})`).join(', ')}</code>.)
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
  onEdit,
  editing,
}: {
  pick: SettledPick;
  builder: CharacterBuilder;
  elements: ElementIndex;
  /** A candidate's name plus the book it came from — see `candidateLabel` in the pane. */
  candidateLabel: (id: ElementId) => string;
  /** Change opens this slot's list in the middle column (ADR 0124). */
  onEdit: (slot: number) => void;
  /** The slot being changed there now, marked here. */
  editing?: number;
}): React.JSX.Element {
  // An answer that lacks a prerequisite the kind makes soft (ADR 0124): still held, and said so.
  const warnings = useMemo(() => builder.softNotesFor(pick.ruleKey), [builder, pick]);
  return (
    <div className="settled-slots">
      {pick.chosen.map((id, index) => {
        const options = slotOptions(pick, index);
        return (
          <Fragment key={index}>
            <div className={editing === index ? 'settled-slot editing' : 'settled-slot'}>
            <ChosenCandidate
              id={id}
              elements={elements}
              candidateLabel={candidateLabel}
              options={options}
              warning={warnings.get(id)}
              onChangeRequest={options.length > 1 ? () => onEdit(index) : undefined}
              // Only for a set, which the view-model says: taking back one member of it writes the
              // rest, and the last one leaves the decision open again.
              onRemove={
                pick.multiple
                  ? () => builder.choose(pick.ruleKey, withoutSlot(pick, index))
                  : undefined
              }
            />
            </div>
            {/* An answer no slot of this choice would offer any more (ADR 0096): still counted, and said so. */}
            {pick.unplaced?.includes(id) && <p className="hint">{unplacedNote(elements.get(id)?.name ?? id)}</p>}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * A settled answer or a set of values, changed in the middle column (ADR 0124). It used to open inside its card in the
 * column beside, under the description, in a strip a hand tall. Here it has the column: a slot's list with its answer
 * marked and first, or the step's own editor; Back, Escape or a new answer return to the open decisions. What it edits
 * is `settledEditView`'s; this renders it.
 */
function SettledEditor({
  view,
  state,
  builder,
  elements,
  candidateLabel,
  onClose,
}: {
  view: SettledEditView;
  state: BuilderState;
  builder: CharacterBuilder;
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
  onClose: () => void;
}): React.JSX.Element {
  const pick = view.kind === 'pick' ? view.pick : undefined;
  const slot = view.kind === 'pick' ? view.slot : -1;
  // Asked once per opening, as the card's own Change did: a settled slot's notes cost a derivation.
  const notes = useMemo(() => (pick ? builder.overlapNotesFor(pick.ruleKey, slot) : undefined), [builder, pick?.ruleKey, slot]);
  const warnings = useMemo(() => (pick ? builder.softNotesFor(pick.ruleKey) : undefined), [builder, pick]);
  const step = view.kind === 'values' ? state.steps.find((s) => s.id === view.stepId) : undefined;
  return (
    <section className="settled-edit" aria-label={view.title}>
      <div className="decision-head">
        <h2>{view.title}</h2>
        <button type="button" className="link" onClick={onClose}>
          {SETTLED_EDIT_BACK}
        </button>
      </div>
      <p className="hint">{view.kind === 'pick' ? SETTLED_EDIT_HINT : SETTLED_VALUES_HINT}</p>
      {view.kind === 'pick' ? (
        <CandidatePicker
          key={`${view.pick.ruleKey}:${view.slot}`}
          candidates={view.options}
          current={view.current}
          elements={elements}
          candidateLabel={candidateLabel}
          notes={notes}
          warnings={warnings}
          onSelect={(next) => {
            if (next !== view.current) builder.choose(view.pick.ruleKey, withSlot(view.pick, view.slot, next));
            onClose();
          }}
        />
      ) : (
        <>
          {step?.budget && <BudgetEditor stepId={step.id} budget={step.budget} builder={builder} kind={state.kind} />}
          {step?.hitPoints && <HitPointEditor stepId={step.id} state={step.hitPoints} builder={builder} />}
          <button type="button" onClick={onClose}>
            Done
          </button>
        </>
      )}
    </section>
  );
}
