/**
 * Features the user writes for this character — ADR 0063.
 *
 * A name, an optional description, where it is listed (ADR 0065: a DM's legendary action), and lines that each add to
 * a number, set it or choose its mark (ADR 0094). What every line is doing (set, replaced by a typed value, overruled
 * by an earlier feature, only addable) and what each list is called is worked out in `packages/ui/src/custom-features.ts`;
 * this renders it and writes what is typed. Nothing here names a stat or a type.
 *
 * The user's feature library (ADR 0106) is offered below the character's own: a feature there is given as a copy, a
 * copy whose original changed says so and offers Update, and any feature can be saved there. What each says is
 * `featureLibraryView`'s.
 */

import { useState, useSyncExternalStore } from 'react';

import type { BuilderState, CharacterBuilder, CustomFeatureView, FeatureLibrary, FeatureLinkView } from '@incudo/ui';
import {
  FEATURE_LIBRARY_HEADING,
  featureLibraryView,
  customFeaturesHint,
  customFeatureLines,
  customFeatureTypeChoices,
  customLineOnStat,
  customLineModeAllowed,
  customLineModes,
  customLineWithMode,
  customMarkChoices,
  customStatGroups,
  newCustomStatLine,
  NEW_CUSTOM_FEATURE_NAME,
  withCustomLine,
  withoutCustomLine,
} from '@incudo/ui';
import type { CustomStatLine } from '@incudo/core';

export function CustomFeatures({
  state,
  builder,
  library,
}: {
  state: BuilderState;
  builder: CharacterBuilder;
  library: FeatureLibrary;
}): React.JSX.Element {
  const { customFeatures, character } = state;
  const libraryState = useSyncExternalStore(library.subscribe, library.getState);
  const view = featureLibraryView(libraryState, character);
  const [busy, setBusy] = useState(false);

  const saveToLibrary = async (featureId: string) => {
    const feature = character.customFeatures?.find((f) => f.id === featureId);
    if (!feature) return;
    setBusy(true);
    try {
      const link = await library.save(feature, character.systemId);
      if (link) builder.linkCustomFeature(featureId, link);
    } finally {
      setBusy(false);
    }
  };

  const removeFromLibrary = async (id: string, name: string) => {
    if (!window.confirm(`Remove "${name}" from your feature library? Characters that have it keep their copy.`)) return;
    setBusy(true);
    try {
      await library.remove(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="hint">{customFeaturesHint(customFeatures.stats)}</p>
      {customFeatures.features.map((feature) => (
        <Feature
          key={feature.id}
          feature={feature}
          state={state}
          builder={builder}
          link={view.links.get(feature.id)}
          busy={busy}
          onSave={() => void saveToLibrary(feature.id)}
        />
      ))}
      <button type="button" onClick={() => builder.addCustomFeature(NEW_CUSTOM_FEATURE_NAME)}>
        Add a feature
      </button>

      <h3>{FEATURE_LIBRARY_HEADING}</h3>
      {view.problem && <p className="hint">{view.problem}</p>}
      {view.message && <p className="hint">{view.message}</p>}
      {view.offers.length > 0 && (
        <ul className="feature-library">
          {view.offers.map(({ entry, given }) => (
            <li key={entry.id}>
              <span className="feature-library-name">{entry.name.trim() || 'Unnamed feature'}</span>
              {given ? (
                <span className="hint">On this character</span>
              ) : (
                <button type="button" onClick={() => builder.giveLibraryFeature(entry)} disabled={busy}>
                  Give
                </button>
              )}
              <button type="button" className="link" onClick={() => void removeFromLibrary(entry.id, entry.name)} disabled={busy}>
                Remove from library
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Feature({
  feature,
  state,
  builder,
  link,
  busy,
  onSave,
}: {
  feature: CustomFeatureView;
  state: BuilderState;
  builder: CharacterBuilder;
  link: FeatureLinkView | undefined;
  busy: boolean;
  onSave: () => void;
}): React.JSX.Element {
  const { stats } = state.customFeatures;
  const lines: CustomStatLine[] = customFeatureLines(feature);
  const write = (next: CustomStatLine[]) => builder.updateCustomFeature(feature.id, { stats: next });
  const change = (at: number, line: CustomStatLine) => write(withCustomLine(lines, at, line));
  const typeChoices = customFeatureTypeChoices(state.customFeatures, feature);

  const addLine = () => {
    const line = newCustomStatLine(stats, state.derived);
    if (line) write([...lines, line]);
  };

  return (
    <div className="settled custom-feature">
      <label className="custom-feature-name">
        Name
        <input
          type="text"
          value={feature.name}
          onChange={(event) => builder.updateCustomFeature(feature.id, { name: event.target.value })}
        />
      </label>
      {typeChoices.length > 0 && (
        <label className="custom-feature-type">
          Listed under
          <select
            value={feature.type}
            onChange={(event) => builder.updateCustomFeature(feature.id, { type: event.target.value })}
          >
            {typeChoices.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {feature.typeNote && <p className="hint">{feature.typeNote}</p>}
      {link?.note && <p className="hint">{link.note}</p>}
      <label className="custom-feature-description">
        Description
        <textarea
          rows={2}
          value={feature.description}
          placeholder="Optional. Why this character has it."
          onChange={(event) => builder.updateCustomFeature(feature.id, { description: event.target.value })}
        />
      </label>

      {feature.lines.length > 0 && (
        <ul className="custom-lines">
          {feature.lines.map((line, at) => (
            <li key={at} className={line.status === 'applied' ? '' : 'not-applied'}>
              <div className="custom-line">
                <select
                  aria-label="Stat"
                  value={line.stat}
                  onChange={(event) => change(at, customLineOnStat(lines[at]!, event.target.value, stats, state.derived))}
                >
                  {line.status === 'unknown' && <option value={line.stat}>{line.label}</option>}
                  {/* Grouped as the sheet groups them: two stats may share a label (an ability and its save). */}
                  {customStatGroups(stats).map(({ group, stats: grouped }) => (
                    <optgroup key={group} label={group}>
                      {grouped.map((s) => (
                        <option key={s.stat} value={s.stat}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <select
                  aria-label="How"
                  value={line.mode}
                  onChange={(event) => {
                    const mode = customLineModes(stats, line.stat).find((m) => m.mode === event.target.value)?.mode ?? 'add';
                    change(at, customLineWithMode(lines[at]!, mode, stats));
                  }}
                >
                  {customLineModes(stats, line.stat).map((m) => (
                    <option key={m.mode} value={m.mode} disabled={!customLineModeAllowed(stats, line.stat, m.mode)}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {line.mode === 'mark' ? (
                  <select
                    aria-label="Mark"
                    value={line.value}
                    onChange={(event) => change(at, { ...lines[at]!, value: Number(event.target.value) })}
                  >
                    {line.status === 'not-markable' && <option value={line.value}>{String(line.value)}</option>}
                    {customMarkChoices(stats, line.stat).map((choice, count) => (
                      <option key={count} value={count}>
                        {choice}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    aria-label="Value"
                    value={line.value}
                    onChange={(event) => {
                      if (event.target.value === '') return;
                      change(at, { ...lines[at]!, value: Number(event.target.value) });
                    }}
                  />
                )}
                <button type="button" className="link" onClick={() => write(withoutCustomLine(lines, at))}>
                  Remove
                </button>
              </div>
              {line.note && <p className="hint">{line.note}</p>}
            </li>
          ))}
        </ul>
      )}

      <div className="decision-head">
        <button type="button" className="link" onClick={addLine} disabled={!stats.length}>
          Add a line
        </button>
        <button type="button" className="link" onClick={() => builder.removeCustomFeature(feature.id)}>
          Remove feature
        </button>
        {link?.entry && (
          <button type="button" className="link" onClick={() => builder.updateFromLibrary(feature.id, link.entry!)}>
            Update from your feature library
          </button>
        )}
        {link?.save && (
          <button type="button" className="link" onClick={onSave} disabled={busy}>
            {link.save}
          </button>
        )}
      </div>
    </div>
  );
}

