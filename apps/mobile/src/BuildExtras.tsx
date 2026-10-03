/**
 * The parts of a build that are not decisions — ADR 0086's second pass: what a held element gives (ADRs 0061, 0067),
 * features the user writes (ADRs 0063, 0065), elements added from loaded content whatever their prerequisites (ADR
 * 0064), and text kept beside the character for reference (ADRs 0068, 0070).
 *
 * Renderers, as the desktop's `BuilderPane`, `CustomFeatures`, `Additions` and `References` are: what each part holds is
 * `BuilderState`'s, how it is grouped and worded is `packages/ui`'s, every tap a builder method, and choosing an element
 * or a stat is the full-screen `Picker`. Nothing here names a type or a stat.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ElementId, ElementIndex } from '@incudo/core';
import {
  additionGroups,
  additionOptionLabel,
  ALL_ADDITION_TYPES,
  CUSTOM_FEATURES_HINT,
  customFeatureLines,
  customFeatureTypeChoices,
  customLineOnStat,
  customLineWithMode,
  customStatChoiceLabel,
  customStatSettable,
  holderGrantSections,
  holderGrantsHeading,
  holderGrantsHint,
  holderGrantStatus,
  holderGrantsUnseenNote,
  htmlToBlocks,
  newCustomStatLine,
  NEW_CUSTOM_FEATURE_NAME,
  NO_ADDITION_OPTIONS,
  NO_REFERENCE_OPTIONS,
  PREREQUISITES_UNMET,
  referenceEntry,
  referenceSuggestionNote,
  REFERENCE_SUGGESTIONS_HINT,
  withCustomLine,
  withoutCustomLine,
  type BuilderState,
  type CharacterBuilder,
  type CustomFeatureView,
  type ReferenceRow,
} from '@incudo/ui';
import type { CustomStatLine } from '@incudo/core';

import { DraftField, NumberField } from './BuildParts.tsx';
import { Body, Button, Card, Heading, Row, Tag } from './controls.tsx';
import type { PickerRequest } from './Picker.tsx';
import { RichText } from './RichText.tsx';
import { usePalette } from './theme.ts';

// --- what a held element gives ----------------------------------------------------------------------------------

export function HolderGrantsView({
  state,
  builder,
  elements,
  nameOf,
  labelOf,
}: {
  state: BuilderState;
  builder: CharacterBuilder;
  elements: ElementIndex;
  nameOf: (id: ElementId) => string;
  labelOf: (id: ElementId) => string;
}) {
  const palette = usePalette();
  return (
    <>
      {holderGrantSections(state.holderGrants, (id) => elements.get(id) !== undefined).map(({ from, groups }) => (
        <View key={from} style={styles.part}>
          <Heading>{holderGrantsHeading(nameOf(from))}</Heading>
          <Body tone="muted">{holderGrantsHint(nameOf(from))}</Body>
          {groups.map((group) => (
            <Card key={group.label}>
              <Text style={[styles.groupLabel, { color: palette.text }]}>{group.label}</Text>
              {group.rows.map((grant) => {
                const status = holderGrantStatus(grant);
                return (
                  <Row key={grant.elementId} style={[styles.line, { borderColor: palette.border }]}>
                    <View style={styles.grow}>
                      <Text style={{ color: grant.removed ? palette.muted : palette.text, fontSize: 15 }}>{labelOf(grant.elementId)}</Text>
                      {status ? <Text style={{ color: palette.muted, fontSize: 13 }}>{status}</Text> : null}
                    </View>
                    {grant.removed ? (
                      <Button label="Give back" kind="link" onPress={() => builder.restoreGranted(grant.elementId)} />
                    ) : (
                      <Button label="Remove" kind="link" onPress={() => builder.removeGranted(grant.elementId)} />
                    )}
                  </Row>
                );
              })}
              {group.unseen > 0 ? <Body tone="muted">{holderGrantsUnseenNote(group.unseen)}</Body> : null}
            </Card>
          ))}
        </View>
      ))}
    </>
  );
}

// --- features the user writes -----------------------------------------------------------------------------------

export function CustomFeaturesView({
  state,
  builder,
  pick,
}: {
  state: BuilderState;
  builder: CharacterBuilder;
  pick: (request: PickerRequest) => void;
}) {
  return (
    <View style={styles.part}>
      <Body tone="muted">{CUSTOM_FEATURES_HINT}</Body>
      {state.customFeatures.features.map((feature) => (
        <FeatureView key={feature.id} feature={feature} state={state} builder={builder} pick={pick} />
      ))}
      <Button label="Add a feature" onPress={() => builder.addCustomFeature(NEW_CUSTOM_FEATURE_NAME)} />
    </View>
  );
}

/**
 * One written feature: its name, where it is listed when there is a choice, its description, and its lines, each a
 * row of the stat (a tap opens the list of stats), Adds or Sets, the number, and Remove (the maintainer's choice).
 */
function FeatureView({
  feature,
  state,
  builder,
  pick,
}: {
  feature: CustomFeatureView;
  state: BuilderState;
  builder: CharacterBuilder;
  pick: (request: PickerRequest) => void;
}) {
  const palette = usePalette();
  const { stats } = state.customFeatures;
  const lines = customFeatureLines(feature);
  const write = (next: CustomStatLine[]): void => builder.updateCustomFeature(feature.id, { stats: next });
  const change = (at: number, line: CustomStatLine): void => write(withCustomLine(lines, at, line));
  const typeChoices = customFeatureTypeChoices(state.customFeatures, feature);
  const statLabels = new Map(stats.map((s) => [s.stat, customStatChoiceLabel(s)]));

  const chooseStat = (at: number): void =>
    pick({
      title: 'Which number',
      options: stats.map((s) => s.stat),
      labels: statLabels,
      details: false,
      current: lines[at]!.stat,
      onPick: (stat) => change(at, customLineOnStat(lines[at]!, stat, stats, state.derived)),
    });

  return (
    <Card>
      <DraftField value={feature.name} label="Name" onCommit={(name) => builder.updateCustomFeature(feature.id, { name })} />
      {typeChoices.length > 0 ? (
        <>
          <Text style={{ color: palette.muted, fontSize: 13 }}>Listed under</Text>
          <Row>
            {typeChoices.map((choice) => (
              <Button
                key={choice.type}
                label={choice.label}
                kind={choice.type === feature.type ? 'primary' : 'plain'}
                style={styles.small}
                onPress={() => builder.updateCustomFeature(feature.id, { type: choice.type })}
              />
            ))}
          </Row>
        </>
      ) : null}
      {feature.typeNote ? <Body tone="danger">{feature.typeNote}</Body> : null}
      <DraftField
        value={feature.description}
        label="Description"
        multiline
        placeholder="Optional. Why this character has it."
        onCommit={(description) => builder.updateCustomFeature(feature.id, { description })}
      />

      {feature.lines.map((line, at) => (
        <View key={at} style={[styles.line, { borderColor: palette.border }]}>
          <Row>
            <Button
              label={line.status === 'unknown' ? line.label : (statLabels.get(line.stat) ?? line.label)}
              kind="link"
              style={styles.grow}
              onPress={() => chooseStat(at)}
            />
            <Button
              label="Adds"
              kind={line.mode === 'add' ? 'primary' : 'plain'}
              style={styles.small}
              onPress={() => change(at, customLineWithMode(lines[at]!, 'add', stats))}
            />
            <Button
              label="Sets"
              kind={line.mode === 'set' ? 'primary' : 'plain'}
              style={styles.small}
              disabled={!customStatSettable(stats, line.stat)}
              onPress={() => change(at, customLineWithMode(lines[at]!, 'set', stats))}
            />
            <NumberField
              value={line.value}
              label={`${line.label} value`}
              onCommit={(value) => value !== undefined && change(at, { ...lines[at]!, value })}
            />
            <Button label="Remove" kind="link" onPress={() => write(withoutCustomLine(lines, at))} />
          </Row>
          {line.note ? <Body tone="muted">{line.note}</Body> : null}
        </View>
      ))}

      <Row>
        <Button
          label="Add a line"
          kind="link"
          disabled={!stats.length}
          onPress={() => {
            const line = newCustomStatLine(stats, state.derived);
            if (line) write([...lines, line]);
          }}
        />
        <Button label="Remove feature" kind="link" onPress={() => builder.removeCustomFeature(feature.id)} />
      </Row>
    </Card>
  );
}

// --- added from loaded content ----------------------------------------------------------------------------------

export function AdditionsView({
  state,
  builder,
  labelOf,
  pick,
}: {
  state: BuilderState;
  builder: CharacterBuilder;
  labelOf: (id: ElementId) => string;
  pick: (request: PickerRequest) => void;
}) {
  const palette = usePalette();
  const { additions } = state;
  const [empty, setEmpty] = useState<string | null>(null);

  // Asked of the builder only when a list is opened: it is every element of the type.
  const offer = (type: string | undefined, title: string): void => {
    const options = builder.additionOptionsFor(type);
    if (!options.length) return setEmpty(title);
    setEmpty(null);
    pick({
      title,
      options: options.map((option) => option.elementId),
      labels: new Map(options.map((option) => [option.elementId, additionOptionLabel(labelOf(option.elementId), option)])),
      onPick: (id) => builder.addElement(id),
    });
  };

  return (
    <View style={styles.part}>
      {additions.description ? <Body tone="muted">{additions.description}</Body> : null}
      {additionGroups(additions).map((group) => (
        <Card key={group.label}>
          <Text style={[styles.groupLabel, { color: palette.text }]}>{group.label}</Text>
          {group.rows.map((row) => (
            <View key={row.elementId} style={[styles.line, { borderColor: palette.border }]}>
              <Row>
                <Text style={[styles.grow, { color: row.held ? palette.text : palette.muted, fontSize: 15 }]}>
                  {row.known ? labelOf(row.elementId) : row.name}
                </Text>
                {!row.prerequisitesMet ? <Tag label={PREREQUISITES_UNMET} /> : null}
                <Button label="Remove" kind="link" onPress={() => builder.removeAddition(row.elementId)} />
              </Row>
              {row.note ? <Body tone="muted">{row.note}</Body> : null}
            </View>
          ))}
        </Card>
      ))}
      <Text style={{ color: palette.muted, fontSize: 13 }}>Add from your content</Text>
      <Row>
        {additions.types.map((type) => (
          <Button key={type.type} label={type.label} style={styles.small} onPress={() => offer(type.type, type.label)} />
        ))}
        {additions.types.length > 1 ? (
          <Button label={ALL_ADDITION_TYPES} style={styles.small} onPress={() => offer(undefined, ALL_ADDITION_TYPES)} />
        ) : null}
      </Row>
      {empty ? (
        <Body tone="muted">
          {empty}: {NO_ADDITION_OPTIONS}
        </Body>
      ) : null}
    </View>
  );
}

// --- kept for reference -----------------------------------------------------------------------------------------

export function ReferencesView({
  state,
  builder,
  labelOf,
  pick,
}: {
  state: BuilderState;
  builder: CharacterBuilder;
  labelOf: (id: ElementId) => string;
  pick: (request: PickerRequest) => void;
}) {
  const palette = usePalette();
  const { references } = state;
  const [empty, setEmpty] = useState(false);

  const choose = (): void => {
    // Asked of the builder only when the list is opened.
    const options = builder.referenceOptionsFor();
    setEmpty(options.length === 0);
    if (options.length) pick({ title: references.label, options, onPick: (id) => builder.addReference(id) });
  };

  return (
    <View style={styles.part}>
      {references.description ? <Body tone="muted">{references.description}</Body> : null}
      {references.rows.map((row) => (
        <KeptReference key={row.elementId} row={row} label={row.known ? labelOf(row.elementId) : row.name} onRemove={() => builder.removeReference(row.elementId)} />
      ))}
      {references.suggestions.length > 0 ? (
        <Card>
          <Body tone="muted">{REFERENCE_SUGGESTIONS_HINT}</Body>
          {references.suggestions.map((suggestion) => (
            <Row key={suggestion.elementId} style={[styles.line, { borderColor: palette.border }]}>
              <View style={styles.grow}>
                <Text style={{ color: palette.text, fontSize: 15 }}>{labelOf(suggestion.elementId)}</Text>
                <Text style={{ color: palette.muted, fontSize: 13 }}>{referenceSuggestionNote(suggestion)}</Text>
              </View>
              <Button label="Keep" kind="link" onPress={() => builder.addReference(suggestion.elementId)} />
            </Row>
          ))}
        </Card>
      ) : null}
      <Button label="Choose from your content" onPress={choose} />
      {empty ? <Body tone="muted">{NO_REFERENCE_OPTIONS}</Body> : null}
    </View>
  );
}

/** A kept element, its text behind one tap: a stat block is a screen or more of text. */
function KeptReference({ row, label, onRemove }: { row: ReferenceRow; label: string; onRemove: () => void }) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const entry = referenceEntry(row);
  return (
    <Card>
      <Row>
        <Text style={[styles.grow, { color: palette.text, fontSize: 15, fontWeight: '600' }]}>{label}</Text>
        {entry.html ? <Button label={open ? 'Hide' : 'Show'} kind="link" onPress={() => setOpen(!open)} /> : null}
        <Button label="Remove" kind="link" onPress={onRemove} />
      </Row>
      {entry.html ? (open ? <RichText blocks={htmlToBlocks(entry.html)} /> : null) : <Body tone="muted">{entry.note}</Body>}
    </Card>
  );
}

const styles = StyleSheet.create({
  part: { gap: 10 },
  groupLabel: { fontSize: 15, fontWeight: '700' },
  line: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, gap: 4 },
  grow: { flex: 1, minWidth: 120 },
  small: { paddingVertical: 6, paddingHorizontal: 12 },
});
