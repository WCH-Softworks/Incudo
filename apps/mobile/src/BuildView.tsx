/**
 * A character's build on a phone — ROADMAP Phase 6's "Full build flow", ADR 0086.
 *
 * ADR 0017's shape, in one column: no current step and nothing to go back to. What is outstanding is `decisions`, each
 * answered where it is; what was answered is `picks`, each still changeable; the parts that are not elements (scores, hit
 * points, class levels, prepared lists, books) sit after them. A renderer of `BuilderState`: every word both shells say
 * is `build-view.ts`'s, every tap a builder method, and choosing an element is the full-screen `Picker`.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import type { ElementId, ElementIndex } from '@incudo/core';
import {
  candidateLabel,
  decisionTags,
  formatProgress,
  progressLabel,
  settledSteps,
  slotOptions,
  stepStatus,
  withSlot,
  withoutSlot,
  type BuilderState,
  type CharacterBuilder,
  type OpenDecision,
} from '@incudo/ui';

import { BooksView, BudgetView, ClassLevelsView, HitPointsView, NumberField, PreparedView } from './BuildParts.tsx';
import { Body, Button, Card, Heading, Row, Tag } from './controls.tsx';
import { Picker, type PickerRequest } from './Picker.tsx';
import { usePalette } from './theme.ts';

/**
 * Memoized: the screen around it renders on every progress report of a content load, and the build has not changed.
 */
export const BuildView = memo(function BuildView({
  builder,
  state,
  elements,
  hasContent,
}: {
  builder: CharacterBuilder;
  state: BuilderState;
  elements: ElementIndex;
  /** Whether any content is loaded: with none, a choice offers nothing, and the screen says why. */
  hasContent: boolean;
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

  return (
    <View style={styles.page}>
      <View style={styles.field}>
        <Text style={[styles.fieldLabel, { color: palette.muted }]}>Name</Text>
        <NameField name={state.character.name} onCommit={builder.setName} />
      </View>
      {progression.kind !== 'none' && progressName ? (
        <Row>
          <Text style={[styles.fieldLabel, { color: palette.muted }]}>{progressName}</Text>
          <NumberField
            value={progress.printable && !progress.recorded ? undefined : progress.value}
            placeholder={progress.printable && !progress.recorded ? formatProgress(progress.value) : undefined}
            label={progressName}
            onCommit={(value) => (value === undefined ? progress.printable && builder.setProgress(undefined) : builder.setProgress(value))}
          />
          {progression.kind === 'rating' ? <Body tone="muted">0.125, 0.25 or 0.5 for 1/8, 1/4, 1/2</Body> : null}
        </Row>
      ) : null}

      {!hasContent ? <Body tone="danger">No content is loaded, so nothing can be chosen yet. Add a source under Content.</Body> : null}

      <Heading>Your character</Heading>
      {steps.map((step) => {
        const chosen = picks.filter((pick) => pick.stepId === step.id).flatMap((pick) => pick.chosen.map(nameOf));
        return (
          <Row key={step.id}>
            <Text style={[styles.stepLabel, { color: palette.text }]}>{step.label}</Text>
            {chosen.length ? <Text style={{ color: palette.text, flexShrink: 1 }}>{chosen.join(', ')}</Text> : null}
            <Tag label={stepStatus(step, stepLabel)} />
          </Row>
        );
      })}

      <Heading>Open decisions ({decisions.length})</Heading>
      {decisions.length === 0 ? <Body tone="muted">Nothing outstanding.</Body> : null}
      {decisions.map((decision) => (
        <Card key={`${decision.kind}:${decision.id}`}>
          <DecisionView decision={decision} state={state} builder={builder} nameOf={nameOf} pick={setRequest} />
        </Card>
      ))}

      {picks.length > 0 ? (
        <>
          <Heading>Choices made</Heading>
          <Body tone="muted">Changing one rebuilds what followed from it; anything it opened that was answered is kept where the new choice offers it too.</Body>
          {picks.map((pick) =>
            pick.chosen.map((id, index) => (
              <Row key={`${pick.ruleKey}:${index}`} style={[styles.settled, { borderColor: palette.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: palette.muted, fontSize: 13 }}>{pick.label}</Text>
                  <Text style={{ color: palette.text, fontSize: 15 }}>{labelOf(id)}</Text>
                </View>
                <Button
                  label="Change"
                  kind="link"
                  onPress={() =>
                    setRequest({
                      title: pick.label,
                      options: slotOptions(pick, index),
                      current: id,
                      onPick: (next) => builder.choose(pick.ruleKey, withSlot(pick, index, next)),
                    })
                  }
                />
                {pick.multiple ? <Button label="Remove" kind="link" onPress={() => builder.choose(pick.ruleKey, withoutSlot(pick, index))} /> : null}
              </Row>
            )),
          )}
        </>
      ) : null}

      {classLevels?.classLevels ? (
        <>
          <Heading>Classes</Heading>
          <ClassLevelsView
            stepId={classLevels.id}
            state={classLevels.classLevels}
            builder={builder}
            labelOf={labelOf}
            nameOf={nameOf}
            stats={kind.stats}
            pick={setRequest}
          />
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

      {preparation.length > 0 && kind.preparation ? (
        <>
          <Heading>Prepared {kind.preparation.elementType.toLowerCase()}s</Heading>
          <PreparedView rows={preparation} builder={builder} noun={kind.preparation.elementType.toLowerCase()} pick={setRequest} />
        </>
      ) : null}

      {publications.rows.length > 0 ? (
        <>
          <Heading>Books</Heading>
          <BooksView list={publications} builder={builder} />
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
    </View>
  );
});

/**
 * The name, written to the builder a moment after typing stops and when the field is left. A rename re-derives the
 * character, which on a phone is tens of milliseconds a time: once per keystroke it lags the keyboard.
 */
function NameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const palette = usePalette();
  const [draft, setDraft] = useState(name);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setDraft(name), [name]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (value: string): void => {
    clearTimeout(timer.current);
    if (value !== name) onCommit(value);
  };
  return (
    <TextInput
      value={draft}
      onChangeText={(value) => {
        setDraft(value);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(value), 400);
      }}
      onBlur={() => commit(draft)}
      onSubmitEditing={() => commit(draft)}
      style={[styles.input, { color: palette.text, borderColor: palette.border }]}
      accessibilityLabel="Name"
    />
  );
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
  if (decision.kind === 'budget') {
    body = step?.budget ? (
      <BudgetView stepId={decision.stepId} budget={step.budget} builder={builder} kind={state.kind} />
    ) : (
      <Body tone="danger">Incudo could not show this step. This is a bug in Incudo.</Body>
    );
  } else if (decision.kind === 'hitpoints') {
    body = step?.hitPoints ? (
      <HitPointsView stepId={decision.stepId} state={step.hitPoints} builder={builder} />
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
          onPress={() => pick({ title: decision.label, options: decision.candidates, onPick: (id) => builder.choose(decision.id, [...decision.chosen, id]) })}
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
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 17 },
  stepLabel: { fontWeight: '600', minWidth: 90 },
  settled: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  decisionLabel: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
});
