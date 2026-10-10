/**
 * Playing the character, on the Sheet — ADR 0084.
 *
 * A renderer of `PlayView` (`packages/ui/src/play.ts`), as the phone's play screen is: every value and what a rest does
 * is worded there (`playValue`, `playTemporaryText`, `playRestNote`, `restEffects`), and every click is one of the
 * builder's play methods. What it changes reaches the file on Save, as any other edit here does. Not printed: a printed
 * sheet is the table's (decision 8).
 */

import { useState } from 'react';

import { playRestNote, playTemporaryText, playValue, restEffects, type CharacterBuilder, type PlayTracker, type PlayView } from '@incudo/ui';

import { ArmedButton } from './ArmedButton.tsx';

export function PlayPanel({ builder, view }: { builder: CharacterBuilder; view: PlayView }): React.JSX.Element {
  // A second click takes the rest, on a button that says what it gives back (`ArmedButton` says why not a confirm).
  const restLabel = (restId: string, label: string): string => {
    const effects = restEffects(view, restId);
    return effects.length ? `Take a ${label}: it gives back ${effects.join(', ')}` : `Take a ${label}: nothing spent comes back on it`;
  };
  return (
    <section className="sheet-section play-panel" aria-label="Play">
      <h3>Play</h3>
      <div className="play-groups">
        {view.groups.map((group) => (
          <div key={group.id} className="play-group">
            <h4>{group.label}</h4>
            {group.trackers.map((tracker) =>
              tracker.temporary ? (
                <Pool key={tracker.key} builder={builder} tracker={tracker} named={group.trackers.length > 1} />
              ) : (
                <Counter key={tracker.key} builder={builder} tracker={tracker} named={group.trackers.length > 1 || tracker.label !== group.label} />
              ),
            )}
          </div>
        ))}
      </div>
      {view.conditions && (
        <div className="play-group">
          <h4>{view.conditions.label}</h4>
          <div className="play-conditions">
            {view.conditions.names.map(({ name, on }) => (
              <label key={name}>
                <input type="checkbox" checked={on} onChange={(event) => builder.setPlayCondition(name, event.target.checked)} /> {name}
              </label>
            ))}
          </div>
        </div>
      )}
      {view.rests.length > 0 && (
        <div className="play-rests">
          {view.rests.map((r) => (
            <ArmedButton
              key={r.id}
              label={r.label}
              armedLabel={restLabel(r.id, r.label)}
              armedClassName=""
              onConfirm={() => builder.rest(r.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** A tracker spent one at a time. For one that counts, + adds one; for one that is spent, − spends one. */
function Counter({ builder, tracker, named }: { builder: CharacterBuilder; tracker: PlayTracker; named: boolean }): React.JSX.Element {
  const note = playRestNote(tracker);
  return (
    <div className="play-tracker">
      <span className="play-label">
        {named && <>{tracker.label} </>}
        <strong>{playValue(tracker)}</strong>
        {note && <span className="hint"> · {note}</span>}
      </span>
      <button
        type="button"
        aria-label={tracker.counts ? `One fewer ${tracker.label}` : `Spend one ${tracker.label}`}
        disabled={tracker.counts ? tracker.spent <= 0 : tracker.spent >= tracker.max}
        onClick={() => builder.adjustPlay(tracker.key, tracker.counts ? -1 : 1)}
      >
        −
      </button>
      <button
        type="button"
        aria-label={tracker.counts ? `One more ${tracker.label}` : `Get one ${tracker.label} back`}
        disabled={tracker.counts ? tracker.spent >= tracker.max : tracker.spent <= 0}
        onClick={() => builder.adjustPlay(tracker.key, tracker.counts ? 1 : -1)}
      >
        +
      </button>
    </div>
  );
}

/** A tracker spent in typed amounts, a temporary amount first: hit points. */
function Pool({ builder, tracker, named }: { builder: CharacterBuilder; tracker: PlayTracker; named: boolean }): React.JSX.Element {
  const [typed, setTyped] = useState('');
  const amount = Number.parseInt(typed, 10);
  const ready = Number.isFinite(amount) && amount > 0;
  const temporary = playTemporaryText(tracker);
  const note = playRestNote(tracker);
  const apply = (run: (n: number) => void): void => {
    if (!ready) return;
    run(amount);
    setTyped('');
  };
  return (
    <div className="play-pool">
      <span className="play-label">
        {named && <>{tracker.label} </>}
        <strong className="play-big">{playValue(tracker)}</strong>
        {temporary && <span> {temporary}</span>}
        {note && <span className="hint"> · {note}</span>}
      </span>
      <form
        className="play-amount"
        onSubmit={(event) => {
          event.preventDefault();
          apply((n) => builder.adjustPlay(tracker.key, n));
        }}
      >
        <input
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="Amount"
          aria-label="Amount"
          value={typed}
          onChange={(event) => setTyped(event.target.value.replace(/[^0-9]/g, ''))}
        />
        <button type="submit" disabled={!ready}>
          Lose
        </button>
        <button type="button" disabled={!ready} onClick={() => apply((n) => builder.adjustPlay(tracker.key, -n))}>
          Regain
        </button>
        {tracker.temporary && (
          <button type="button" disabled={!ready} onClick={() => apply((n) => builder.setPlayTemporary(tracker.key, n))}>
            Set {tracker.temporary.label}
          </button>
        )}
        {tracker.temporary && tracker.temporary.value > 0 && (
          <button type="button" onClick={() => builder.setPlayTemporary(tracker.key, 0)}>
            Clear
          </button>
        )}
      </form>
    </div>
  );
}
