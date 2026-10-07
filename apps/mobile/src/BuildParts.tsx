/**
 * The parts of a build that are not a list of elements, drawn for a phone: ability scores (a budget), hit points per
 * level, which class each level went to, prepared lists, and the books a character is offered.
 *
 * Each is a renderer of a state `packages/ui` already publishes (`BudgetState`, `HitPointState`, `ClassLevelState`,
 * `PreparationRow`, `PublicationList`) and every tap is a builder method, as on the desktop (`BudgetEditor.tsx`,
 * `HitPointEditor.tsx`, `ClassLevels.tsx`, `PreparedSpells.tsx`, `PublicationsEditor.tsx`). The words that both shells
 * say come from `build-view.ts`. Nothing here decides what a value costs, which class may be taken, or what is preparable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { ElementId, ResolvedCharacterKind, StatDef } from '@incudo/core';
import {
  LEVEL_HINT,
  LEVEL_UP_OTHER,
  levelControlView,
  SPLIT_HINT,
  SPLIT_INTERLEAVED,
  SPLIT_REFUSED,
  classOptionGroups,
  multiclassOffNote,
  currentSplit,
  movedSplitRow,
  splitDraftView,
  withAddedSplitRow,
  withSplitRow,
  withoutSplitRow,
  preparedItemText,
  scoreLabel,
  searchCandidates,
  shortfallText,
  unavailableReason,
  type BudgetRow,
  type BudgetState,
  type CharacterBuilder,
  type ClassLevelState,
  type ClassOption,
  type ClassSegment,
  type HitPointState,
  type PreparationRow,
  type PublicationList,
} from '@incudo/ui';

import { Body, Button, Card, Row, Tag } from './controls.tsx';
import type { PickerRequest } from './Picker.tsx';
import { usePalette } from './theme.ts';

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));

/** A whole number typed and kept when the field is left or submitted; an empty field hands back `undefined`. */
export function NumberField({
  value,
  placeholder,
  onCommit,
  label,
  width = 64,
}: {
  value: number | undefined;
  placeholder?: string;
  onCommit: (value: number | undefined) => void;
  label: string;
  width?: number;
}) {
  const palette = usePalette();
  const shown = value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = (): void => {
    if (draft === shown) return;
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (trimmed !== '' && !Number.isFinite(parsed)) return setDraft(shown);
    onCommit(trimmed === '' ? undefined : parsed);
  };
  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType="numeric"
      placeholder={placeholder ?? '—'}
      placeholderTextColor={palette.muted}
      accessibilityLabel={label}
      style={[styles.number, { width, color: palette.text, borderColor: palette.border }]}
    />
  );
}

/**
 * A line of text written to the builder a moment after typing stops and when the field is left: every write re-derives
 * the character. `multiline` for a description.
 */
export function DraftField({
  value: name,
  onCommit,
  label,
  multiline,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  multiline?: boolean;
  placeholder?: string;
}) {
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
      multiline={multiline}
      placeholder={placeholder}
      placeholderTextColor={palette.muted}
      style={[styles.text, multiline && styles.multiline, { color: palette.text, borderColor: palette.border }]}
      accessibilityLabel={label}
    />
  );
}

// --- ability scores ---------------------------------------------------------------------------------------------

export function BudgetView({
  stepId,
  budget,
  builder,
  kind,
}: {
  stepId: string;
  budget: BudgetState;
  builder: CharacterBuilder;
  kind: ResolvedCharacterKind;
}) {
  const palette = usePalette();
  const labelOf = (stat: string): string => scoreLabel(kind.stats, stat);
  const dice = budget.dice;
  return (
    <View style={styles.part}>
      {budget.methods.length > 1 ? (
        <Row>
          {budget.methods.map((method) => (
            <Button
              key={method.id}
              label={method.label ?? method.id}
              kind={budget.methodId === method.id ? 'primary' : 'plain'}
              onPress={() => builder.setGenerationMethod(stepId, method.id)}
            />
          ))}
        </Row>
      ) : null}
      {budget.methodId === undefined && budget.methods.length > 1 ? (
        <Body tone="muted">No method chosen, so any values may be typed. Point buy and the standard array clear the scores when picked.</Body>
      ) : null}
      {budget.pooled ? (
        <Body>
          {budget.remaining} of {budget.available} {labelOf(budget.stat).toLowerCase()} left
          {budget.granted > 0 ? `, ${budget.granted} of them from choices made` : ''}
        </Body>
      ) : null}
      {dice ? (
        dice.unreadable ? (
          <Body tone="danger">This method's dice cannot be read: {dice.unreadable}</Body>
        ) : (
          <Row>
            {dice.rolled < dice.count ? (
              <Button label={`Roll ${dice.count - dice.rolled} × ${dice.notation}`} onPress={() => builder.rollBudget(stepId)} />
            ) : null}
            {dice.rolled > 0 ? <Button label="Discard and roll again" onPress={() => builder.rerollBudget(stepId)} /> : null}
            <Body tone="muted">
              {dice.rolled} of {dice.count} rolled.
            </Body>
          </Row>
        )
      ) : null}
      {budget.mode === 'assignment' && budget.pool.length > 0 ? (
        <Row>
          {budget.pool.map((entry, at) => (
            <Tag key={at} label={entry.assignedTo ? `${entry.value} ${labelOf(entry.assignedTo)}` : String(entry.value)} />
          ))}
        </Row>
      ) : null}
      {budget.rows.map((row) => (
        <View key={row.stat} style={[styles.scoreRow, { borderColor: palette.border }]}>
          <View style={styles.scoreHead}>
            <Text style={[styles.scoreName, { color: palette.text }]}>{labelOf(row.stat)}</Text>
            <Text style={[styles.scoreTotal, { color: palette.text }]}>{row.total}</Text>
          </View>
          <Row>
            <Base stepId={stepId} budget={budget} row={row} builder={builder} label={labelOf(row.stat)} />
            {row.bonus !== 0 ? <Body tone="muted">{signed(row.bonus)} from elsewhere</Body> : null}
            {budget.pooled ? <Body tone="muted">cost {row.cost}</Body> : null}
          </Row>
          {row.featureNote ? <Body tone="muted">{row.featureNote}</Body> : null}
        </View>
      ))}
      <Body tone="muted">The large number is the total the sheet uses: the base set here plus what the rest of the character adds.</Body>
    </View>
  );
}

function Base({ stepId, budget, row, builder, label }: { stepId: string; budget: BudgetState; row: BudgetRow; builder: CharacterBuilder; label: string }) {
  const palette = usePalette();
  if (budget.mode === 'assignment') {
    // Every value in the pool, whoever holds it: choosing one another row holds swaps them (`planBudgetSet`).
    const values = [...new Set(budget.pool.map((entry) => entry.value))].sort((a, b) => b - a);
    return (
      <Row>
        {values.map((value) => (
          <Button
            key={value}
            label={String(value)}
            kind={row.base === value ? 'primary' : 'plain'}
            style={styles.small}
            onPress={() => builder.setBudgetStat(stepId, row.stat, row.base === value ? undefined : value)}
          />
        ))}
      </Row>
    );
  }
  if (budget.pooled) {
    return (
      <Row>
        <Button label="−" style={styles.small} disabled={!row.decrease} onPress={() => builder.adjustBudgetStat(stepId, row.stat, -1)} />
        <Text style={[styles.base, { color: palette.text }]}>{row.base ?? '—'}</Text>
        <Button label="+" style={styles.small} disabled={!row.increase?.affordable} onPress={() => builder.adjustBudgetStat(stepId, row.stat, +1)} />
      </Row>
    );
  }
  return (
    <NumberField
      value={row.base}
      placeholder={row.printed === undefined ? undefined : String(row.printed)}
      label={`${label} base`}
      onCommit={(value) => builder.setBudgetStat(stepId, row.stat, value)}
    />
  );
}

// --- hit points ---------------------------------------------------------------------------------------------------

export function HitPointsView({ stepId, state, builder }: { stepId: string; state: HitPointState; builder: CharacterBuilder }) {
  const palette = usePalette();
  if (state.fixed) {
    return (
      <View style={styles.part}>
        <Body>{state.levels.map((level) => `${level.fixedValue ?? '—'}`).join(' + ')} hit points</Body>
        <Body tone="muted">The average hit points option is on, so each level adds its die's average (the first level adds the maximum).</Body>
      </View>
    );
  }
  return (
    <View style={styles.part}>
      {state.levels.map((level) => (
        <View key={level.level} style={[styles.scoreRow, { borderColor: palette.border }]}>
          <View style={styles.scoreHead}>
            <Text style={[styles.scoreName, { color: palette.text }]}>
              Level {level.level}
              <Text style={{ color: palette.muted }}> {[level.className, level.dieSides ? `d${level.dieSides}` : undefined].filter(Boolean).join(' · ')}</Text>
            </Text>
            {level.isFirst || level.dieSides === undefined ? (
              <Text style={[styles.scoreTotal, { color: palette.text }]}>{level.recorded ?? '—'}</Text>
            ) : (
              <NumberField
                value={level.recorded}
                label={`Level ${level.level} hit points`}
                onCommit={(value) => value !== undefined && builder.changeHitPoints(stepId, level.level, { value })}
              />
            )}
          </View>
          {level.dieSides === undefined ? (
            level.unreadable ? <Body tone="muted">{level.unreadable}</Body> : null
          ) : level.isFirst ? (
            level.recorded === undefined ? (
              <Button label={`Record the maximum (${level.dieSides})`} onPress={() => builder.recordHitPoints(stepId, level.level, 'average')} />
            ) : (
              <Body tone="muted">Always the maximum</Body>
            )
          ) : (
            <Row>
              <Button label={level.recorded !== undefined ? 'Roll again' : 'Roll'} onPress={() => builder.changeHitPoints(stepId, level.level, 'roll')} />
              <Button label="Roll, rerolling 1s" onPress={() => builder.changeHitPoints(stepId, level.level, 'rollRerollOnes')} />
              <Button label={`Average (${level.average})`} onPress={() => builder.changeHitPoints(stepId, level.level, 'average')} />
            </Row>
          )}
        </View>
      ))}
      {state.reviewing && state.pending.length === 0 ? <Button label="Done" kind="primary" onPress={() => builder.confirmHitPoints(stepId)} /> : null}
    </View>
  );
}

// --- class levels ---------------------------------------------------------------------------------------------------

export function ClassLevelsView({
  stepId,
  state,
  level,
  bounds,
  builder,
  labelOf,
  nameOf,
  stats,
  pick,
}: {
  /** The class levels step and its state, when the kind has one; without them this only moves the level. */
  stepId?: string;
  state?: ClassLevelState;
  level: number;
  bounds: { min?: number; max?: number };
  builder: CharacterBuilder;
  labelOf: (id: ElementId) => string;
  nameOf: (id: ElementId) => string;
  stats: ReadonlyArray<StatDef>;
  pick: (request: PickerRequest) => void;
}) {
  const palette = usePalette();
  const [splitOpen, setSplitOpen] = useState(false);
  const classes = state?.firstClassId !== undefined ? state : undefined;
  const view = levelControlView(level, bounds, classes, nameOf);
  // The picker lists what may be chosen: the character's classes, then those it may add, each worded with any minimum it
  // falls short of. What it may not take is said below, not offered.
  const groups = classOptionGroups(classes?.options ?? []);
  const optionLabel = (option: ClassOption): string =>
    option.flag ? `${labelOf(option.id)} (needs ${shortfallText(option.flag, stats)})` : labelOf(option.id);
  const offer = (title: string, onPick: (id: ElementId) => void, current?: ElementId): void => {
    const options = [...groups.taken, ...groups.available];
    const labels = new Map(options.map((option) => [option.id, optionLabel(option)]));
    pick({ title, options: options.map((option) => option.id), onPick, labels, ...(current ? { current } : {}) });
  };
  const offNote = classes ? multiclassOffNote(classes, nameOf) : undefined;
  // Level up goes to the last level's class in one tap; any other class the character may take is one more, named.
  const other = groups.taken.length + groups.available.length > 1;
  const up = view.up;
  const down = view.down;

  return (
    <View style={styles.part}>
      <Row>
        <Text style={{ color: palette.text, fontSize: 15 }}>
          Level <Text style={{ fontSize: 24, fontWeight: '700' }}>{view.level}</Text>
        </Text>
        {view.summary ? <Text style={{ color: palette.text, fontWeight: '600', flexShrink: 1 }}>{view.summary}</Text> : null}
      </Row>
      <Row>
        {up ? (
          <Button
            label={classes && view.nextClass ? `${up.label} as ${nameOf(view.nextClass)}` : up.label}
            kind="primary"
            onPress={() =>
              stepId !== undefined && classes && view.nextClass ? builder.addLevel(stepId, view.nextClass) : builder.setProgress(up.level)
            }
          />
        ) : (
          <Body tone="muted">Highest level reached.</Body>
        )}
        {up && stepId !== undefined && classes && other ? (
          <Button label={LEVEL_UP_OTHER} onPress={() => offer(`Level ${up.level} goes to`, (id) => builder.addLevel(stepId, id), view.nextClass)} />
        ) : null}
      </Row>
      {down ? <Button label={down.label} kind="link" onPress={() => builder.setProgress(down.level)} /> : null}
      {state && !classes ? <Body tone="muted">Choose a class in Open decisions. Further levels can then go to other classes.</Body> : null}
      {classes && offNote ? <Body tone={classes.classes.length > 1 ? 'danger' : 'muted'}>{offNote}</Body> : null}
      {classes?.options
        .filter((option) => option.taken && option.flag)
        .map((option) => (
          <Body key={option.id} tone="muted">
            {nameOf(option.id)} usually needs {shortfallText(option.flag!, stats)}. It is allowed here, and this note goes away when the score is
            high enough.
          </Body>
        ))}
      {classes && classes.unassigned.length > 0 ? (
        <Body tone="danger">
          {classes.unassigned.length === 1
            ? `Level ${classes.unassigned[0]} has no class recorded.`
            : `Levels ${classes.unassigned.join(', ')} have no class recorded.`}
        </Body>
      ) : null}
      <Body tone="muted">{LEVEL_HINT}</Body>
      {classes && stepId !== undefined ? (
        <>
          <Row>
            <Button label={splitOpen ? 'Close the split' : 'Set the split'} onPress={() => setSplitOpen(!splitOpen)} />
          </Row>
          {splitOpen ? (
            <SplitEditor stepId={stepId} state={classes} builder={builder} labelOf={labelOf} offer={offer} onApplied={() => setSplitOpen(false)} />
          ) : null}
          {classes.levels.map((row) => (
            <Row key={row.level}>
              <Text style={{ minWidth: 64, fontWeight: '600' }}>Level {row.level}</Text>
              {row.first ? (
                <Body tone="muted">{row.classId ? `${nameOf(row.classId)} 1 · first class` : '—'}</Body>
              ) : (
                <>
                  <Body>{row.classId ? `${nameOf(row.classId)} ${row.classLevel}` : 'no class'}</Body>
                  <Button
                    label="Change"
                    kind="link"
                    onPress={() => offer(`Level ${row.level} goes to`, (id) => builder.setLevelClass(stepId, row.level, id), row.classId)}
                  />
                </>
              )}
            </Row>
          ))}
          {groups.unavailable.length > 0 ? (
            <Body tone="muted">
              Not available: {groups.unavailable.map((option) => `${labelOf(option.id)} (${unavailableReason(option, labelOf)})`).join('; ')}.
            </Body>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/**
 * The whole split as totals (ADR 0045), in place: a row per class in the order taken, its name a link to the picker, its
 * levels typed. The sum and whether Apply is offered are `splitDraftView`'s; whether the classes may be combined is
 * `applySplit`'s, which writes nothing when it says no.
 */
function SplitEditor({
  stepId,
  state,
  builder,
  labelOf,
  offer,
  onApplied,
}: {
  stepId: string;
  state: ClassLevelState;
  builder: CharacterBuilder;
  labelOf: (id: ElementId) => string;
  offer: (title: string, onPick: (id: ElementId) => void, current?: ElementId) => void;
  onApplied: () => void;
}) {
  const [rows, setRows] = useState<ClassSegment[] | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const draft = splitDraftView(state, rows ?? currentSplit(state));
  const shown = draft.rows;
  const edit = (next: ClassSegment[]): void => {
    setRows(next);
    setRefused(false);
  };
  return (
    <Card>
      <Body tone="muted">{SPLIT_HINT}</Body>
      {shown.map((row, index) => (
        <Row key={index}>
          <Button
            label={labelOf(row.classId)}
            kind="link"
            onPress={() => offer(index === 0 ? 'First class' : `Class ${index + 1}`, (id) => edit(withSplitRow(shown, index, { classId: id })), row.classId)}
          />
          <NumberField
            value={Number.isFinite(row.levels) ? row.levels : undefined}
            label={`Levels in class ${index + 1}`}
            width={56}
            onCommit={(levels) => edit(withSplitRow(shown, index, { levels: levels ?? Number.NaN }))}
          />
          <Button label="Up" kind="link" disabled={index === 0} onPress={() => edit(movedSplitRow(shown, index, -1))} />
          <Button label="Down" kind="link" disabled={index === shown.length - 1} onPress={() => edit(movedSplitRow(shown, index, 1))} />
          <Button label="Remove" kind="link" disabled={shown.length === 1} onPress={() => edit(withoutSplitRow(shown, index))} />
        </Row>
      ))}
      <Row>
        <Button label="Add a class" kind="link" onPress={() => edit(withAddedSplitRow(shown, state))} />
        <Body tone={draft.valid ? 'muted' : 'danger'}>{draft.totalText}</Body>
      </Row>
      <Button
        label="Apply"
        kind="primary"
        disabled={!draft.valid}
        onPress={() => {
          if (builder.applySplit(stepId, shown)) {
            setRows(undefined);
            onApplied();
          } else setRefused(true);
        }}
      />
      {refused ? <Body tone="danger">{SPLIT_REFUSED}</Body> : null}
      {state.interleaved ? <Body tone="muted">{SPLIT_INTERLEAVED}</Body> : null}
    </Card>
  );
}

// --- prepared lists -------------------------------------------------------------------------------------------------

export function PreparedView({
  rows,
  builder,
  noun,
  pick,
}: {
  rows: PreparationRow[];
  builder: CharacterBuilder;
  noun: string;
  pick: (request: PickerRequest) => void;
}) {
  return (
    <View style={styles.part}>
      {rows.map((row) => (
        <View key={row.key} style={styles.part}>
          {rows.length > 1 ? <Text style={{ fontWeight: '700' }}>{row.name}</Text> : null}
          <Body tone={row.over > 0 ? 'danger' : 'text'}>
            {row.count} of {row.limit} prepared{row.over > 0 ? `, ${row.over} over` : ''}
          </Body>
          {row.always.length > 0 ? <Body tone="muted">Always prepared: {row.always.map(preparedItemText).join(', ')}</Body> : null}
          {[...row.chosen, ...row.unavailable].map((item) => (
            <Row key={item.id}>
              <Body tone={row.unavailable.includes(item) ? 'muted' : 'text'}>{preparedItemText(item)}</Body>
              <Button label="Take off" kind="link" onPress={() => builder.unprepare(row.key, item.id)} />
            </Row>
          ))}
          <Button
            label={`Prepare a ${noun}…`}
            onPress={() => pick({ title: `Prepare for ${row.name}`, options: builder.preparationOptionsFor(row.key).map((item) => item.id), onPick: (id) => builder.prepare(row.key, id) })}
          />
        </View>
      ))}
    </View>
  );
}

// --- books --------------------------------------------------------------------------------------------------------------

export function BooksView({ list, builder }: { list: PublicationList; builder: CharacterBuilder }) {
  const palette = usePalette();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const options = useMemo(() => list.rows.map((row) => ({ id: row.name, label: row.name })), [list.rows]);
  const byName = new Map(list.rows.map((row) => [row.name, row]));
  const { matches } = searchCandidates(options, query);
  return (
    <View style={styles.part}>
      <Row>
        <Body>{list.everything ? 'Every book is offered' : `${list.offered} of ${list.rows.length} books offered`}</Body>
        <Button label={open ? 'Hide' : 'Choose'} kind="link" onPress={() => setOpen(!open)} />
      </Row>
      {open ? (
        <>
          <Body tone="muted">Only content from the books switched on is offered when choosing something new. What the character already has stays.</Body>
          <Row>
            <Button label="Offer every book" disabled={list.everything} onPress={() => builder.setPublications(undefined)} />
            <Button label="Offer none" disabled={list.offered === 0} onPress={() => builder.setPublications([])} />
          </Row>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${list.rows.length} books…`}
            placeholderTextColor={palette.muted}
            style={[styles.search, { color: palette.text, borderColor: palette.border }]}
          />
          {matches.map(({ id: name }) => {
            const row = byName.get(name)!;
            return (
              <Row key={name} style={styles.book}>
                <Switch value={row.offered} disabled={row.required} onValueChange={(on) => builder.offerPublication(name, on)} />
                <Text style={{ flex: 1, color: palette.text }}>{name}</Text>
                <Text style={{ color: palette.muted }}>{row.required ? 'always' : row.loaded ? `${row.elements}` : 'not loaded'}</Text>
              </Row>
            );
          })}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  part: { gap: 8 },
  number: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 16, textAlign: 'center' },
  scoreRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 6 },
  scoreHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  scoreName: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  scoreTotal: { fontSize: 22, fontWeight: '700' },
  base: { fontSize: 18, fontWeight: '700', minWidth: 28, textAlign: 'center' },
  small: { paddingVertical: 6, paddingHorizontal: 12 },
  search: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
  book: { flexWrap: 'nowrap' },
  text: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 17 },
  multiline: { fontSize: 15, minHeight: 64, textAlignVertical: 'top' },
});
