/**
 * The starting equipment step (ADR 0087): the options a class or background offers, as an open decision, and what was
 * taken, with the purse, once it is settled.
 *
 * Everything shown is `StartingEquipmentState`'s, worked out in `packages/ui/src/starting-equipment.ts`: what each
 * option gives, which answers it still owes, whether a package can be taken back. This renders it and computes nothing;
 * what it holds is only the sentence a refused Take returned, until the next one.
 */

import { useMemo, useState } from 'react';
import type { ElementId, ElementIndex } from '@incudo/core';
import {
  PENDING_ITEMS_HINT,
  purseLine,
  startingMissingNote,
  startingOwedNote,
  STARTING_EQUIPMENT_HINT,
  STARTING_UNLISTED,
  type CharacterBuilder,
  type StartingEquipmentState,
  type StartingOptionView,
  type StartingPickView,
  type StartingSource,
} from '@incudo/ui';

import { CandidatePicker } from './CandidatePicker.tsx';

/** An open source's options, each with its lines, its answers and a Take button. */
export function StartingOptions({
  source,
  builder,
  candidateLabel,
}: {
  source: StartingSource;
  builder: CharacterBuilder;
  candidateLabel: (id: ElementId) => string;
}): React.JSX.Element {
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const forId = source.forId!;
  return (
    <div className="starting-options">
      <p className="hint">{STARTING_EQUIPMENT_HINT}</p>
      {source.options.map((option) => (
        <StartingOptionCard
          key={option.id}
          forId={forId}
          option={option}
          builder={builder}
          candidateLabel={candidateLabel}
          onTake={() => setRefusal(builder.takeStartingOption(forId, option.id))}
        />
      ))}
      {refusal && <p className="hint error">{refusal}</p>}
    </div>
  );
}

function StartingOptionCard({
  forId,
  option,
  builder,
  candidateLabel,
  onTake,
}: {
  forId: ElementId;
  option: StartingOptionView;
  builder: CharacterBuilder;
  candidateLabel: (id: ElementId) => string;
  onTake: () => void;
}): React.JSX.Element {
  return (
    <fieldset className="starting-option">
      <legend>{option.label}</legend>
      <ul className="starting-lines">
        {option.lines.map((line) => (
          <li key={line.key}>
            {line.kind === 'items' ? (
              line.text && <span>{line.text}</span>
            ) : (
              <span className="starting-choice">
                {line.alternatives.map((alternative) => (
                  <label key={alternative.index}>
                    <input
                      type="radio"
                      name={`${forId}/${option.id}/${line.key}`}
                      checked={line.chosen === alternative.index}
                      onChange={() => builder.chooseStartingAlternative(forId, option.id, line.key, alternative.index)}
                    />{' '}
                    {alternative.text}
                  </label>
                ))}
              </span>
            )}
            {line.picks.map((pick) => (
              <StartingPick key={pick.key} forId={forId} optionId={option.id} pick={pick} builder={builder} candidateLabel={candidateLabel} />
            ))}
          </li>
        ))}
        {option.coins && <li>{option.coins}</li>}
        {option.wealth && (
          <li>
            {option.wealth.text}
            {option.wealth.amount !== undefined && <span className="hint"> (rolled {option.wealth.rolled}: {option.wealth.amount})</span>}
          </li>
        )}
      </ul>
      {option.unlisted.length > 0 && (
        <p className="hint">
          {STARTING_UNLISTED} {option.unlisted.join('; ')}.
        </p>
      )}
      {option.missing.length > 0 && <p className="hint">{startingMissingNote(option.missing.length)}</p>}
      <div className="decision-head">
        <button type="button" disabled={!option.ready} onClick={onTake}>
          {option.wealth && option.wealth.rolled === undefined ? 'Roll and take' : 'Take'}
        </button>
        {option.owed > 0 && <span className="tag open">{startingOwedNote(option.owed)}</span>}
      </div>
    </fieldset>
  );
}

function StartingPick({
  forId,
  optionId,
  pick,
  builder,
  candidateLabel,
}: {
  forId: ElementId;
  optionId: string;
  pick: StartingPickView;
  builder: CharacterBuilder;
  candidateLabel: (id: ElementId) => string;
}): React.JSX.Element {
  return (
    <span className="starting-pick">
      {pick.chosen.map((chosen, slot) => (
        <select
          key={slot}
          aria-label={pick.count > 1 ? `${pick.label}, ${slot + 1} of ${pick.count}` : pick.label}
          value={chosen ?? ''}
          onChange={(event) => builder.pickStartingItem(forId, optionId, pick.key, slot, event.target.value || undefined)}
        >
          <option value="">{pick.count > 1 ? `${pick.label} (${slot + 1} of ${pick.count})` : pick.label}…</option>
          {pick.candidates.map((id) => (
            <option key={id} value={id}>
              {candidateLabel(id)}
            </option>
          ))}
        </select>
      ))}
    </span>
  );
}

/** What was taken for each source, what has nothing written, and the purse: the settled half of the step. */
export function StartingEquipmentSettled({
  state,
  builder,
  nameOf,
}: {
  state: StartingEquipmentState;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
}): React.JSX.Element {
  const settled = state.sources.filter((source) => source.status !== 'open');
  return (
    <>
      {settled.map((source) => (
        <div key={source.key} className="settled">
          <div className="decision-head">
            <span className="label">{source.forId ? nameOf(source.forId) : source.stepLabel}</span>
            {source.taken?.canReturn && (
              <button type="button" className="link" onClick={() => builder.returnStartingOption(source.forId!)}>
                Take back
              </button>
            )}
          </div>
          {source.note && <p className="hint">{source.note}</p>}
          {source.taken && (
            <ul className="starting-taken">
              {source.taken.entries.map((entry, i) => (
                <li key={i}>{entry}</li>
              ))}
              {source.taken.coins && (
                <li>
                  {source.taken.coins}
                  {source.taken.rolled !== undefined && <span className="hint"> (rolled {source.taken.rolled})</span>}
                </li>
              )}
            </ul>
          )}
        </div>
      ))}
      {state.purse.length > 0 && (
        <p>
          <span className="label">Money:</span> {purseLine(state.purse)}
        </p>
      )}
    </>
  );
}

/**
 * The lines a taken package lists that no loaded item matched (ADR 0119 decision 9), each resolved by the user with an
 * item, or with a name of their own that enters the bag under that name. Holds only which line is being resolved and
 * the name being typed, and the sentence a refused resolve returned.
 */
export function PendingItems({
  state,
  builder,
  elements,
  candidateLabel,
}: {
  state: StartingEquipmentState;
  builder: CharacterBuilder;
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
}): React.JSX.Element | null {
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [name, setName] = useState('');
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  // Asked of the builder only while a line is open: it is every item loaded.
  const options = useMemo(() => (open ? builder.inventoryOptionsFor() : []), [open, builder]);
  if (state.pending.length === 0) return null;
  const resolve = (forId: ElementId, index: number, answer: { elementId: ElementId } | { name: string }): void => {
    const refused = builder.resolvePendingItem(forId, index, answer);
    setRefusal(refused);
    if (!refused) {
      setOpen(undefined);
      setName('');
    }
  };
  return (
    <section className="pending-items">
      <h3>Pending items</h3>
      <p className="hint">{PENDING_ITEMS_HINT}</p>
      <ul className="starting-taken">
        {state.pending.map((line) => {
          const key = `${line.forId}/${line.index}`;
          const text = line.quantity > 1 ? `${line.text} ×${line.quantity}` : line.text;
          return (
            <li key={key}>
              <div className="decision-head">
                <span>
                  {text}
                  {line.resolved && <span className="hint"> — {line.resolved}</span>}
                </span>
                {open !== key && (
                  <button type="button" className="link" onClick={() => { setOpen(key); setName(''); setRefusal(undefined); }}>
                    {line.resolved ? 'Change' : 'Resolve'}
                  </button>
                )}
              </div>
              {open === key && (
                <div className="settled">
                  {state.canName && (
                    <form
                      className="decision-head"
                      onSubmit={(event) => {
                        event.preventDefault();
                        resolve(line.forId, line.index, { name });
                      }}
                    >
                      <input type="text" aria-label={`A name for ${line.text}`} placeholder={line.text} value={name} onChange={(event) => setName(event.target.value)} />
                      <button type="submit" disabled={!name.trim()}>
                        Use this name
                      </button>
                      <button type="button" className="link" onClick={() => setOpen(undefined)}>
                        Cancel
                      </button>
                    </form>
                  )}
                  <p className="hint">{state.canName ? 'Or choose an item:' : 'Choose an item:'}</p>
                  <CandidatePicker
                    candidates={options}
                    elements={elements}
                    candidateLabel={candidateLabel}
                    onSelect={(id) => resolve(line.forId, line.index, { elementId: id })}
                  />
                  {!state.canName && (
                    <button type="button" className="link" onClick={() => setOpen(undefined)}>
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {refusal && <p className="hint error">{refusal}</p>}
    </section>
  );
}
