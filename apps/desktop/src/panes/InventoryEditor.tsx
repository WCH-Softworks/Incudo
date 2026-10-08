/**
 * The bag and the purse, edited at any point (ADR 0098): what the character carries, where each item is, what it gives,
 * and the coins.
 *
 * Everything shown is `InventoryState`'s, worked out in `packages/ui/src/inventory.ts` and `money.ts`; every change is a
 * builder method that returns a sentence when it was refused. This renders it and computes nothing; what it holds is
 * the text being typed into a name, notes or an amount until it is committed, which picker is open, and the last
 * sentence a change returned.
 */

import { useEffect, useMemo, useState } from 'react';
import type { ElementId, ElementIndex } from '@incudo/core';
import {
  INVENTORY_HINT,
  TAKEN_ON_BUILD,
  TAKEN_ON_BUILD_HINT,
  type CharacterBuilder,
  type InventoryRow,
  type InventoryState,
  type PurseRow,
} from '@incudo/ui';

import { CandidatePicker } from './CandidatePicker.tsx';

export function InventoryEditor({
  state,
  builder,
  elements,
  candidateLabel,
}: {
  state: InventoryState;
  builder: CharacterBuilder;
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
}): React.JSX.Element {
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  // Asked of the builder only while the picker is open: it is every item loaded.
  const options = useMemo(() => (adding ? builder.inventoryOptionsFor() : []), [adding, builder]);
  const notes = useMemo(() => new Map(options.map((id) => [id, builder.inventoryOptionNote(id)])), [options, builder]);
  const say = (result: string | undefined): void => setMessage(result);

  return (
    <div className="inventory">
      <p className="hint">{INVENTORY_HINT}</p>
      {state.attunement && <p className={state.attunement.over ? 'hint error' : 'hint'}>{state.attunement.text}</p>}

      {state.rows.length === 0 && <p className="hint">The bag is empty.</p>}
      <ul className="inventory-rows">
        {state.rows.map((row) => (
          <InventoryItem key={row.instanceId} row={row} builder={builder} elements={elements} candidateLabel={candidateLabel} say={say} />
        ))}
      </ul>

      {state.canAdd &&
        (adding ? (
          <div className="settled">
            <div className="decision-head">
              <label>
                <input type="checkbox" checked={paying} onChange={(event) => setPaying(event.target.checked)} /> Pay the price
                from the purse
              </label>
              <button type="button" className="link" onClick={() => setAdding(false)}>
                Done
              </button>
            </div>
            <CandidatePicker
              candidates={options}
              elements={elements}
              candidateLabel={candidateLabel}
              notes={notes}
              onSelect={(id) => say(builder.addItem(id, paying))}
            />
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)}>
            Add an item
          </button>
        ))}

      <Purse state={state} builder={builder} say={say} />

      {state.taken.length > 0 && (
        <div className="settled">
          <div className="decision-head">
            <span className="label">{TAKEN_ON_BUILD}</span>
          </div>
          <p className="hint">{TAKEN_ON_BUILD_HINT}</p>
          <ul className="inventory-taken">
            {state.taken.map((row) => (
              <li key={row.instanceId}>
                {row.name}
                {row.gives && <span className="hint"> — {row.gives}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && <p className="hint error">{message}</p>}
    </div>
  );
}

function InventoryItem({
  row,
  builder,
  elements,
  candidateLabel,
  say,
}: {
  row: InventoryRow;
  builder: CharacterBuilder;
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
  say: (result: string | undefined) => void;
}): React.JSX.Element {
  const [attaching, setAttaching] = useState(false);
  const [details, setDetails] = useState(false);
  const adornments = useMemo(() => (attaching ? builder.adornmentOptionsFor(row.instanceId) : []), [attaching, builder, row.instanceId]);
  return (
    <li className={row.missing ? 'inventory-row not-held' : 'inventory-row'}>
      <div className="decision-head">
        <strong>{row.name}</strong>
        {row.userName && <span className="hint">{row.itemName}</span>}
        <span className="inventory-controls">
          <label>
            How many{' '}
            <CommittedNumber value={row.quantity} min={1} onCommit={(n) => say(builder.setItemQuantity(row.instanceId, n))} />
          </label>
          <label>
            <input type="checkbox" checked={row.equipped} onChange={(event) => say(builder.equipItem(row.instanceId, event.target.checked))} />{' '}
            Equipped
          </label>
          {row.attunement && (
            <label>
              <input
                type="checkbox"
                checked={row.attunement.attuned}
                onChange={(event) => say(builder.attuneItem(row.instanceId, event.target.checked))}
              />{' '}
              Attuned
            </label>
          )}
          <button type="button" className="link" onClick={() => say(builder.removeItem(row.instanceId))}>
            Remove
          </button>
        </span>
      </div>
      <p className="hint">
        {row.where}
        {row.price && ` · ${row.price}`}
      </p>
      {row.gives && <p className="inventory-gives">{row.gives}</p>}
      {row.attunement?.note && <p className="hint">{row.attunement.note}</p>}
      {row.fromPackage && <p className="hint">{row.fromPackage}</p>}
      {row.adornment && (
        <p>
          With {row.adornment.name}{' '}
          <button type="button" className="link" onClick={() => say(builder.detachItem(row.instanceId))}>
            Detach
          </button>
        </p>
      )}
      <div className="inventory-actions">
        {row.canAdorn && (
          <button type="button" className="link" onClick={() => setAttaching(!attaching)}>
            {attaching ? 'Close' : 'Attach a magic item…'}
          </button>
        )}
        {row.canOpen && (
          <button type="button" className="link" onClick={() => say(builder.openItem(row.instanceId))}>
            Open into its contents
          </button>
        )}
        <button type="button" className="link" onClick={() => setDetails(!details)}>
          {details ? 'Close name and notes' : 'Name and notes'}
        </button>
      </div>
      {attaching && (
        <CandidatePicker
          candidates={adornments}
          elements={elements}
          candidateLabel={candidateLabel}
          onSelect={(id) => {
            say(builder.attachItem(row.instanceId, id));
            setAttaching(false);
          }}
        />
      )}
      {details && (
        <div className="inventory-details">
          <label>
            Name <CommittedText value={row.userName ?? ''} placeholder={row.itemName} onCommit={(text) => say(builder.renameItem(row.instanceId, text))} />
          </label>
          <label>
            Notes <CommittedText multiline value={row.notes ?? ''} onCommit={(text) => say(builder.setItemNotes(row.instanceId, text))} />
          </label>
        </div>
      )}
      {!details && row.notes && <p className="sheet-text">{row.notes}</p>}
    </li>
  );
}

/** The coins: each unit's count, typed; an amount spent or received; and an exchange the player asks for. */
function Purse({ state, builder, say }: { state: InventoryState; builder: CharacterBuilder; say: (result: string | undefined) => void }): React.JSX.Element | null {
  const units = state.purse;
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState(units[0]?.unit ?? '');
  const [from, setFrom] = useState(units[0]?.unit ?? '');
  const [to, setTo] = useState(units[1]?.unit ?? units[0]?.unit ?? '');
  if (!units.length) return null;
  const count = Number(amount);
  return (
    <div className="settled inventory-purse">
      <div className="decision-head">
        <span className="label">Money</span>
      </div>
      {state.purseNote && <p className="hint">{state.purseNote}</p>}
      <div className="inventory-coins">
        {units.map((row: PurseRow) => (
          <label key={row.unit}>
            {row.label}{' '}
            <CommittedNumber value={row.count} min={0} onCommit={(n) => say(builder.setCoins(row.unit, n))} />
          </label>
        ))}
      </div>
      <div className="inventory-coins">
        <input type="number" min={1} step={1} value={amount} aria-label="Amount" onChange={(event) => setAmount(event.target.value)} />
        <UnitSelect units={units} value={unit} onChange={setUnit} label="Coin" />
        <button type="button" onClick={() => say(builder.spendCoins(unit, count))}>
          Spend
        </button>
        <button type="button" onClick={() => say(builder.receiveCoins(unit, count))}>
          Receive
        </button>
      </div>
      <div className="inventory-coins">
        <span>Exchange</span>
        <input type="number" min={1} step={1} value={amount} aria-label="Amount to exchange" onChange={(event) => setAmount(event.target.value)} />
        <UnitSelect units={units} value={from} onChange={setFrom} label="Coins given" />
        <span>for</span>
        <UnitSelect units={units} value={to} onChange={setTo} label="Coins received" />
        <button type="button" onClick={() => say(builder.exchangeCoins(from, count, to))}>
          Exchange
        </button>
      </div>
    </div>
  );
}

function UnitSelect({ units, value, onChange, label }: { units: readonly PurseRow[]; value: string; onChange: (unit: string) => void; label: string }): React.JSX.Element {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {units.map((row) => (
        <option key={row.unit} value={row.unit}>
          {row.label}
        </option>
      ))}
    </select>
  );
}

/** A whole number typed, committed on leaving the field or Enter, so a half-typed number re-derives nothing. */
function CommittedNumber({ value, min, onCommit }: { value: number; min: number; onCommit: (value: number) => void }): React.JSX.Element {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    const n = Number(text);
    if (text.trim() !== '' && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <input
      type="number"
      className="inventory-number"
      min={min}
      step={1}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && commit()}
    />
  );
}

/** Text typed, committed on leaving the field (and Enter on one line), so a keystroke re-derives nothing. */
function CommittedText({
  value,
  placeholder,
  multiline,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  multiline?: boolean;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (): void => {
    if (text !== value) onCommit(text);
  };
  return multiline ? (
    <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />
  ) : (
    <input
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && commit()}
    />
  );
}
