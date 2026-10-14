/**
 * The parts of a build that are not decisions — ADR 0086's second pass: what a held element gives (ADRs 0061, 0067),
 * features the user writes (ADRs 0063, 0065), elements added from loaded content whatever their prerequisites (ADR
 * 0064), text kept beside the character for reference (ADRs 0068, 0070), and what the user writes about it (ADR 0092).
 *
 * Renderers, as the desktop's `BuilderPane`, `CustomFeatures`, `Additions` and `References` are: what each part holds is
 * `BuilderState`'s, how it is grouped and worded is `packages/ui`'s, every tap a builder method, and choosing an element
 * or a stat is the full-screen `Picker`. Nothing here names a type or a stat.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import type { ElementId, ElementIndex, SpellAttackChoice } from '@incudo/core';
import {
  DIE_NONE,
  DIE_UNCHOSEN,
  dieLabel,
  givenBlockLabel,
  additionGroups,
  additionOptionLabel,
  ALL_ADDITION_TYPES,
  customFeaturesHint,
  customFeatureLines,
  customFeatureTypeChoices,
  customLineOnStat,
  customLineWithMode,
  customStatChoiceLabel,
  customMarkChoices,
  customStatMarkable,
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
import {
  FEATURE_LIBRARY_HEADING,
  FEATURE_LIBRARY_REMOVE_NOTE,
  featureLibraryView,
  libraryRemoveQuestion,
  type FeatureLinkView,
} from '@incudo/ui';

import { DraftField, NumberField } from './BuildParts.tsx';
import { Body, Button, Card, Heading, Row, Tag } from './controls.tsx';
import type { PickerRequest } from './Picker.tsx';
import { RichText } from './RichText.tsx';
import { usePalette } from './theme.ts';
import { usePlatform } from './context.ts';

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
  // The user's feature library (ADR 0106): read again whenever this part is shown, since a save elsewhere may change it.
  const { features: library } = usePlatform();
  const libraryState = useSyncExternalStore(library.subscribe, library.getState);
  useEffect(() => {
    void library.load();
  }, [library]);
  const view = featureLibraryView(libraryState, state.character);
  const [busy, setBusy] = useState(false);

  const saveToLibrary = async (featureId: string): Promise<void> => {
    const feature = state.character.customFeatures?.find((f) => f.id === featureId);
    if (!feature) return;
    setBusy(true);
    try {
      const link = await library.save(feature, state.character.systemId);
      if (link) builder.linkCustomFeature(featureId, link);
    } finally {
      setBusy(false);
    }
  };

  const removeFromLibrary = (id: string, name: string): void => {
    Alert.alert(libraryRemoveQuestion(name), FEATURE_LIBRARY_REMOVE_NOTE, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void library.remove(id).finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <View style={styles.part}>
      <Body tone="muted">{customFeaturesHint(state.customFeatures.stats)}</Body>
      {state.customFeatures.features.map((feature) => (
        <FeatureView
          key={feature.id}
          feature={feature}
          state={state}
          builder={builder}
          pick={pick}
          link={view.links.get(feature.id)}
          busy={busy}
          onSave={() => void saveToLibrary(feature.id)}
        />
      ))}
      <Button label="Add a feature" onPress={() => builder.addCustomFeature(NEW_CUSTOM_FEATURE_NAME)} />

      <Heading>{FEATURE_LIBRARY_HEADING}</Heading>
      {view.problem ? <Body tone="danger">{view.problem}</Body> : null}
      {view.message ? <Body tone="muted">{view.message}</Body> : null}
      {view.offers.map(({ entry, given }) => (
        <Card key={entry.id}>
          <Body>{entry.name.trim() || 'Unnamed feature'}</Body>
          <Row>
            {given ? (
              <Tag label="On this character" />
            ) : (
              <Button label="Give" disabled={busy} onPress={() => builder.giveLibraryFeature(entry)} />
            )}
            <Button label="Remove from library" kind="link" disabled={busy} onPress={() => removeFromLibrary(entry.id, entry.name)} />
          </Row>
        </Card>
      ))}
    </View>
  );
}

/**
 * One written feature: its name, where it is listed when there is a choice, its description, and its lines, each a
 * row of the stat (a tap opens the list of stats), Adds or Sets, the number, and Remove (the maintainer's choice). Where
 * the stat may be marked (an NPC's save or skill), Marked is a third button and the number is the mark, chosen from a list.
 */
function FeatureView({
  feature,
  state,
  builder,
  pick,
  link,
  busy,
  onSave,
}: {
  feature: CustomFeatureView;
  state: BuilderState;
  builder: CharacterBuilder;
  pick: (request: PickerRequest) => void;
  link: FeatureLinkView | undefined;
  busy: boolean;
  onSave: () => void;
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

  const chooseMark = (at: number): void => {
    const choices = customMarkChoices(stats, lines[at]!.stat);
    pick({
      title: 'Which mark',
      options: choices.map((_, count) => String(count)),
      labels: new Map(choices.map((choice, count) => [String(count), choice])),
      details: false,
      current: String(lines[at]!.value),
      onPick: (count) => change(at, { ...lines[at]!, value: Number(count) }),
    });
  };

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
      {link?.note ? <Body tone="muted">{link.note}</Body> : null}
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
            {customStatMarkable(stats, line.stat) ? (
              <Button
                label="Marked"
                kind={line.mode === 'mark' ? 'primary' : 'plain'}
                style={styles.small}
                onPress={() => change(at, customLineWithMode(lines[at]!, 'mark', stats))}
              />
            ) : null}
            {line.mode === 'mark' ? (
              <Button
                label={customMarkChoices(stats, line.stat)[line.value] ?? String(line.value)}
                kind="link"
                onPress={() => chooseMark(at)}
              />
            ) : (
              <NumberField
                value={line.value}
                label={`${line.label} value`}
                onCommit={(value) => value !== undefined && change(at, { ...lines[at]!, value })}
              />
            )}
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
      {link?.entry || link?.save ? (
        <Row>
          {link.entry ? (
            <Button label="Update from your feature library" kind="link" onPress={() => builder.updateFromLibrary(feature.id, link.entry!)} />
          ) : null}
          {link.save ? <Button label={link.save} kind="link" disabled={busy} onPress={onSave} /> : null}
        </Row>
      ) : null}
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

  // The block an added spell is cast through (ADR 0097): the blocks the character holds, and none. A recorded block it
  // no longer holds is shown and cannot be picked again.
  const NONE = ' none';
  const chooseBlock = (row: (typeof additions.rows)[number]): void => {
    const block = row.block!;
    const held = block.options.filter((option) => option.held);
    pick({
      title: block.label,
      options: [NONE, ...held.map((option) => option.key)],
      labels: new Map([[NONE, block.noneOption], ...held.map((option) => [option.key, option.label] as const)]),
      details: false,
      current: block.value || NONE,
      onPick: (key) => builder.setAdditionBlock(row.elementId, key === NONE ? undefined : key),
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
              {row.block ? (
                <Row>
                  <Text style={[styles.grow, { color: palette.text, fontSize: 14 }]}>
                    {row.block.label}: {row.block.options.find((option) => option.key === row.block!.value)?.label ?? row.block.noneOption}
                  </Text>
                  <Button label="Change" kind="link" onPress={() => chooseBlock(row)} />
                </Row>
              ) : null}
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

// --- what the user writes about the character (ADR 0092) ----------------------------------------------------------

/** Every field the kind declares, written or not; a field is committed as `DraftField` commits a name. */
export function FreeformView({ state, builder }: { state: BuilderState; builder: CharacterBuilder }) {
  const { freeform } = state;
  return (
    <View style={styles.part}>
      {freeform.description ? <Body tone="muted">{freeform.description}</Body> : null}
      {freeform.groups.map((group, at) => (
        <Card key={group.label ?? at}>
          {group.label !== undefined ? <Body>{group.label}</Body> : null}
          {group.fields.map((field) => (
            <View key={field.key}>
              <Body tone="muted">{field.label}</Body>
              <DraftField value={field.value || field.suggested || ''} label={field.label} multiline={field.multiline} onCommit={(value) => builder.setFreeform(field.key, value)} />
            </View>
          ))}
        </Card>
      ))}
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

/**
 * The spell attack rows and what content does not say about them (ADR 0111): the die, the damage type, the save's
 * ability, the class a spell is cast as, each a list in the Picker. What is offered and the row's line are
 * `packages/ui/src/spell-attacks.ts`'s.
 */
export function SpellAttacksView({ state, builder, pick }: { state: BuilderState; builder: CharacterBuilder; pick: (request: PickerRequest) => void }) {
  const palette = usePalette();
  const { spellAttacks } = state;
  const [refused, setRefused] = useState<{ id: string; message: string } | null>(null);
  const write = (id: string, choice: SpellAttackChoice): void => {
    const message = builder.setSpellAttack(id, choice);
    setRefused(message === undefined ? null : { id, message });
  };
  const UNSET = ' unset';
  const NONE = ' none';
  const list = (title: string, options: Array<[string, string]>, current: string, onPick: (key: string) => void): void =>
    pick({ title, options: options.map(([key]) => key), labels: new Map(options), details: false, current, onPick });
  return (
    <View style={styles.part}>
      <Body tone="muted">{spellAttacks.description}</Body>
      {spellAttacks.rows.map((row) => {
        const first = row.choice.sides?.[0];
        const dieText = row.choice.sides === undefined ? DIE_UNCHOSEN : first === undefined ? DIE_NONE : row.choice.sides.map(dieLabel).join(' or ');
        const sides: Array<[string, string]> = spellAttacks.sides.map((s) => [String(s), dieLabel(s)]);
        const without = <K extends keyof SpellAttackChoice>(key: K): SpellAttackChoice => {
          const { [key]: _gone, ...rest } = row.choice;
          return rest;
        };
        return (
          <Card key={row.elementId}>
            <Text style={{ color: palette.text, fontSize: 15 }}>{row.line}</Text>
            {!row.stated ? (
              <>
                <Row>
                  <Text style={[styles.grow, { color: palette.text, fontSize: 14 }]}>Die: {dieText}</Text>
                  <Button label="Change" kind="link" onPress={() => list('Die', [[UNSET, DIE_UNCHOSEN], [NONE, DIE_NONE], ...sides], row.choice.sides === undefined ? UNSET : first === undefined ? NONE : String(first), (key) => write(row.elementId, key === UNSET ? without('sides') : { ...row.choice, sides: key === NONE ? [] : [Number(key)] }))} />
                  {first !== undefined ? (
                    <Button label="Or" kind="link" onPress={() => list('Or another die', [[UNSET, 'no other die'], ...sides], row.choice.sides?.[1] !== undefined ? String(row.choice.sides[1]) : UNSET, (key) => write(row.elementId, { ...row.choice, sides: key === UNSET ? [first] : [first, Number(key)] }))} />
                  ) : null}
                </Row>
                {spellAttacks.damageTypes.length ? (
                  <Row>
                    <Text style={[styles.grow, { color: palette.text, fontSize: 14 }]}>Damage type: {row.choice.damageType ?? DIE_UNCHOSEN}</Text>
                    <Button label="Change" kind="link" onPress={() => list('Damage type', [[UNSET, DIE_UNCHOSEN], ...spellAttacks.damageTypes.map((t): [string, string] => [t, t])], row.choice.damageType ?? UNSET, (key) => write(row.elementId, key === UNSET ? without('damageType') : { ...row.choice, damageType: key }))} />
                  </Row>
                ) : null}
              </>
            ) : null}
            {row.kind === 'save' && spellAttacks.abilities.length ? (
              <Row>
                <Text style={[styles.grow, { color: palette.text, fontSize: 14 }]}>Saving throw: {row.choice.ability ?? DIE_UNCHOSEN}</Text>
                <Button label="Change" kind="link" onPress={() => list('Saving throw', [[UNSET, DIE_UNCHOSEN], ...spellAttacks.abilities.map((a): [string, string] => [a, a])], row.choice.ability ?? UNSET, (key) => write(row.elementId, key === UNSET ? without('ability') : { ...row.choice, ability: key }))} />
              </Row>
            ) : null}
            {spellAttacks.blocks.length ? (
              <Row>
                <Text style={[styles.grow, { color: palette.text, fontSize: 14 }]}>
                  Cast as: {spellAttacks.blocks.find((b) => b.key === row.choice.block)?.name ?? givenBlockLabel(row)}
                </Text>
                <Button label="Change" kind="link" onPress={() => list('Cast as', [[UNSET, givenBlockLabel(row)], ...spellAttacks.blocks.map((b): [string, string] => [b.key, b.name])], row.choice.block ?? UNSET, (key) => write(row.elementId, key === UNSET ? without('block') : { ...row.choice, block: key }))} />
              </Row>
            ) : null}
            {refused?.id === row.elementId ? <Body tone="muted">{refused.message}</Body> : null}
          </Card>
        );
      })}
    </View>
  );
}
