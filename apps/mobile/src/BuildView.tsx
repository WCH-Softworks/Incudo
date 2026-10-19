/**
 * A character's build on a phone — ROADMAP Phase 6's "Full build flow", ADR 0086.
 *
 * ADR 0017's shape, in one column: no current step and nothing to go back to. What is outstanding is `decisions`, each
 * answered where it is; what was answered is `picks`, each still changeable; the parts that are not elements (scores, hit
 * points, class levels, prepared lists, books), what a held element gives, features of the user's own, additions and
 * references (`BuildExtras.tsx`) sit after them. A renderer of `BuilderState`: every word both shells say
 * is `build-view.ts`'s, every tap a builder method, and choosing an element is the full-screen `Picker`.
 */

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Switch, Text, View } from 'react-native';

import type { ElementId, ElementIndex } from '@incudo/core';
import {
  ADVANCED_OPTIONS_LABEL,
  advancedOptionsHint,
  ADDITIONS_HEADING,
  candidateLabel,
  CUSTOM_FEATURES_HEADING,
  decisionTags,
  formatProgress,
  progressLabel,
  progressPrintedHint,
  progressResetLabel,
  settledSteps,
  slotOptions,
  stepStatus,
  unplacedNote,
  UNCOUNTED_HEADING,
  UNCOUNTED_HINT,
  withSlot,
  withoutSlot,
  type BuilderState,
  type CharacterBuilder,
  type OpenDecision,
  STARTING_EQUIPMENT_HEADING,
  INVENTORY_HEADING,
  arrivedDecision,
  decisionGroups,
  decisionKey,
  optionalDecisionsLabel,
  buildTabContent,
  hasSpellWork,
  SPELL_DECISIONS_HEADING,
  SPELLS_CHOSEN_HEADING,
  type SettledPick,
  startOptionsSummary,
  ARRIVAL_GUARD_MS,
  NOTHING_REQUIRED,
  OPTIONAL_DECISIONS_HINT,
  START_OPTIONS_CHANGE,
} from '@incudo/ui';

import { BooksView, BudgetView, ClassLevelsView, DraftField, HitPointsView, NumberField, PreparedView } from './BuildParts.tsx';
import { AdditionsView, CustomFeaturesView, FreeformView, HolderGrantsView, ReferencesView, SpellAttacksView } from './BuildExtras.tsx';
import { Body, Button, Card, Heading, Row, Tag } from './controls.tsx';
import { Picker, type PickerRequest } from './Picker.tsx';
import { StartingOptionsView, StartingSettledView } from './StartingEquipmentView.tsx';
import { InventoryView } from './InventoryView.tsx';
import { StartOptionsView } from './StartOptionsView.tsx';
import { usePalette } from './theme.ts';

/**
 * Memoized: the screen around it renders on every progress report of a content load, and the build has not changed.
 */
export const BuildView = memo(function BuildView({
  builder,
  state,
  elements,
  hasContent,
  showAdvanced,
  onShowAdvanced,
  optionalOpen,
  onOptionalOpen,
  startOptions,
  onStartOptions,
}: {
  builder: CharacterBuilder;
  state: BuilderState;
  elements: ElementIndex;
  /** Whether any content is loaded: with none, a choice offers nothing, and the screen says why. */
  hasContent: boolean;
  /** The user's advanced options switch (ADR 0115), and how to change it. */
  showAdvanced: boolean;
  onShowAdvanced: (shown: boolean) => void;
  /** Whether the optional decisions are unfolded (ADR 0123), the same record's, and how to change it. */
  optionalOpen: boolean;
  onOptionalOpen: (open: boolean) => void;
  /** The campaign options' sheet (ADR 0123): asked for a new character, or from Change; null while closed. */
  startOptions: 'new' | 'change' | null;
  onStartOptions: (ask: 'new' | 'change' | null) => void;
}) {
  const palette = usePalette();
  const [request, setRequest] = useState<PickerRequest | null>(null);
  const { kind, decisions, steps, picks, declined, preparation, publications, progress } = state;
  const progression = kind.progression;
  const nameOf = useCallback((id: ElementId): string => elements.get(id)?.name ?? id, [elements]);
  // A name and the book it came from, and the system's note (a spell's level): `candidateLabel`, as the desktop's.
  const labelOf = useCallback(
    (id: ElementId): string => {
      const element = elements.get(id);
      return element ? candidateLabel(element, kind.candidateNotes) : id;
    },
    [elements, kind.candidateNotes],
  );
  const stepLabel = (id: string): string => steps.find((step) => step.id === id)?.label ?? id;
  const classLevels = steps.find((step) => step.classLevels);
  const settled = settledSteps(state);
  const progressName = progressLabel(kind);
  // Spells apart from the rest (ADR 0124), as the desktop's Spells tab: on one page here, under a heading of their own.
  const spellsApart = hasSpellWork(state);
  const content = buildTabContent(state);
  const buildDecisions = spellsApart ? content.build.decisions : decisions;
  const buildPicks = spellsApart ? content.build.picks : picks;
  // Required, then optional and folded (ADR 0123); the builder sorted them, this only splits them, as the desktop does.
  const groups = decisionGroups(buildDecisions);
  const spellGroups = decisionGroups(spellsApart ? content.spells.decisions : []);
  // One row per answered slot, each with its Change; a set member also with Remove.
  // An answer that lacks a prerequisite the kind makes soft (ADR 0124) says so under it.
  const pickRows = (pick: SettledPick): React.ReactNode => {
    const warnings = builder.softNotesFor(pick.ruleKey);
    return pick.chosen.map((id, index) => (
      <Row key={`${pick.ruleKey}:${index}`} style={[styles.settled, { borderColor: palette.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: palette.muted, fontSize: 13 }}>{pick.label}</Text>
          <Text style={{ color: palette.text, fontSize: 15 }}>{labelOf(id)}</Text>
          {warnings.has(id) ? <Text style={{ color: palette.text, fontSize: 13 }}>{warnings.get(id)}</Text> : null}
          {pick.unplaced?.includes(id) ? (
            <Text style={{ color: palette.muted, fontSize: 13 }}>{unplacedNote(nameOf(id))}</Text>
          ) : null}
        </View>
        <Button
          label="Change"
          kind="link"
          onPress={() =>
            setRequest({
              title: pick.label,
              options: slotOptions(pick, index),
              current: id,
              notes: builder.overlapNotesFor(pick.ruleKey, index),
              warnings,
              onPick: (next) => builder.choose(pick.ruleKey, withSlot(pick, index, next)),
            })
          }
        />
        {pick.multiple ? <Button label="Remove" kind="link" onPress={() => builder.choose(pick.ruleKey, withoutSlot(pick, index))} /> : null}
      </Row>
    ));
  };

  // The card that has just taken the top, marked for a moment so a quick second tap is not spent on it (ADR 0123).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topKey]);
  const decisionCard = (decision: OpenDecision) => (
    <Arriving key={decisionKey(decision)} arrived={arrived === decisionKey(decision)}>
      <Card>
        <DecisionView decision={decision} state={state} builder={builder} nameOf={nameOf} pick={setRequest} />
      </Card>
    </Arriving>
  );

  return (
    <View style={styles.page}>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: palette.muted }]}>Name</Text>
        <NameField name={state.character.name} onCommit={builder.setName} />
      </View>
      {/* A level moves one at a time, with the buttons that head the build below; a rating or an xp total is typed. */}
      {progression.kind !== 'none' && progression.kind !== 'level' && progressName ? (
        <Row>
          <Text style={[styles.fieldLabel, { color: palette.muted }]}>{progressName}</Text>
          <NumberField
            value={progress.printable && !progress.recorded ? undefined : progress.value}
            placeholder={progress.printable && !progress.recorded ? formatProgress(progress.value) : undefined}
            label={progressName}
            onCommit={(value) => (value === undefined ? progress.printable && builder.setProgress(undefined) : builder.setProgress(value))}
          />
          {progressResetLabel(progress, nameOf) !== undefined ? (
            <Button label={progressResetLabel(progress, nameOf)!} kind="link" onPress={() => builder.setProgress(undefined)} />
          ) : null}
          {progression.kind === 'rating' ? <Body tone="muted">0.125, 0.25 or 0.5 for 1/8, 1/4, 1/2</Body> : null}
        </Row>
      ) : null}
      {progression.kind !== 'none' && progressPrintedHint(progress, nameOf) ? <Body tone="muted">{progressPrintedHint(progress, nameOf)}</Body> : null}

      {!hasContent ? <Body tone="danger">No content is loaded, so nothing can be chosen yet. Add a source under Content.</Body> : null}

      {/* How the character grows, and where a second class is taken: ahead of everything it opens. */}
      {progression.kind === 'level' ? (
        <>
          <Heading>{`${progressName ?? 'Level'}${classLevels?.classLevels ? ' and classes' : ''}`}</Heading>
          <ClassLevelsView
            {...(classLevels?.classLevels ? { stepId: classLevels.id, state: classLevels.classLevels } : {})}
            level={progress.value}
            bounds={{ min: progression.min, max: progression.max }}
            builder={builder}
            labelOf={labelOf}
            nameOf={nameOf}
            stats={kind.stats}
            pick={setRequest}
          />
        </>
      ) : null}

      <Heading>Your character</Heading>
      {steps.map((step) => {
        const chosen = [
          ...state.startOptions.filter((question) => question.stepId === step.id).map((question) => startOptionsSummary(question.chosen, nameOf)),
          ...picks.filter((pick) => pick.stepId === step.id).flatMap((pick) => pick.chosen.map(nameOf)),
        ];
        return (
          <Row key={step.id}>
            <Text style={[styles.stepLabel, { color: palette.text }]}>{step.label}</Text>
            {chosen.length ? <Text style={{ color: palette.text, flexShrink: 1 }}>{chosen.join(', ')}</Text> : null}
            <Tag label={stepStatus(step, stepLabel)} />
          </Row>
        );
      })}

      {/* Steps a system marks advanced are left out until this is on (ADR 0115); what was taken that way still shows. */}
      {state.advanced.steps.length > 0 ? (
        <>
          <Row>
            <Text style={[styles.stepLabel, { color: palette.text }]}>{ADVANCED_OPTIONS_LABEL}</Text>
            <Switch value={showAdvanced} onValueChange={onShowAdvanced} accessibilityLabel={ADVANCED_OPTIONS_LABEL} />
          </Row>
          <Body tone="muted">{advancedOptionsHint(state.advanced.steps)}</Body>
        </>
      ) : null}

      <Heading>Open decisions ({groups.required.length})</Heading>
      {buildDecisions.length === 0 ? <Body tone="muted">Nothing outstanding.</Body> : null}
      {buildDecisions.length > 0 && groups.required.length === 0 ? <Body tone="muted">{NOTHING_REQUIRED}</Body> : null}
      {groups.required.map(decisionCard)}
      {groups.optional.length > 0 ? (
        <>
          <Row>
            <Text style={[styles.stepLabel, { color: palette.text, flex: 1 }]}>{optionalDecisionsLabel(groups.optional.length)}</Text>
            <Button label={optionalOpen ? 'Hide' : 'Show'} kind="link" onPress={() => onOptionalOpen(!optionalOpen)} />
          </Row>
          {optionalOpen ? (
            <>
              <Body tone="muted">{OPTIONAL_DECISIONS_HINT}</Body>
              {groups.optional.map(decisionCard)}
            </>
          ) : null}
        </>
      ) : null}

      {buildPicks.length > 0 || state.startOptions.length > 0 ? (
        <>
          <Heading>Choices made</Heading>
          <Body tone="muted">Changing one rebuilds what followed from it; anything it opened that was answered is kept where the new choice offers it too.</Body>
          {state.startOptions.map((question) => (
            <Row key={question.stepId} style={[styles.settled, { borderColor: palette.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: palette.muted, fontSize: 13 }}>{question.label}</Text>
                <Text style={{ color: palette.text, fontSize: 15 }}>{startOptionsSummary(question.chosen, labelOf)}</Text>
              </View>
              <Button label={START_OPTIONS_CHANGE} kind="link" onPress={() => onStartOptions('change')} />
            </Row>
          ))}
          {buildPicks.map(pickRows)}
        </>
      ) : null}

      {/* The spells (ADR 0124): what is still to choose, what is chosen, how cantrips attack and what is prepared. */}
      {spellsApart ? (
        <>
          <Heading>{`${SPELL_DECISIONS_HEADING} (${spellGroups.required.length})`}</Heading>
          {content.spells.decisions.length === 0 ? <Body tone="muted">Every spell choice has an answer.</Body> : null}
          {spellGroups.required.map(decisionCard)}
          {spellGroups.optional.length > 0 ? (
            <Row>
              <Text style={[styles.stepLabel, { color: palette.text, flex: 1 }]}>{optionalDecisionsLabel(spellGroups.optional.length)}</Text>
              <Button label={optionalOpen ? 'Hide' : 'Show'} kind="link" onPress={() => onOptionalOpen(!optionalOpen)} />
            </Row>
          ) : null}
          {optionalOpen ? spellGroups.optional.map(decisionCard) : null}
          {content.spells.picks.length > 0 ? (
            <>
              <Heading>{SPELLS_CHOSEN_HEADING}</Heading>
              {content.spells.picks.map(pickRows)}
            </>
          ) : null}
        </>
      ) : null}

      {state.spellAttacks.rows.length ? (
        <>
          <Heading>{state.spellAttacks.label}</Heading>
          <SpellAttacksView state={state} builder={builder} pick={setRequest} />
        </>
      ) : null}

      {preparation.length > 0 && kind.preparation ? (
        <>
          <Heading>Prepared {kind.preparation.elementType.toLowerCase()}s</Heading>
          <PreparedView rows={preparation} builder={builder} noun={kind.preparation.elementType.toLowerCase()} pick={setRequest} />
        </>
      ) : null}

      {/* Not decisions: nothing is owed. What a held element gives, features of the user's own and what the user added,
          in the desktop's order (ADR 0086's second pass). */}
      <HolderGrantsView state={state} builder={builder} elements={elements} nameOf={nameOf} labelOf={labelOf} />

      {state.customFeatures.available ? (
        <>
          <Heading>{CUSTOM_FEATURES_HEADING}</Heading>
          <CustomFeaturesView state={state} builder={builder} pick={setRequest} />
        </>
      ) : null}

      {state.additions.available ? (
        <>
          <Heading>{ADDITIONS_HEADING}</Heading>
          <AdditionsView state={state} builder={builder} labelOf={labelOf} pick={setRequest} />
        </>
      ) : null}

      {settled.length > 0 ? (
        <>
          <Heading>Values already set</Heading>
          {settled.map((step) => (
            <Settled key={step.id} label={step.label}>
              {step.budget ? <BudgetView stepId={step.id} budget={step.budget} builder={builder} kind={kind} /> : null}
              {step.hitPoints ? <HitPointsView stepId={step.id} state={step.hitPoints} builder={builder} /> : null}
            </Settled>
          ))}
        </>
      ) : null}

      {publications.rows.length > 0 ? (
        <>
          <Heading>Books</Heading>
          <BooksView list={publications} builder={builder} />
        </>
      ) : null}

      {state.references.available ? (
        <>
          <Heading>{state.references.label}</Heading>
          <ReferencesView state={state} builder={builder} labelOf={labelOf} pick={setRequest} />
        </>
      ) : null}

      {state.freeform.available ? (
        <>
          <Heading>{state.freeform.label}</Heading>
          <FreeformView state={state} builder={builder} />
        </>
      ) : null}

      {declined.length > 0 ? (
        <>
          <Heading>Skipped</Heading>
          {declined.map((decision) => (
            <Row key={decision.id}>
              <Text style={{ flex: 1, color: palette.text }}>
                {decision.label}
                {decision.from ? <Text style={{ color: palette.muted }}> from {nameOf(decision.from)}</Text> : null}
              </Text>
              <Button label="Reconsider" kind="link" onPress={() => builder.reconsider(decision.id)} />
            </Row>
          ))}
        </>
      ) : null}

      {/* What the first class and the background started with, and the purse (ADR 0087). */}
      {state.startingEquipment?.sources.some((source) => source.status !== 'open') ? (
        <>
          <Heading>{STARTING_EQUIPMENT_HEADING}</Heading>
          <StartingSettledView state={state.startingEquipment} builder={builder} nameOf={nameOf} />
        </>
      ) : null}

      {/* The bag and the purse, edited at any point (ADR 0098). */}
      {state.inventory ? (
        <>
          <Heading>{INVENTORY_HEADING}</Heading>
          <InventoryView state={state.inventory} builder={builder} pick={setRequest} />
        </>
      ) : null}

      {state.withdrawn.length > 0 ? (
        <>
          <Heading>Not held</Heading>
          <Body tone="muted">
            Given to this character and ruled out by their own prerequisites: something the character has replaces them, or they need a rule it
            does not use. They come back when that changes.
          </Body>
          {state.withdrawn.map((row) => (
            <Body key={row.elementId}>
              {row.name} <Text style={{ color: palette.muted }}>from {row.grantedBy.join(', ')}</Text>
            </Body>
          ))}
        </>
      ) : null}

      {state.uncounted.length > 0 ? (
        <>
          <Heading>{UNCOUNTED_HEADING}</Heading>
          <Body tone="muted">{UNCOUNTED_HINT}</Body>
          {state.uncounted.map((row) =>
            row.items.map((item) => (
              <Row key={`${row.ruleKey}:${item.position}`} style={[styles.settled, { borderColor: palette.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: palette.muted, fontSize: 13 }}>{row.label}</Text>
                  <Text style={{ color: palette.text, fontSize: 15 }}>{item.name}</Text>
                  <Text style={{ color: palette.muted, fontSize: 13 }}>{row.note}</Text>
                </View>
                <Button label="Forget" kind="link" onPress={() => builder.forgetUncounted(row.ruleKey, item.position)} />
              </Row>
            )),
          )}
        </>
      ) : null}

      {state.derived.problems.length > 0 ? (
        <>
          <Heading>Problems</Heading>
          {state.derived.problems.map((problem, at) => (
            <Body key={at} tone={problem.level === 'error' ? 'danger' : 'muted'}>
              {problem.message}
            </Body>
          ))}
        </>
      ) : null}

      <Picker request={request} elements={elements} labelOf={labelOf} onClose={() => setRequest(null)} />
      <StartOptionsView
        open={startOptions !== null && state.startOptions.length > 0}
        beginning={startOptions === 'new'}
        questions={state.startOptions}
        builder={builder}
        labelOf={labelOf}
        onClose={() => onStartOptions(null)}
      />
    </View>
  );
});

/**
 * The name, written to the builder a moment after typing stops and when the field is left. A rename re-derives the
 * character, which on a phone is tens of milliseconds a time: once per keystroke it lags the keyboard.
 */
function NameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  return <DraftField value={name} onCommit={onCommit} label="Name" />;
}

/** A value already set, shown and changed behind one tap so the list stays short. */
function Settled({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Row>
        <Text style={{ flex: 1, fontWeight: '600' }}>{label}</Text>
        <Button label={open ? 'Done' : 'Edit'} kind="link" onPress={() => setOpen(!open)} />
      </Row>
      {open ? children : null}
    </Card>
  );
}

/**
 * A card that has just taken the top (ADR 0123): it fades in where the answered one was and takes no tap for a moment.
 * With reduced motion on, it is outlined instead, and nothing moves.
 */
function Arriving({ arrived, children }: { arrived: boolean; children: ReactNode }) {
  const palette = usePalette();
  const opacity = useRef(new Animated.Value(1)).current;
  const [still, setStill] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
  }, []);
  useEffect(() => {
    if (!arrived || still) return;
    opacity.setValue(0.15);
    Animated.timing(opacity, { toValue: 1, duration: ARRIVAL_GUARD_MS, useNativeDriver: true }).start();
  }, [arrived, still, opacity]);
  return (
    <Animated.View
      pointerEvents={arrived ? 'none' : 'auto'}
      style={[{ opacity }, arrived && still ? { borderWidth: 2, borderColor: palette.accent, borderRadius: 10 } : null]}
    >
      {children}
    </Animated.View>
  );
}

function DecisionView({
  decision,
  state,
  builder,
  nameOf,
  pick,
}: {
  decision: OpenDecision;
  state: BuilderState;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
  pick: (request: PickerRequest) => void;
}) {
  const palette = usePalette();
  const step = state.steps.find((candidate) => candidate.id === decision.stepId);
  let body: React.ReactNode;
  const startingSource = decision.kind === 'equipment' ? state.startingEquipment?.sources.find((source) => source.key === decision.id) : undefined;
  if (decision.kind === 'equipment') {
    body = startingSource ? (
      <StartingOptionsView source={startingSource} builder={builder} nameOf={nameOf} pick={pick} />
    ) : (
      <Body tone="danger">Incudo could not show this step. This is a bug in Incudo.</Body>
    );
  } else if (decision.kind === 'budget') {
    body = step?.budget ? (
      <>
        <BudgetView stepId={decision.stepId} budget={step.budget} builder={builder} kind={state.kind} />
        {/* Every score set: the card waits for this rather than vanishing with the last one (ADR 0123). */}
        {decision.remaining === 0 ? <Button label="Done" kind="primary" onPress={() => builder.confirmBudget(decision.stepId)} /> : null}
      </>
    ) : (
      <Body tone="danger">Incudo could not show this step. This is a bug in Incudo.</Body>
    );
  } else if (decision.kind === 'hitpoints') {
    body = step?.hitPoints ? (
      <HitPointsView stepId={decision.stepId} state={step.hitPoints} builder={builder} only={decision.hitPointLevel} />
    ) : (
      <Body tone="danger">Incudo could not show this step. This is a bug in Incudo.</Body>
    );
  } else if (decision.candidates.length > 0) {
    body = (
      <>
        {decision.multiple ? (
          <Body tone="muted">
            {state.kind.buildSteps.find((candidate) => candidate.id === decision.stepId)?.description ?? 'Add as many as apply, or skip this if none do.'}
          </Body>
        ) : null}
        <Button
          label={decision.multiple ? 'Add…' : 'Choose…'}
          kind="primary"
          // `choose` replaces the whole list, so a select filling one slot at a time sends what it holds plus the new one
          // (ADR 0032); `chosen` is empty for a pick, so this is "replace" there.
          onPress={() =>
            pick({
              title: decision.label,
              options: decision.candidates,
              notes: builder.overlapNotesFor(decision.id),
              warnings: builder.softNotesFor(decision.id),
              onPick: (id) => builder.choose(decision.id, [...decision.chosen, id]),
            })
          }
        />
      </>
    );
  } else if (decision.unresolved.length > 0) {
    body = <Body tone="muted">Incudo cannot yet work out which options this choice allows, so it offers none rather than the wrong ones.</Body>;
  } else {
    body = <Body tone="muted">No option in the loaded content matches this choice.</Body>;
  }
  return (
    <>
      <Row>
        <Text style={[styles.decisionLabel, { color: palette.text }]}>{decision.label}</Text>
        {decisionTags(decision).map((tag) => (
          <Tag key={tag} label={tag} />
        ))}
      </Row>
      {decision.from ? <Body tone="muted">from {nameOf(decision.from)}</Body> : null}
      {body}
      {!decision.blocking ? <Button label="Skip" kind="link" onPress={() => builder.decline(decision.id)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 10 },
  field: { gap: 4 },
  fieldLabel: { fontSize: 13 },
  stepLabel: { fontWeight: '600', minWidth: 90 },
  settled: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  decisionLabel: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
});
