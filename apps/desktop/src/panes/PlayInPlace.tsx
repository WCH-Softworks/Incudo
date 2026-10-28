/**
 * Play spent where its number is — ADR 0126 decision 8, replacing the Play panel on a laid-out sheet.
 *
 * `playPlaces` (packages/ui) says where each tracker counts: a stat (hit points, in the head band), a section's row (a
 * slot level), or an element a section lists (a class's hit dice, a feature's uses). The sheet's rows and listed elements
 * ask `PlayContext` for theirs and draw it beside them; what counts no row (inspiration, death saves, exhaustion), the
 * conditions and the rests are the strip under the head band. Nothing here computes: every value and every edit is
 * `packages/ui`'s, through the builder. None of it is in the document, so none of it prints (ADR 0084 decision 8).
 */

import { createContext, useContext, useState } from 'react';

import { playRestNote, playValue, restEffects, type CharacterBuilder, type PlayPlaces, type PlayTracker, type PlayView } from '@incudo/ui';

import { ArmedButton } from './ArmedButton.tsx';
import { Pool } from './PlayPanel.tsx';

export interface PlayHere {
  builder: CharacterBuilder;
  view: PlayView;
  places: PlayPlaces;
}

/** The character's play, for the rows and elements that draw a tracker beside them. Null outside a laid-out sheet. */
export const PlayContext = createContext<PlayHere | null>(null);

/** The most boxes drawn for a tracker; one with more is a number with − and +. */
const MAX_BOXES = 12;

/**
 * A tracker as boxes, one per use, the spent ones filled: a click on a box spends up to it, a click on the last spent one
 * gives it back. One that counts (exhaustion) fills as many as it counts. Past `MAX_BOXES` it is a number with − and +.
 */
export function Boxes({ tracker, builder, label = tracker.label }: { tracker: PlayTracker; builder: CharacterBuilder; label?: string }): React.JSX.Element {
  const note = playRestNote(tracker);
  if (tracker.max > MAX_BOXES) {
    return (
      <span className="play-inline" title={note}>
        <span className="play-count">{playValue(tracker)}</span>
        <button type="button" aria-label={`Spend one ${label}`} disabled={tracker.spent >= tracker.max} onClick={() => builder.adjustPlay(tracker.key, 1)}>
          −
        </button>
        <button type="button" aria-label={`Get one ${label} back`} disabled={tracker.spent <= 0} onClick={() => builder.adjustPlay(tracker.key, -1)}>
          +
        </button>
      </span>
    );
  }
  return (
    <span className="play-boxes" role="group" aria-label={`${label}: ${playValue(tracker)}${note ? `. ${note}` : ''}`} title={note}>
      {Array.from({ length: tracker.max }, (_, at) => {
        // A click on an empty box fills up to it; on a filled one, empties from it on.
        const filled = at < tracker.spent;
        return (
          <button
            key={at}
            type="button"
            className={filled ? 'play-box spent' : 'play-box'}
            aria-label={`${label}, box ${at + 1} of ${tracker.max}, ${filled ? (tracker.counts ? 'marked' : 'spent') : tracker.counts ? 'not marked' : 'not spent'}`}
            onClick={() => builder.setPlaySpent(tracker.key, filled ? at : at + 1)}
          />
        );
      })}
    </span>
  );
}

/** What a section's row spends, drawn beside it, when a tracker counts it. */
export function RowPlay({ section, stat }: { section: string; stat: string }): React.JSX.Element | null {
  const here = useContext(PlayContext);
  const tracker = here?.places.row(section, stat);
  return here && tracker ? <Boxes tracker={tracker} builder={here.builder} /> : null;
}

/** What a listed element spends (a feature's uses), drawn on it, when a tracker counts it. */
export function ElementPlay({ section, element }: { section: string; element: string }): React.JSX.Element | null {
  const here = useContext(PlayContext);
  const tracker = here?.places.element(section, element);
  return here && tracker ? (
    <span className="play-on-element">
      <Boxes tracker={tracker} builder={here.builder} />
    </span>
  ) : null;
}

/**
 * The strip under the head band: what a tile's stat spends with its controls (hit points), what the head band lists that
 * spends (hit dice), what counts no row, a stat no row shows (ki points), the conditions and the rests.
 */
export function PlayStrip({ here, tileStats, headSections }: { here: PlayHere; tileStats: ReadonlySet<string>; headSections: readonly string[] }): React.JSX.Element {
  const { builder, view, places } = here;
  const pools = places.all.filter(({ tracker }) => tracker.at && 'stat' in tracker.at && tileStats.has(tracker.at.stat));
  const statsElsewhere = places.all.filter(({ tracker }) => tracker.at && 'stat' in tracker.at && !tileStats.has(tracker.at.stat));
  const headElements = places.all.filter(({ tracker }) => tracker.at && 'element' in tracker.at && headSections.includes(tracker.at.section));
  const restLabel = (restId: string, label: string): string => {
    const effects = restEffects(view, restId);
    return effects.length ? `Take a ${label}: it gives back ${effects.join(', ')}` : `Take a ${label}: nothing spent comes back on it`;
  };
  return (
    <div className="play-strip" aria-label="Play">
      {pools.map(({ tracker }) => (
        <Pool key={tracker.key} builder={builder} tracker={tracker} named />
      ))}
      {/* On paper, a blank line for what is spent in amounts (ADR 0126 decision 9). */}
      {pools.map(({ tracker }) => (
        <span key={`print:${tracker.key}`} className="play-print-only">
          <span className="play-strip-label">Current {tracker.label}</span> <span className="play-blank" />
          {tracker.temporary && (
            <>
              {' '}
              <span className="play-strip-label">{tracker.temporary.label}</span> <span className="play-blank" />
            </>
          )}
        </span>
      ))}
      <div className="play-strip-line">
        {[...headElements, ...statsElsewhere, ...places.loose.map((tracker) => ({ tracker, group: tracker.label }))].map(({ tracker, group }) => (
          <span key={tracker.key} className="play-strip-item">
            <span className="play-strip-label">{tracker.label === group || group === undefined ? tracker.label : `${group}: ${tracker.label}`}</span>
            <Boxes tracker={tracker} builder={builder} />
          </span>
        ))}
      </div>
      {view.conditions && <Conditions here={here} />}
      {view.rests.length > 0 && (
        <div className="play-rests">
          {view.rests.map((rest) => (
            <ArmedButton key={rest.id} label={rest.label} armedLabel={restLabel(rest.id, rest.label)} armedClassName="" onConfirm={() => builder.rest(rest.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The conditions the character is under as chips, each with a button to clear it, and a list to add one. */
function Conditions({ here }: { here: PlayHere }): React.JSX.Element {
  const conditions = here.view.conditions!;
  const [picked, pick] = useState('');
  const on = conditions.names.filter((condition) => condition.on);
  const off = conditions.names.filter((condition) => !condition.on);
  return (
    <div className="play-conditions-chips">
      <span className="play-strip-label">{conditions.label}</span>
      {on.length === 0 && <span className="hint">none</span>}
      {on.map(({ name }) => (
        <span key={name} className="play-chip">
          {name}
          <button type="button" aria-label={`Clear ${name}`} onClick={() => here.builder.setPlayCondition(name, false)}>
            ×
          </button>
        </span>
      ))}
      {off.length > 0 && (
        <select
          aria-label="Add a condition"
          value={picked}
          onChange={(event) => {
            const name = event.target.value;
            pick('');
            if (name) here.builder.setPlayCondition(name, true);
          }}
        >
          <option value="">Add a condition…</option>
          {off.map(({ name }) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
