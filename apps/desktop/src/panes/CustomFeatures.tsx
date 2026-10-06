/**
 * Features the user writes for this character — ADR 0063.
 *
 * A name, an optional description, where it is listed (ADR 0065: a DM's legendary action), and lines that each add to
 * a number, set it or choose its mark (ADR 0094). What every line is doing (set, replaced by a typed value, overruled
 * by an earlier feature, only addable) and what each list is called is worked out in `packages/ui/src/custom-features.ts`;
 * this renders it and writes what is typed. Nothing here names a stat or a type.
 */

import type { BuilderState, CharacterBuilder, CustomFeatureView } from '@incudo/ui';
import {
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
}: {
  state: BuilderState;
  builder: CharacterBuilder;
}): React.JSX.Element {
  const { customFeatures } = state;
  return (
    <>
      <p className="hint">{customFeaturesHint(customFeatures.stats)}</p>
      {customFeatures.features.map((feature) => (
        <Feature key={feature.id} feature={feature} state={state} builder={builder} />
      ))}
      <button type="button" onClick={() => builder.addCustomFeature(NEW_CUSTOM_FEATURE_NAME)}>
        Add a feature
      </button>
    </>
  );
}

function Feature({
  feature,
  state,
  builder,
}: {
  feature: CustomFeatureView;
  state: BuilderState;
  builder: CharacterBuilder;
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
      </div>
    </div>
  );
}

