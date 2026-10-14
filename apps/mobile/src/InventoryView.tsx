/**
 * The bag and the purse on the phone (ADR 0098): what the character carries, where each item is, what it gives, and the
 * coins.
 *
 * A renderer of `InventoryState`, as the desktop's `InventoryEditor.tsx` is: every sentence and every rule is
 * `packages/ui/src/inventory.ts`'s and `money.ts`'s, and every change is a builder method that returns a sentence when
 * it was refused. Adding an item and attaching one open the shared picker; a unit is chosen by its buttons.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import type { ElementId } from '@incudo/core';
import {
  INVENTORY_HINT,
  TAKEN_ON_BUILD,
  TAKEN_ON_BUILD_HINT,
  type CharacterBuilder,
  type InventoryRow,
  type InventoryState,
  type PurseRow,
} from '@incudo/ui';

import { DraftField, NumberField } from './BuildParts.tsx';
import { Body, Button, Card, Row, Tag } from './controls.tsx';
import type { PickerRequest } from './Picker.tsx';
import { usePalette } from './theme.ts';

export function InventoryView({
  state,
  builder,
  pick,
}: {
  state: InventoryState;
  builder: CharacterBuilder;
  pick: (request: PickerRequest) => void;
}) {
  const [message, setMessage] = useState<string | undefined>(undefined);
  const say = (result: string | undefined): void => setMessage(result);

  const add = (buy: boolean): void => {
    // Asked of the builder only when the list is opened: it is every item loaded.
    const options = builder.inventoryOptionsFor();
    const groups = builder.inventoryGroupsFor();
    pick({
      title: buy ? 'Buy an item' : 'Add an item',
      options,
      ...(groups.length ? { groups } : {}),
      notes: new Map(options.map((id) => [id, builder.inventoryOptionNote(id)])),
      onPick: (id) => say(builder.addItem(id, buy)),
    });
  };

  return (
    <View style={{ gap: 8 }}>
      <Body tone="muted">{INVENTORY_HINT}</Body>
      {state.attunement ? <Body tone={state.attunement.over ? 'danger' : 'muted'}>{state.attunement.text}</Body> : null}
      {state.rows.length === 0 ? <Body tone="muted">The bag is empty.</Body> : null}
      {state.rows.map((row) => (
        <ItemCard key={row.instanceId} row={row} builder={builder} pick={pick} say={say} />
      ))}
      {state.canAdd ? (
        <Row>
          <Button label="Add an item" onPress={() => add(false)} />
          <Button label="Buy an item" onPress={() => add(true)} />
        </Row>
      ) : null}
      <PurseView state={state} builder={builder} say={say} />
      {state.taken.length > 0 ? (
        <Card>
          <Body>{TAKEN_ON_BUILD}</Body>
          <Body tone="muted">{TAKEN_ON_BUILD_HINT}</Body>
          {state.taken.map((row) => (
            <Body key={row.instanceId}>
              {row.name}
              {row.gives ? ` — ${row.gives}` : ''}
            </Body>
          ))}
        </Card>
      ) : null}
      {message ? <Body tone="danger">{message}</Body> : null}
    </View>
  );
}

function ItemCard({
  row,
  builder,
  pick,
  say,
}: {
  row: InventoryRow;
  builder: CharacterBuilder;
  pick: (request: PickerRequest) => void;
  say: (result: string | undefined) => void;
}) {
  const palette = usePalette();
  const [details, setDetails] = useState(false);
  return (
    <Card>
      <Row>
        <Text style={{ flex: 1, color: palette.text, fontSize: 15, fontWeight: '600' }}>{row.name}</Text>
        {row.equipped ? <Tag label="equipped" /> : null}
        {row.attunement?.attuned ? <Tag label="attuned" /> : null}
      </Row>
      {row.userName ? <Body tone="muted">{row.itemName}</Body> : null}
      <Body tone="muted">
        {row.where}
        {row.price ? ` · ${row.price}` : ''}
      </Body>
      {row.gives ? <Body>{row.gives}</Body> : null}
      {row.attunement?.note ? <Body tone="muted">{row.attunement.note}</Body> : null}
      {row.fromPackage ? <Body tone="muted">{row.fromPackage}</Body> : null}
      {row.adornment ? (
        <Row>
          <Body>With {row.adornment.name}</Body>
          <Button label="Detach" kind="link" onPress={() => say(builder.detachItem(row.instanceId))} />
        </Row>
      ) : null}
      <Row>
        <Body tone="muted">How many</Body>
        <NumberField
          value={row.quantity}
          label={`How many ${row.name}`}
          onCommit={(n) => say(builder.setItemQuantity(row.instanceId, n ?? row.quantity))}
        />
      </Row>
      <Row>
        <Button label={row.equipped ? 'Unequip' : 'Equip'} onPress={() => say(builder.equipItem(row.instanceId, !row.equipped))} />
        {row.attunement ? (
          <Button
            label={row.attunement.attuned ? 'End attunement' : 'Attune'}
            onPress={() => say(builder.attuneItem(row.instanceId, !row.attunement!.attuned))}
          />
        ) : null}
        <Button label="Remove" kind="link" onPress={() => say(builder.removeItem(row.instanceId))} />
      </Row>
      <Row>
        {row.canAdorn ? (
          <Button
            label="Attach a magic item…"
            kind="link"
            onPress={() =>
              pick({
                title: `Attach to ${row.name}`,
                options: builder.adornmentOptionsFor(row.instanceId),
                onPick: (id: ElementId) => say(builder.attachItem(row.instanceId, id)),
              })
            }
          />
        ) : null}
        {row.canOpen ? <Button label="Open into its contents" kind="link" onPress={() => say(builder.openItem(row.instanceId))} /> : null}
        <Button label={details ? 'Close name and notes' : 'Name and notes'} kind="link" onPress={() => setDetails(!details)} />
      </Row>
      {details ? (
        <>
          <Body tone="muted">Name</Body>
          <DraftField value={row.userName ?? ''} placeholder={row.itemName} label="Name" onCommit={(text) => say(builder.renameItem(row.instanceId, text))} />
          <Body tone="muted">Notes</Body>
          <DraftField value={row.notes ?? ''} label="Notes" multiline onCommit={(text) => say(builder.setItemNotes(row.instanceId, text))} />
        </>
      ) : row.notes ? (
        <Body>{row.notes}</Body>
      ) : null}
    </Card>
  );
}

/** The coins: each unit's count, typed; an amount spent or received; and an exchange the player asks for. */
function PurseView({ state, builder, say }: { state: InventoryState; builder: CharacterBuilder; say: (result: string | undefined) => void }) {
  const units = state.purse;
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState(units[0]?.unit ?? '');
  const [to, setTo] = useState(units[1]?.unit ?? units[0]?.unit ?? '');
  if (!units.length) return null;
  return (
    <Card>
      <Body>Money</Body>
      {state.purseNote ? <Body tone="muted">{state.purseNote}</Body> : null}
      {units.map((row) => (
        <Row key={row.unit}>
          <Body>{row.label}</Body>
          <NumberField value={row.count} label={row.label} onCommit={(n) => say(builder.setCoins(row.unit, n ?? 0))} />
        </Row>
      ))}
      <Row>
        <Body tone="muted">Amount</Body>
        <NumberField value={amount} label="Amount" onCommit={(n) => setAmount(n ?? 1)} />
      </Row>
      <UnitButtons units={units} value={unit} onChange={setUnit} />
      <Row>
        <Button label="Spend" onPress={() => say(builder.spendCoins(unit, amount))} />
        <Button label="Receive" onPress={() => say(builder.receiveCoins(unit, amount))} />
      </Row>
      <Body tone="muted">Exchange them for</Body>
      <UnitButtons units={units} value={to} onChange={setTo} />
      <Button label="Exchange" onPress={() => say(builder.exchangeCoins(unit, amount, to))} />
    </Card>
  );
}

function UnitButtons({ units, value, onChange }: { units: readonly PurseRow[]; value: string; onChange: (unit: string) => void }) {
  return (
    <Row>
      {units.map((row) => (
        <Button key={row.unit} label={row.label} kind={row.unit === value ? 'primary' : 'plain'} onPress={() => onChange(row.unit)} />
      ))}
    </Row>
  );
}
