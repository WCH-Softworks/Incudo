/**
 * The bag and the purse, edited at any point (ADR 0098): what the character carries, where each item is, what it gives,
 * and the coins.
 *
 * Everything shown is `InventoryState`'s, worked out in `packages/ui/src/inventory.ts` and `money.ts`; every change is a
 * builder method that returns a sentence when it was refused. This renders it and computes nothing; what it holds is
 * the text being typed into a name, notes or an amount until it is committed, which picker is open, and the last
 * sentence a change returned.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElementId, ElementIndex } from '@incudo/core';
import {
  ALL_ITEMS_LABEL,
  INVENTORY_HINT,
  offerGroupLine,
  TAKEN_ON_BUILD,
  TAKEN_ON_BUILD_HINT,
  type CharacterBuilder,
  type InventoryRow,
  type InventoryState,
  type OfferGroup,
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
  const groups = useMemo(() => (adding ? builder.inventoryGroupsFor() : []), [adding, builder]);
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
            {groups.length > 0 ? (
              <GroupedPicker groups={groups} elements={elements} candidateLabel={candidateLabel} notes={notes} onSelect={(id) => say(builder.addItem(id, paying))} />
            ) : (
              <CandidatePicker
                candidates={options}
                elements={elements}
                candidateLabel={candidateLabel}
                notes={notes}
                onSelect={(id) => say(builder.addItem(id, paying))}
              />
            )}
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

/**
 * The add list in its groups (ADR 0117): the groups, and on choosing one the list slides left to that group's items, with a
 * way back. "All items" heads the groups, for a search that does not know where an item is. The groups and their words
 * are the view-model's; this holds only which group is open.
 */
function GroupedPicker({
  groups,
  elements,
  candidateLabel,
  notes,
  onSelect,
}: {
  groups: OfferGroup[];
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
  notes: ReadonlyMap<ElementId, string>;
  onSelect: (id: ElementId) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState<OfferGroup | null>(null);
  // The last group shown stays in the right-hand panel while it slides away, so the slide back is not to a blank.
  const [shown, setShown] = useState<OfferGroup | null>(null);
  const choose = (group: OfferGroup): void => {
    setShown(group);
    setOpen(group);
  };
  // The keyboard follows the slide: into the group's search box, and back to the group's own entry. Without it the
  // focus was left on a control the slide had made inert, so the next Tab started again from the top of the page.
  // After the render that lifted `inert`, since nothing in an inert panel takes the focus. Without scrolling: the panel is
  // still sliding in, and a focus that scrolls moved the clipped track a second panel's width sideways (the list was left
  // off to the left, a blank box in its place) and the page down with it. Seen in the Tauri window on 2026-10-20.
  const groupsPanel = useRef<HTMLDivElement>(null);
  const itemsPanel = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    if (open) (itemsPanel.current?.querySelector<HTMLElement>('input') ?? itemsPanel.current?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    else if (shown) {
      const entries = [...(groupsPanel.current?.querySelectorAll<HTMLButtonElement>('button.offer-group') ?? [])];
      entries.find((entry) => entry.dataset.group === shown.label)?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    // The slide is the track's transform alone: anything that scrolls this clipped box sideways (a focus moved by Tab, a
    // find) would add to it, so it is put back.
    <div className="offer-groups" onScroll={(event) => { event.currentTarget.scrollLeft = 0; }}>
      <div className={open ? 'offer-groups-track open' : 'offer-groups-track'}>
        <div className="offer-groups-panel" inert={open !== null} ref={groupsPanel}>
          <ul className="offer-group-list">
            {groups.map((group) => (
              <li key={group.label}>
                <button
                  type="button"
                  className={group.label === ALL_ITEMS_LABEL ? 'offer-group all' : 'offer-group'}
                  data-group={group.label}
                  onClick={() => choose(group)}
                >
                  {offerGroupLine(group)}
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="offer-groups-panel" inert={open === null} ref={itemsPanel}>
          {shown && (
            <>
              <div className="decision-head">
                <button type="button" className="link" onClick={() => setOpen(null)}>
                  ‹ All groups
                </button>
                <span className="label">{shown.label}</span>
              </div>
              <CandidatePicker
                key={shown.label}
                candidates={shown.options}
                elements={elements}
                candidateLabel={candidateLabel}
                notes={notes}
                onSelect={onSelect}
              />
            </>
          )}
        </div>
      </div>
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
