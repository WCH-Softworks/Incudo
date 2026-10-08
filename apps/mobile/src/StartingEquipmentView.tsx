/**
 * The starting equipment step on the phone (ADR 0087): an open source's options, and what was taken with the purse.
 *
 * A renderer of `StartingEquipmentState`, as the desktop's `StartingEquipment.tsx` is: what each option gives, what it
 * still owes and whether a package can be taken back are `packages/ui/src/starting-equipment.ts`'s, and every sentence
 * is its. A choice's bundles are buttons, one marked; a pick's slot opens the shared picker.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import type { ElementId } from '@incudo/core';
import {
  purseLine,
  startingMissingNote,
  startingOwedNote,
  STARTING_EQUIPMENT_HINT,
  STARTING_UNLISTED,
  type CharacterBuilder,
  type StartingEquipmentState,
  type StartingOptionView,
  type StartingSource,
} from '@incudo/ui';

import { Body, Button, Card, Row, Tag } from './controls.tsx';
import type { PickerRequest } from './Picker.tsx';
import { usePalette } from './theme.ts';

export function StartingOptionsView({
  source,
  builder,
  nameOf,
  pick,
}: {
  source: StartingSource;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
  pick: (request: PickerRequest) => void;
}) {
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const forId = source.forId!;
  return (
    <>
      <Body tone="muted">{STARTING_EQUIPMENT_HINT}</Body>
      {source.options.map((option) => (
        <OptionCard
          key={option.id}
          forId={forId}
          option={option}
          builder={builder}
          nameOf={nameOf}
          pick={pick}
          onTake={() => setRefusal(builder.takeStartingOption(forId, option.id))}
        />
      ))}
      {refusal ? <Body tone="danger">{refusal}</Body> : null}
    </>
  );
}

function OptionCard({
  forId,
  option,
  builder,
  nameOf,
  pick,
  onTake,
}: {
  forId: ElementId;
  option: StartingOptionView;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
  pick: (request: PickerRequest) => void;
  onTake: () => void;
}) {
  const palette = usePalette();
  return (
    <View style={{ borderColor: palette.border, borderWidth: 1, borderRadius: 8, padding: 10, gap: 6 }}>
      <Text style={{ color: palette.text, fontWeight: '700' }}>{option.label}</Text>
      {option.lines.map((line) => (
        <View key={line.key} style={{ gap: 4 }}>
          {line.kind === 'items' ? (
            line.text ? <Body>{line.text}</Body> : null
          ) : (
            line.alternatives.map((alternative) => (
              <Button
                key={alternative.index}
                label={`${line.chosen === alternative.index ? '● ' : '○ '}${alternative.text}`}
                kind="link"
                onPress={() => builder.chooseStartingAlternative(forId, option.id, line.key, alternative.index)}
              />
            ))
          )}
          {line.picks.map((p) =>
            p.chosen.map((chosen, slot) => (
              <Button
                key={`${p.key}:${slot}`}
                label={chosen ? nameOf(chosen) : `${p.label}${p.count > 1 ? ` (${slot + 1} of ${p.count})` : ''}…`}
                kind="plain"
                onPress={() =>
                  pick({
                    title: p.label,
                    options: p.candidates,
                    ...(chosen ? { current: chosen } : {}),
                    onPick: (id) => builder.pickStartingItem(forId, option.id, p.key, slot, id),
                  })
                }
              />
            )),
          )}
        </View>
      ))}
      {option.coins ? <Body>{option.coins}</Body> : null}
      {option.wealth ? (
        <Body>
          {option.wealth.text}
          {option.wealth.amount !== undefined ? ` (rolled ${option.wealth.rolled}: ${option.wealth.amount})` : ''}
        </Body>
      ) : null}
      {option.unlisted.length ? <Body tone="muted">{`${STARTING_UNLISTED} ${option.unlisted.join('; ')}.`}</Body> : null}
      {option.missing.length ? <Body tone="muted">{startingMissingNote(option.missing.length)}</Body> : null}
      <Row>
        <Button
          label={option.wealth && option.wealth.rolled === undefined ? 'Roll and take' : 'Take'}
          kind="primary"
          disabled={!option.ready}
          onPress={onTake}
        />
        {option.owed > 0 ? <Tag label={startingOwedNote(option.owed)} /> : null}
      </Row>
    </View>
  );
}

/** What was taken for each source, what has nothing written, and the purse. */
export function StartingSettledView({
  state,
  builder,
  nameOf,
}: {
  state: StartingEquipmentState;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
}) {
  return (
    <>
      {state.sources
        .filter((source) => source.status !== 'open')
        .map((source) => (
          <Card key={source.key}>
            <Row>
              <Text style={{ flex: 1, fontWeight: '600' }}>{source.forId ? nameOf(source.forId) : source.stepLabel}</Text>
              {source.taken?.canReturn ? <Button label="Take back" kind="link" onPress={() => builder.returnStartingOption(source.forId!)} /> : null}
            </Row>
            {source.note ? <Body tone="muted">{source.note}</Body> : null}
            {source.taken?.entries.map((entry, at) => <Body key={at}>{entry}</Body>)}
            {source.taken?.coins ? (
              <Body>{`${source.taken.coins}${source.taken.rolled !== undefined ? ` (rolled ${source.taken.rolled})` : ''}`}</Body>
            ) : null}
          </Card>
        ))}
      {state.purse.length ? <Body>{`Money: ${purseLine(state.purse)}`}</Body> : null}
    </>
  );
}
